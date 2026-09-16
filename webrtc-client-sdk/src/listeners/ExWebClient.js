import { Call } from "../api/callAPI/Call";
import { DoRegister as DoRegisterRL, UnRegister as UnRegisterRL } from '../api/registerAPI/RegisterListener';
import { CallListener } from '../listeners/CallListener';
import { ExotelVoiceClientListener } from '../listeners/ExotelVoiceClientListener';
import { SessionListener } from '../listeners/SessionListeners';
import { CallController } from "./CallCtrlerDummy";

import { closeDiagnostics as closeDiagnosticsDL, initDiagnostics as initDiagnosticsDL, startMicDiagnosticsTest as startMicDiagnosticsTestDL, startNetworkDiagnostics as startNetworkDiagnosticsDL, startSpeakerDiagnosticsTest as startSpeakerDiagnosticsTestDL, stopMicDiagnosticsTest as stopMicDiagnosticsTestDL, stopNetworkDiagnostics as stopNetworkDiagnosticsDL, stopSpeakerDiagnosticsTest as stopSpeakerDiagnosticsTestDL } from '../api/omAPI/DiagnosticsListener';

import { Callback, RegisterCallback, SessionCallback } from '../listeners/Callback';
import { webrtcTroubleshooterEventBus } from "./Callback";

import { WebrtcSIPPhone, getLogger } from "@exotel-npm-dev/webrtc-core-sdk";
import { CallDetails } from "../api/callAPI/CallDetails";
import LogManager from '../api/LogManager.js';
const phonePool = new Map();
var intervalId;
var intervalIDMap = new Map();
const logger = getLogger();   
const AUTO_RETRY_DELAY_MS = 5000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * FQDN for fetching IP
 */
function fetchPublicIP(sipAccountInfo) {
    return new Promise((resolve) => {
        var publicIp = "";
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        pc.createDataChannel('');
        pc.createOffer().then(offer => pc.setLocalDescription(offer))
        pc.onicecandidate = (ice) => {
            if (!ice || !ice.candidate || !ice.candidate.candidate) {
                pc.close();
                resolve();
                return;
            }
            logger.log("iceCandidate =" + ice.candidate.candidate);
            let split = ice.candidate.candidate.split(" ");
            if (split[7] === "host") {
                logger.log(`fetchPublicIP:Local IP : ${split[4]}`);
            } else {
                logger.log(`fetchPublicIP:External IP : ${split[4]}`);
                publicIp = `${split[4]}`
                logger.log("fetchPublicIP:Public IP :" + publicIp);
                localStorage.setItem("contactHost", publicIp);
                pc.close();
                resolve();
            }
        };
        setTimeout(() => {
            logger.log("fetchPublicIP: public ip = ", publicIp)
            if (publicIp == "") {
                sipAccountInfo.contactHost = window.localStorage.getItem('contactHost');
            } else {
                sipAccountInfo.contactHost = publicIp;
            }
            resolve();
        }, 1000);
    });
}

class ExDelegationHandler {
    constructor(exClient) {
        this.exClient = exClient;
        this.sessionCallback = exClient.sessionCallback;
        this._listeners = new Map();
    }

    /**
     * Attach a handler for a delegation event.
     * @param {string} event
     * @param {Function} handler
     * @returns {Function} unsubscribe
     */
    attach(event, handler) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(handler);
        return () => this._listeners.get(event)?.delete(handler);
    }

    emit(event, ...args) {
        this._listeners.get(event)?.forEach((h) => {
            try {
                h(...args);
            } catch (e) {
                logger.error(`[ExDelegationHandler] handler error for ${event}`, e);
            }
        });
    }

    setTestingMode(mode) {
        logger.log("delegationHandler: setTestingMode\n");
        this.emit("testing-mode", mode);
    }
    onCallStatSipJsSessionEvent(ev) {
        logger.log("delegationHandler: onCallStatSipJsSessionEvent", ev);
        this.sessionCallback.initializeSession(ev, this.exClient.callFromNumber);
        this.sessionCallback.triggerSessionCallback();
        this.emit("call-stat-sipjs-session", ev);
    }
    sendWebRTCEventsToFSM(eventType, sipMethod) {
        logger.log("ExWebClient:ExDelegationHandler: sendWebRTCEventsToFSM event " + eventType  + " " + sipMethod);
      

        if (sipMethod == "CONNECTION") {
            this.exClient.registerEventCallback(eventType, this.exClient.userName);
        } else if (sipMethod == "CALL") {
            this.exClient.callEventCallback(eventType, this.exClient.callFromNumber, this.exClient.call);
        }
        this.emit("webrtc-fsm-event", eventType, sipMethod);
    }
    onWebSocketDisconnect(error) {
        logger.log("ExWebClient: onWebSocketDisconnect:", error);
        // Deliberately NOT gated on unregisterInitiated: registerEventCallback's
        // "registered" branch also clears that flag, and SIP.js's Registerer.unregister()
        // fires a spurious "registered"-shaped state change of its own partway through
        // teardown, before the real disconnect happens - so unregisterInitiated can already
        // read false here even for a fully deliberate unregister(). expectingIntentionalDisconnect
        // is untouched by any of that: set right before the actual disconnect() call, and
        // consumed (cleared) right here, so it can't leak into a later, unrelated real drop.
        if (this.exClient.expectingIntentionalDisconnect) {
            this.exClient.expectingIntentionalDisconnect = false;
            logger.log("ExWebClient: onWebSocketDisconnect: skipping, teardown was intentional (unregister/disconnect)");
            return;
        }
        this.sessionCallback.initializeSession("websocket_disconnected", this.exClient.callFromNumber, error);
        this.sessionCallback.triggerSessionCallback();
    }
    playBeepTone() {
        logger.log("delegationHandler: playBeepTone\n");
        this.emit("play-beep-tone");
    }
    onStatPeerConnectionIceGatheringStateChange(iceGatheringState) {
        logger.log("delegationHandler: onStatPeerConnectionIceGatheringStateChange\n");
        this.sessionCallback.initializeSession(`ice_gathering_state_${iceGatheringState}`, this.exClient.callFromNumber);
        this.sessionCallback.triggerSessionCallback();
        this.emit("ice-gathering-state-change", iceGatheringState);
    }
    onCallStatIceCandidate(ev, icestate) {
        logger.log("delegationHandler: onCallStatIceCandidate\n");
        this.emit("ice-candidate", ev, icestate);
    }
    onCallStatNegoNeeded(icestate) {
        logger.log("delegationHandler: onCallStatNegoNeeded\n");
        this.emit("negotiation-needed", icestate);
    }
    onCallStatSignalingStateChange(cstate) {
        logger.log("delegationHandler: onCallStatSignalingStateChange\n");
        this.emit("signaling-state-change", cstate);
    }
    onStatPeerConnectionIceConnectionStateChange(iceConnectionState) {
        logger.log("delegationHandler: onStatPeerConnectionIceConnectionStateChange\n");
        this.sessionCallback.initializeSession(`ice_connection_state_${iceConnectionState}`, this.exClient.callFromNumber);
        this.sessionCallback.triggerSessionCallback();
        this.emit("ice-connection-state-change", iceConnectionState);
    }
    onStatPeerConnectionConnectionStateChange(connectionState) {
        logger.log("delegationHandler: onStatPeerConnectionConnectionStateChange\n");
        this.emit("connection-state-change", connectionState);
    }
    onGetUserMediaSuccessCallstatCallback() {
        logger.log("delegationHandler: onGetUserMediaSuccessCallstatCallback\n");
        this.emit("get-user-media-success");
    }
    onGetUserMediaErrorCallstatCallback() {
        logger.log("delegationHandler: onGetUserMediaErrorCallstatCallback\n");
        this.sessionCallback.initializeSession(`media_permission_denied`, this.exClient.callFromNumber);
        this.sessionCallback.triggerSessionCallback();
        this.emit("get-user-media-error");
    }
    onCallStatAddStream() {
        logger.log("delegationHandler: onCallStatAddStream\n");
        this.emit("add-stream");
    }
    onCallStatRemoveStream() {
        logger.log("delegationHandler: onCallStatRemoveStream\n");
        this.emit("remove-stream");
    }
    setWebRTCFSMMapper(stack) {
        logger.log("delegationHandler: setWebRTCFSMMapper : Initialisation complete \n");
        this.emit("webrtc-fsm-mapper", stack);
    }
    onCallStatSipJsTransportEvent(ev) {
        logger.log("delegationHandler: onCallStatSipJsTransportEvent\n");
        this.emit("sipjs-transport", ev);
    }
    onCallStatSipSendCallback(tsipData, sipStack) {
        logger.log("delegationHandler: onCallStatSipSendCallback\n");
        this.emit("sip-send", tsipData, sipStack);
    }
    onCallStatSipRecvCallback(tsipData, sipStack) {
        logger.log("delegationHandler: onCallStatSipRecvCallback\n");
        this.emit("sip-recv", tsipData, sipStack);
    }
    stopCallStat() {
        logger.log("delegationHandler: stopCallStat\n");
        this.emit("stop-call-stat");
    }
    onRecieveInvite(incomingSession) {
        logger.log("delegationHandler: onRecieveInvite\n");
        const message = incomingSession.incomingInviteRequest.message;
        const obj = message.headers;
        this.exClient.callFromNumber = message.from.displayName;
        // Assigned unconditionally so a call whose INVITE omits a header reports empty
        // rather than inheriting the previous call's value. getHeader() normalises the
        // lookup the way SIP.js normalises the stored key, so wire casing does not matter.
        CallDetails.callSid = message.getHeader('X-Exotel-CallSid') || '';
        CallDetails.callId = message.getHeader('Call-ID') || '';
        CallDetails.legSid = message.getHeader('X-Exotel-LegSid') || '';
        const result = {};
        for (let key in obj) {
            if (obj.hasOwnProperty(key)) {
                if (obj[key].length == 1) {
                    result[key] = obj[key][0].raw;
                } else if (obj[key].length > 1) {
                    result[key] = obj[key].map(item => item.raw);
                }
            }
        }
        CallDetails.sipHeaders = result;
        this.emit("receive-invite", incomingSession);
    }
    onPickCall() {
        logger.log("delegationHandler: onPickCall\n");
        this.emit("pick-call");
    }
    onRejectCall() {
        logger.log("delegationHandler: onRejectCall\n");
        this.emit("reject-call");
    }
    onCreaterAnswer() {
        logger.log("delegationHandler: onCreaterAnswer\n");
        this.emit("create-answer");
    }
    onSettingLocalDesc() {
        logger.log("delegationHandler: onSettingLocalDesc\n");
        this.emit("setting-local-desc");
    }
    initGetStats(pc, callid, username) {
        logger.log("delegationHandler: initGetStats\n");
        this.emit("init-get-stats", pc, callid, username);
    }
    onRegisterWebRTCSIPEngine(engine) {
        logger.log("delegationHandler: onRegisterWebRTCSIPEngine, engine=\n", engine);
        this.emit("engine-selected", engine);
    }
}

class ExSynchronousHandler {
    onFailure() {
        logger.log("synchronousHandler: onFailure, phone is offline.\n");
    }
    onResponse() {
        logger.log("synchronousHandler: onResponse, phone is connected.\n");
    }
}


class ExotelWebClient {
  /**
   * @param {Object} sipAccntInfo 
   */


    ctrlr = null;
    call;
    eventListener = null;
    callListener = null;
    callFromNumber = null;
    autoRetryEnabled = true;
    shouldAutoRetry = false;
    unregisterInitiated = false;
    // Dedicated, self-consuming flag for onWebSocketDisconnect only. unregisterInitiated
    // isn't safe for this: registerEventCallback's "registered" branch also clears it, and
    // SIP.js's Registerer.unregister() fires a spurious "registered"-shaped state change
    // partway through its own teardown, before the real disconnect ever happens - so by the
    // time onWebSocketDisconnect runs, unregisterInitiated can already read false even for
    // a fully deliberate unregister(). This flag is untouched by any of that: set right
    // before the actual disconnect() call, read-and-cleared only in onWebSocketDisconnect.
    expectingIntentionalDisconnect = false;
    registrationInProgress = false;
    isReadyToRegister = true;


    sipAccountInfo = null;
    clientSDKLoggerCallback = null;
    callbacks  = null;
    registerCallback = null;
    sessionCallback = null;
    logger = getLogger();
    static clientSDKLoggerCallback = null;
        
        
    constructor() {
        // Initialize properties
        this.ctrlr = null;
        this.call = null;
        this.eventListener = null;
        this.callListener = null;
        this.callFromNumber = null;
        this.autoRetryEnabled = true;
        this.shouldAutoRetry = false;
        this.unregisterInitiated = false;
        this.expectingIntentionalDisconnect = false;
        this.registrationInProgress = false;
        this.currentSIPUserName = "";      
        this.isReadyToRegister = true;
        this.sipAccountInfo = null;
        this.callbacks = new Callback();
        this.registerCallback = new RegisterCallback();
        this.sessionCallback = new SessionCallback();
        
        
        
    }
    

    initWebrtc = async (sipAccountInfo_,
        RegisterEventCallBack, CallListenerCallback, SessionCallback, enableAutoAudioDeviceChangeHandling=false) => {
        const userName = sipAccountInfo_?.userName;
        if (!userName) return false;

        // --- Duplicate registration guard ---
        if (phonePool.has(userName)) {
            if (this.currentSIPUserName == "" || this.currentSIPUserName !== userName) {
                logger.warn(`ExWebClient: initWebrtc: [Dup‑Reg] ${userName} already in use – init rejected`);
                return false;
            }
        }
        this.currentSIPUserName = userName;
        phonePool.set(userName, null); 

        if (!this.eventListener) {
            this.eventListener = new ExotelVoiceClientListener(this.registerCallback);
        }

        if (!this.callListener) {
            this.callListener = new CallListener(this.callbacks);
        }

        if (!this.sessionListener) {
            this.sessionListener = new SessionListener(this.sessionCallback);
        }

        if (!this.ctrlr) {
            this.ctrlr = new CallController();
        }

        sipAccountInfo_.enableAutoAudioDeviceChangeHandling = enableAutoAudioDeviceChangeHandling;
        logger.log("ExWebClient: initWebrtc: Exotel Client Initialised with " + JSON.stringify(sipAccountInfo_))
        this.sipAccountInfo = sipAccountInfo_;
        if (!this.sipAccountInfo["userName"] || !this.sipAccountInfo["sipdomain"] || !this.sipAccountInfo["port"]) {
            return false;
        }
        this.sipAccountInfo["sipUri"] = "wss://" + this.sipAccountInfo["userName"] + "@" + this.sipAccountInfo["sipdomain"] + ":" + this.sipAccountInfo["port"];
        
        // Register callbacks using the correct methods
        this.callbacks.registerCallback('call', CallListenerCallback);
        this.registerCallback.initializeRegisterCallback(RegisterEventCallBack);
        logger.log("ExWebClient: initWebrtc: Initializing session callback")
        this.sessionCallback.initializeSessionCallback(SessionCallback);
        this.setEventListener(this.eventListener);

        // Wait for public IP before registering
        // await fetchPublicIP(this.sipAccountInfo);

        // Create phone instance if it wasn't created in constructor
        if (!this.phone) {
            this.userName = this.sipAccountInfo.userName;
            let phone = phonePool.get(this.userName);
            if (!phone) {
                phone = new WebrtcSIPPhone(this.userName);
                phonePool.set(this.userName, phone);
            }
            this.phone = phone;
            this.webrtcSIPPhone = this.phone;
        }

        // Initialize the phone with SIP engine
        this.delegationHandler = new ExDelegationHandler(this);
        this.webrtcSIPPhone.registerPhone("sipjs", this.delegationHandler, this.sipAccountInfo.enableAutoAudioDeviceChangeHandling);

        // Create call instance after phone is initialized
        if (!this.call) {
            this.call = new Call(this.webrtcSIPPhone);
        }

        return true;
    };

    DoRegister = () => {
        logger.log("ExWebClient: DoRegister: Entry")
        if (!this.isReadyToRegister) {
            logger.warn("ExWebClient: DoRegister: SDK is not ready to register");
            return false;
        }
        DoRegisterRL(this.sipAccountInfo, this);
        return true;
    };

    UnRegister = () => {
        logger.log("ExWebClient: UnRegister: Entry")
        UnRegisterRL(this.sipAccountInfo, this)
    };

    /**
     * Opts the client back into auto retry on transport failure. Takes effect
     * from the next initialize() call onward.
     */
    enableAutoRetry = () => {
        logger.log("ExWebClient: enableAutoRetry: Entry");
        this.autoRetryEnabled = true;
    };

    /**
     * Opts the client out of auto retry on transport failure. Same limitation as
     * unregister(): a retry already in flight (DoRegisterRL's own setTimeout, fired
     * but not yet at initialize()) cannot be cancelled, only prevented from now on.
     */
    disableAutoRetry = () => {
        logger.log("ExWebClient: disableAutoRetry: Entry");
        this.autoRetryEnabled = false;
        // Required in addition to autoRetryEnabled, not instead of it: autoRetryEnabled is
        // only read once, at the top of the next initialize() call, to set shouldAutoRetry -
        // it never touches a session that is already armed. Without this line, calling
        // disableAutoRetry() mid-session (after a register already succeeded) would do
        // nothing until the NEXT failure after the one following it: the CURRENTLY-armed
        // session would still fire one more auto-retry on its next transport failure before
        // the disabled policy ever took effect.
        this.shouldAutoRetry = false;
    };

    initDiagnostics = (saveDiagnosticsCallback, keyValueSetCallback) => {
        initDiagnosticsDL(saveDiagnosticsCallback, keyValueSetCallback)
    };

    closeDiagnostics = () => {
        closeDiagnosticsDL()
    };

    startSpeakerDiagnosticsTest = () => {
        startSpeakerDiagnosticsTestDL(this.webrtcSIPPhone);
    };

    stopSpeakerDiagnosticsTest = (speakerTestResponse = 'none') => {
        stopSpeakerDiagnosticsTestDL(speakerTestResponse, this.webrtcSIPPhone);
    };

    startMicDiagnosticsTest = () => {
        startMicDiagnosticsTestDL()
    };

    stopMicDiagnosticsTest = (micTestResponse = 'none') => {
        stopMicDiagnosticsTestDL(micTestResponse)
    };

    startNetworkDiagnostics = () => {
        startNetworkDiagnosticsDL()
        this.DoRegister()
    };

    stopNetworkDiagnostics = () => {
        stopNetworkDiagnosticsDL()
    };

    SessionListenerMethod = () => {
    };


    getCallController = () => {
        return this.ctrlr;
    };

    getCall = () => {
        if (!this.call) {
            this.call = new Call(this.webrtcSIPPhone);
        }
        return this.call;
    };

   
    setEventListener = (eventListener) => {
        this.eventListener = eventListener;
    };

    /**
     * Attach a handler for stats / peer-connection / SIP delegation events.
     * Must be called after initWebrtc (or initialize). Returns unsubscribe fn.
     * @param {string} event
     * @param {Function} handler
     * @returns {Function|undefined}
     */
    attachEventHandler = (event, handler) => {
        if (!this.delegationHandler) {
            logger.warn("ExWebClient: attachEventHandler: delegationHandler not initialized");
            return;
        }
        return this.delegationHandler.attach(event, handler);
    };

    /**
     * Event listener for registration, any change in registration state will trigger the callback here
     * @param {*} event 
     * @param {*} phone 
     * @param {*} param 
     */

    registerEventCallback = (event, phone, param) => {
        logger.log("ExWebClient: registerEventCallback: Received ---> " +
            event + " and unregisterInitiated is " + this.unregisterInitiated, [phone, param]);

        const lowerCaseEvent = event.toLowerCase();

        if (lowerCaseEvent === "registered") {
            // Captured before clearing, not read live below. SIP.js's Registerer.unregister()
            // fires a spurious "registered"-shaped event of its own partway through teardown,
            // and that spurious event always finds registrationInProgress already false (the
            // real registration it belongs to finished earlier). Without this snapshot, that
            // spurious event would be misread as "a deferred unregister() never got scheduled,
            // replay it now" and call unregister() again - confirmed to cause 3x redundant
            // unregister()/sipUnRegisterWebRTC() calls per single unregister click (SR2).
            this.registrationInProgress = false;
            if (this.unregisterInitiated) {
                logger.log("ExWebClient:registerEventCallback unregistering due to unregisterInitiated");
                this.unregisterInitiated = false;
                this.unregister();
            }
            this.isReadyToRegister = false;
            this.eventListener.onRegistrationStateChanged("registered", phone);
        } else if (lowerCaseEvent === "unregistered" || lowerCaseEvent === "terminated") {
            this.registrationInProgress = false;
            this.unregisterInitiated = false;
            this.isReadyToRegister = true;
            this.eventListener.onRegistrationStateChanged("unregistered", phone);
            if (this.shouldAutoRetry) {
                // Best-effort cleanup only - not the retry trigger. A silent network
                // outage (the case this branch mainly exists for) can leave disconnect()
                // unable to complete its close handshake at all (no network path for the
                // close frame either), so failed_to_start may never fire from this. The
                // retry below fires unconditionally instead of waiting on it.
                (phonePool[this.userName] || this.webrtcSIPPhone)?.disconnect?.();
                logger.log("ExWebClient: registerEventCallback: Autoretrying (unregistered/terminated)");
                DoRegisterRL(this.sipAccountInfo, this, AUTO_RETRY_DELAY_MS);
                // Clear immediately so a duplicate firing of this same failure (the
                // pre-existing duplicate-delegate registration issue - "unregistered"
                // reliably fires twice per real event) can't schedule a second, parallel
                // retry. initialize() resets this from autoRetryEnabled on its own next
                // run (this scheduled retry's own, or a manual one), re-arming it for
                // whatever failure comes after that - no separate flag needed.
                this.shouldAutoRetry = false;
            }
        } else if (lowerCaseEvent === "failed_to_start") {
            
            if (this.unregisterInitiated) {
                this.shouldAutoRetry = false;
                this.unregisterInitiated = false;
                this.isReadyToRegister = true;           
            }
            this.eventListener.onRegistrationStateChanged("unregistered", phone);
      


        
            // The only signal that ever reaches here for a transport failure; the SDK
            // does not emit "transport_error". Unlike 1x, no unregisterInitiated check
            // is needed here: a deliberate unregister() already sets shouldAutoRetry =
            // false upstream, and the "unregistered" branch above (which this class-based
            // core SDK always fires first on a real disconnect) already clears the flag
            // before this branch runs, so the check could never fire.
            if (this.shouldAutoRetry) {
                logger.log("ExWebClient: registerEventCallback: Autoretrying");
                DoRegisterRL(this.sipAccountInfo, this, AUTO_RETRY_DELAY_MS);
                // Same reasoning as the "unregistered"/"terminated" branch above: clear
                // right after scheduling so a duplicate firing of this failure can't
                // schedule a second retry. initialize() re-arms it on its next run.
                this.shouldAutoRetry = false;
            }
        }
    };
    /**
     * Event listener for calls, any change in sipjsphone will trigger the callback here
     * @param {*} event 
     * @param {*} phone 
     * @param {*} param 
     */
    callEventCallback = (event, phone, param) => {
        logger.log("ExWebClient: callEventCallback: Received ---> " + event + 'param sent....' + param + 'for phone....' + phone)
        // [VST-2017] Copy the details onto the call object so they survive JSON.stringify.
        // Call only carries methods, so without this the consumer sees {}.
        if (param) Object.assign(param, CallDetails.getCallDetails());
        if (event === "i_new_call") {
            if (!this.call) {
                this.call = new Call(param); // param is the session
            }
            this.callListener.onIncomingCall(param, phone);
        } else if (event === "ringing" || event === "accept_reject") {
            this.callListener.onRinging(param, phone);
        } else if (event === "connected") {
            this.callListener.onCallEstablished(param, phone);
        } else if (event === "terminated") {
            this.callListener.onCallEnded(param, phone);
        }
    };

    /**
     * Event listener for diagnostic tests, any change in diagnostic tests will trigger this callback
     * @param {*} event 
     * @param {*} phone 
     * @param {*} param 
     */
    diagnosticEventCallback = (event, phone, param) => {
        webrtcTroubleshooterEventBus.sendDiagnosticEvent(event, phone, param)
    };

    /**
     * Function to unregister a phone
     * @param {*} sipAccountInfo 
     */
    unregister = (sipAccountInfo) => {
        logger.log("ExWebClient: unregister: Entry");
        this.shouldAutoRetry = false;
        // Also clears the persistent policy flag, not just this session's armed state:
        // a retry already scheduled before this call can't be cancelled (plain setTimeout,
        // no handle kept), and its eventual initialize() call would otherwise recompute
        // shouldAutoRetry = true from autoRetryEnabled, silently re-registering a client
        // that was just told to unregister. The app must call enableAutoRetry() again
        // before its next register if it wants auto-retry back.
        this.unregisterInitiated = true;
        if (!this.registrationInProgress) {
            setTimeout(() => {
                const phone = phonePool[this.userName] || this.webrtcSIPPhone;
                if (phone) {
                  // Armed right here, immediately before the call that can actually
                  // trigger the transport disconnect - not at unregister()'s entry - to
                  // keep the "stuck armed" window (if disconnect() turns out to be a
                  // no-op because the transport was already down) as narrow as possible.
                  this.expectingIntentionalDisconnect = true;
                  phone.sipUnRegisterWebRTC();
                  phone.disconnect?.();
                }
              }, 500);
        }
      };
      

    webRTCStatusCallbackHandler = (msg1, arg1) => {
        logger.log("ExWebClient: webRTCStatusCallbackHandler: " + msg1 + " " + arg1)
    };


    initialize = (uiContext, hostName, subscriberName,
        displayName, accountSid, subscriberToken,
        sipAccountInfo) => {
        let wssPort = sipAccountInfo.port;
        let wsPort = 4442;
        this.isReadyToRegister = false;
        this.registrationInProgress = true;
        this.shouldAutoRetry = this.autoRetryEnabled;
        // Defensive: if a prior unregister() armed this while the transport was already
        // disconnected, disconnect() was a no-op and nothing ever consumed the flag via
        // onWebSocketDisconnect. Starting a fresh register attempt is an unambiguous
        // "clean slate" point, so clear it here rather than risk it later swallowing an
        // unrelated real disconnect on this new session.
        this.expectingIntentionalDisconnect = false;
        this.sipAccntInfo = {
            'userName': '',
            'authUser': '',
            'domain': '',
            'sipdomain': '',
            'displayname': '',
            'accountSid': '',
            'secret': '',
            'sipUri': '',
            'security': '',
            'endpoint': '',
            'port': '',
            'contactHost': ''
        }

        logger.log('ExWebClient: initialize: Sending register for the number..', subscriberName);

        fetchPublicIP(sipAccountInfo);

        this.domain = hostName = sipAccountInfo.domain;
        this.sipdomain = sipAccountInfo.sipdomain;
        this.accountName = this.userName = sipAccountInfo.userName;
        this.authUser = subscriberName = sipAccountInfo.authUser;
        this.displayName = sipAccountInfo.displayName;
        this.accountSid = 'exotelt1';
        this.subscriberToken = sipAccountInfo.secret;
        this.secret = this.password = sipAccountInfo.secret;
        this.security = sipAccountInfo.security ? sipAccountInfo.security : "wss";
        this.endpoint = sipAccountInfo.endpoint ? sipAccountInfo.endpoint : "wss";
        this.port = sipAccountInfo.port;
        this.contactHost = sipAccountInfo.contactHost;
        this.sipWsPort = 5061;
        this.sipPort = 5061;
        this.sipSecurePort = 5062;

        let webrtcPort = wssPort;

        if (this.security === 'ws') {
            webrtcPort = wsPort;
        }



        this.sipAccntInfo['userName'] = this.userName;
        this.sipAccntInfo['authUser'] = subscriberName;
        this.sipAccntInfo['domain'] = hostName;
        this.sipAccntInfo['sipdomain'] = this.sipdomain;
        this.sipAccntInfo['accountName'] = this.userName;
        this.sipAccntInfo['secret'] = this.password;
        this.sipAccntInfo['sipuri'] = this.sipuri;
        this.sipAccntInfo['security'] = this.security;
        this.sipAccntInfo['endpoint'] = this.endpoint;
        this.sipAccntInfo['port'] = webrtcPort;
        this.sipAccntInfo['contactHost'] = this.contactHost;
        localStorage.setItem('contactHost', this.contactHost);

        
        var synchronousHandler = new ExSynchronousHandler();
        // Reuse handler from initWebrtc when present so attachEventHandler listeners survive.
        this.delegationHandler = this.delegationHandler || new ExDelegationHandler(this);

        var userName = this.userName;


        //this.webrtcSIPPhone.registerPhone("sipjs", this.delegationHandler, this.sipAccountInfo.enableAutoAudioDeviceChangeHandling);
        this.webrtcSIPPhone.registerWebRTCClient(this.sipAccntInfo, synchronousHandler);
        phonePool[this.userName] = this.webrtcSIPPhone;     

        
        intervalIDMap.set(userName, intervalId);
    };

    checkClientStatus = (callback) => {
        var constraints = { audio: true, video: false };
        navigator.mediaDevices
            .getUserMedia(constraints)
            .then(function (mediaStream) {
                var transportState = this.webrtcSIPPhone.getTransportState();
                transportState = transportState.toLowerCase();
                switch (transportState) {
                    case "":
                        callback("not_initialized");
                        break;
                    case "unknown":
                    case "connecting":
                        callback(transportState);
                        break;

                    default:
                        var registerationState = this.webrtcSIPPhone.getRegistrationState();
                        registerationState = registerationState.toLowerCase();
                        switch (registerationState) {
                            case "":
                                callback("websocket_connection_failed");
                                break;
                            case "registered":
                                if (transportState != "connected") {
                                    callback("disconnected");
                                } else {
                                    callback(registerationState);
                                }
                                break;
                            default:
                                callback(registerationState);

                        }


                }
            })
            .catch(function (error) {
                logger.log("ExWebClient: checkClientStatus: something went wrong during checkClientStatus ", error);
                callback("media_permission_denied");
            });
    };

    changeAudioInputDevice(deviceId, onSuccess, onError, forceDeviceChange = false) {
        logger.log(`ExWebClient: changeAudioInputDevice: Entry`);
        this.webrtcSIPPhone.changeAudioInputDevice(deviceId, onSuccess, onError, forceDeviceChange);
    }

    changeAudioOutputDevice(deviceId, onSuccess, onError, forceDeviceChange = false) {
        logger.log(`ExWebClient: changeAudioOutputDevice: Entry`);
        this.webrtcSIPPhone.changeAudioOutputDevice(deviceId, onSuccess, onError, forceDeviceChange);
    }

	downloadLogs() {
        logger.log(`ExWebClient: downloadLogs: Entry`);
        LogManager.downloadLogs();
    }

    setPreferredCodec(codecName) {
        logger.log("ExWebClient: setPreferredCodec: Entry");
        if (!this.webrtcSIPPhone || !this.webrtcSIPPhone.phone) {
            logger.warn("ExWebClient: setPreferredCodec: Phone not initialized");
            return;
        }
        this.webrtcSIPPhone.setPreferredCodec(codecName);
    }

    static registerLoggerCallback(callback) {
        logger.log("ExWebClient: registerLoggerCallback: Entry");
        ExotelWebClient.clientSDKLoggerCallback = callback;
    }

    registerAudioDeviceChangeCallback(audioInputDeviceChangeCallback, audioOutputDeviceChangeCallback, onDeviceChangeCallback) {
        logger.log("ExWebClient: registerAudioDeviceChangeCallback: Entry");
        if (!this.webrtcSIPPhone) {
            logger.warn("ExWebClient: registerAudioDeviceChangeCallback: webrtcSIPPhone not initialized");
            return;
        }
        this.webrtcSIPPhone.registerAudioDeviceChangeCallback(audioInputDeviceChangeCallback, audioOutputDeviceChangeCallback, onDeviceChangeCallback);
    }

    static setEnableConsoleLogging(enable) {
        if (enable) {
            logger.log("ExWebClient: setEnableConsoleLogging: Entry, enable: " + enable);
        }
        logger.setEnableConsoleLogging(enable);
    }

    static setAudioOutputVolume(audioElementName, value) {
        logger.log(`ExWebClient: setAudioOutputVolume: Entry, audioElementName: ${audioElementName}, value: ${value}`);
        WebrtcSIPPhone.setAudioOutputVolume(audioElementName, value);
    }

    static getAudioOutputVolume(audioElementName) {
        logger.log(`ExWebClient: getAudioOutputVolume: Entry, audioElementName: ${audioElementName}`);
        return WebrtcSIPPhone.getAudioOutputVolume(audioElementName);
    }

    setCallAudioOutputVolume(value) {
        logger.log(`ExWebClient: setCallAudioOutputVolume: Entry, value: ${value}`);
        this.webrtcSIPPhone.setCallAudioOutputVolume(value);
    }

    getCallAudioOutputVolume() {
        logger.log(`ExWebClient: getCallAudioOutputVolume: Entry`);
        return this.webrtcSIPPhone.getCallAudioOutputVolume();
    }

    setNoiseSuppression(enabled = false) {
        logger.log(`ExWebClient: setNoiseSuppression: ${enabled}`);
        this.webrtcSIPPhone.setNoiseSuppression(enabled);
    }

    setRingingDuration(seconds) {
        logger.log(`ExWebClient: setRingingDuration: ${seconds}`);
        if (!this.webrtcSIPPhone) {
            logger.warn("ExWebClient: setRingingDuration: webrtcSIPPhone not initialized");
            return false;
        }
        return this.webrtcSIPPhone.setRingingDuration(seconds);
    }

    getRingingDuration() {
        logger.log("ExWebClient: getRingingDuration");
        if (!this.webrtcSIPPhone) {
            logger.warn("ExWebClient: getRingingDuration: webrtcSIPPhone not initialized");
            return 30;
        }
        return this.webrtcSIPPhone.getRingingDuration();
    }

    setRingToneAutoStart(enabled) {
        logger.log(`ExWebClient: setRingToneAutoStart: ${enabled}`);
        if (!this.webrtcSIPPhone) {
            logger.warn("ExWebClient: setRingToneAutoStart: webrtcSIPPhone not initialized");
            return false;
        }
        return this.webrtcSIPPhone.setRingToneAutoStart(enabled);
    }

    getRingToneAutoStart() {
        logger.log("ExWebClient: getRingToneAutoStart");
        if (!this.webrtcSIPPhone) {
            logger.warn("ExWebClient: getRingToneAutoStart: webrtcSIPPhone not initialized");
            return true;
        }
        return this.webrtcSIPPhone.getRingToneAutoStart();
    }

    startRingTone() {
        logger.log("ExWebClient: startRingTone");
        if (!this.webrtcSIPPhone) {
            logger.warn("ExWebClient: startRingTone: webrtcSIPPhone not initialized");
            return;
        }
        this.webrtcSIPPhone.startRingTone();
    }

    stopRingTone() {
        logger.log("ExWebClient: stopRingTone");
        if (!this.webrtcSIPPhone) {
            logger.warn("ExWebClient: stopRingTone: webrtcSIPPhone not initialized");
            return;
        }
        this.webrtcSIPPhone.stopRingTone();
    }

}


logger.registerLoggerCallback((type, message, args) => {
    LogManager.onLog(type, message, args);
    if (ExotelWebClient.clientSDKLoggerCallback) {
        // Forward the real severity. This used to be hardcoded to "log", which
        // meant an integrator's callback could not tell an SDK error from an
        // ordinary log line and so could not filter or alert on failures.
        ExotelWebClient.clientSDKLoggerCallback(type, message, args);
    }
});


export { ExDelegationHandler, ExSynchronousHandler, ExotelWebClient };

export default ExotelWebClient;
