(function () {
  'use strict';

  function resolveExotelWebClient() {
    var sdk = window.exotelSDK;
    if (!sdk) {
      throw new Error('exotelSDK global missing — is vendor/exotelsdk.js loaded?');
    }
    if (typeof sdk.ExotelWebClient === 'function') return sdk.ExotelWebClient;
    if (sdk.default && typeof sdk.default === 'function') return sdk.default;
    if (typeof sdk === 'function') return sdk;
    throw new Error('ExotelWebClient not found on exotelSDK: ' + Object.keys(sdk).join(', '));
  }

  var ExotelWebClient = null;
  var client = null;
  var state = emptyState();

  function emptyState() {
    return {
      registerEvents: [],
      callEvents: [],
      sessionEvents: [],
      logs: [],
      diagKeys: [],
      diagReports: [],
      deviceEvents: [],
      lastError: null,
      initResult: null,
      downloadTriggered: false,
    };
  }

  function push(arr, item) {
    arr.push(Object.assign({ ts: Date.now() }, item));
    render();
  }

  function render() {
    var el = document.getElementById('status');
    if (!el) return;
    el.textContent = JSON.stringify(
      {
        registerEvents: state.registerEvents.slice(-10),
        callEvents: state.callEvents.slice(-10),
        sessionEvents: state.sessionEvents.slice(-10),
        diagKeys: state.diagKeys.slice(-20),
        deviceEvents: state.deviceEvents.slice(-10),
        logCount: state.logs.length,
        lastError: state.lastError,
        initResult: state.initResult,
      },
      null,
      2
    );
  }

  function buildSip(overrides) {
    overrides = overrides || {};
    var cfg = window.__paritySipDefaults || {};
    var userName = overrides.userName != null ? overrides.userName : cfg.userName;
    var host = overrides.host != null ? overrides.host : cfg.host;
    var port = overrides.port != null ? overrides.port : cfg.port;
    var domain = overrides.sipdomain != null ? overrides.sipdomain : cfg.sipdomain;
    return {
      userName: userName,
      authUser: overrides.authUser != null ? overrides.authUser : userName,
      sipdomain: domain,
      domain: (host || domain) + ':' + port,
      displayname: overrides.displayname != null ? overrides.displayname : cfg.displayname || userName,
      secret: overrides.secret != null ? overrides.secret : cfg.secret,
      port: String(port),
      security: overrides.security != null ? overrides.security : cfg.security || 'wss',
      endpoint: overrides.endpoint != null ? overrides.endpoint : cfg.endpoint || '',
    };
  }

  function registerCbs() {
    function RegisterEventCallBack(regState, phone) {
      push(state.registerEvents, { state: String(regState), phone: phone || null });
    }
    function CallListenerCallback(callObj, eventType, phone) {
      var callId = null;
      try {
        if (callObj && typeof callObj.callDetails === 'function') {
          var d = callObj.callDetails();
          callId = d && (d.callId || d.CallSid || d.sessionId) || null;
        }
      } catch (e) {
        /* ignore */
      }
      push(state.callEvents, {
        eventType: String(eventType),
        callId: callId,
        phone: phone || null,
      });
    }
    function SessionCallback(sessionState, phone) {
      push(state.sessionEvents, { state: String(sessionState), phone: phone || null });
    }
    return { RegisterEventCallBack: RegisterEventCallBack, CallListenerCallback: CallListenerCallback, SessionCallback: SessionCallback };
  }

  var manualConfirm = {
    pending: false,
    confirmed: false,
    title: '',
    steps: [],
  };

  function showManualConfirmUI() {
    var box = document.getElementById('manual-confirm');
    var titleEl = document.getElementById('manual-confirm-title');
    var stepsEl = document.getElementById('manual-confirm-steps');
    if (!box || !titleEl || !stepsEl) return;
    titleEl.textContent = manualConfirm.title || 'Manual step';
    stepsEl.innerHTML = '';
    (manualConfirm.steps || []).forEach(function (step) {
      var li = document.createElement('li');
      li.textContent = String(step);
      stepsEl.appendChild(li);
    });
    box.classList.add('visible');
  }

  function hideManualConfirmUI() {
    var box = document.getElementById('manual-confirm');
    if (box) box.classList.remove('visible');
  }

  var confirmBtn = document.getElementById('manual-confirm-btn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', function () {
      if (!manualConfirm.pending) return;
      manualConfirm.confirmed = true;
      hideManualConfirmUI();
      render();
    });
  }

  var harness = {
    ready: function () {
      return !!ExotelWebClient;
    },

    setSipDefaults: function (defaults) {
      window.__paritySipDefaults = defaults || {};
    },

    getState: function () {
      return JSON.parse(JSON.stringify(state));
    },

    drainEvents: function () {
      state.registerEvents = [];
      state.callEvents = [];
      state.sessionEvents = [];
      state.diagKeys = [];
      state.diagReports = [];
      state.deviceEvents = [];
      state.logs = [];
      state.lastError = null;
      render();
    },

    reset: function () {
      try {
        if (client && typeof client.UnRegister === 'function') {
          client.UnRegister();
        }
      } catch (e) {
        /* ignore */
      }
      client = null;
      state = emptyState();
      render();
    },

    init: async function (sipOverrides) {
      if (!ExotelWebClient) throw new Error('SDK not loaded');
      if (!client) client = new ExotelWebClient();
      var cbs = registerCbs();
      var sip = buildSip(sipOverrides);
      // 5th arg: enableAutoAudioDeviceChangeHandling — attaches navigator
      // mediaDevices 'devicechange' listener (required for DEV-01)
      var result = await client.initWebrtc(
        sip,
        cbs.RegisterEventCallBack,
        cbs.CallListenerCallback,
        cbs.SessionCallback,
        true
      );
      state.initResult = result;
      render();
      return { result: result, sip: { userName: sip.userName, sipdomain: sip.sipdomain, port: sip.port } };
    },

    register: function () {
      return client.DoRegister();
    },

    unregister: function () {
      return client.UnRegister();
    },

    enableAutoRetry: function () {
      client.enableAutoRetry();
    },

    disableAutoRetry: function () {
      client.disableAutoRetry();
    },

    getStatus: function () {
      return new Promise(function (resolve) {
        try {
          client.checkClientStatus(function (status) {
            resolve(String(status));
          });
        } catch (e) {
          state.lastError = String(e && e.message ? e.message : e);
          resolve('error:' + state.lastError);
        }
      });
    },

    getCall: function () {
      var c = client.getCall();
      var details = null;
      try {
        details = c && c.callDetails ? c.callDetails() : null;
      } catch (e) {
        details = null;
      }
      return {
        exists: !!c,
        callId: details && (details.callId || details.CallSid || details.sessionId) || null,
        details: details,
      };
    },

    getCallRefs: function () {
      var a = client.getCall();
      var b = client.getCall();
      var idA = null;
      var idB = null;
      try {
        var da = a.callDetails();
        var db = b.callDetails();
        idA = da && (da.callId || da.CallSid || da.sessionId);
        idB = db && (db.callId || db.CallSid || db.sessionId);
      } catch (e) {
        /* ignore */
      }
      return { sameRef: a === b, callIdA: idA, callIdB: idB };
    },

    answer: function () {
      try {
        client.getCall().Answer();
        return { ok: true };
      } catch (e) {
        state.lastError = String(e && e.message ? e.message : e);
        return { ok: false, error: state.lastError };
      }
    },

    hangup: function () {
      try {
        client.getCall().Hangup();
        return { ok: true };
      } catch (e) {
        state.lastError = String(e && e.message ? e.message : e);
        return { ok: false, error: state.lastError };
      }
    },

    mute: function () {
      client.getCall().Mute();
      return { muted: harness.getMuteStatus() };
    },

    unmute: function () {
      client.getCall().UnMute();
      return { muted: harness.getMuteStatus() };
    },

    hold: function () {
      client.getCall().Hold();
      return { onHold: harness.getHoldStatus() };
    },

    unhold: function () {
      client.getCall().UnHold();
      return { onHold: harness.getHoldStatus() };
    },

    getMuteStatus: function () {
      try {
        return !!(client.webrtcSIPPhone && client.webrtcSIPPhone.getMuteStatus());
      } catch (e) {
        return null;
      }
    },

    getHoldStatus: function () {
      try {
        return !!(client.webrtcSIPPhone && client.webrtcSIPPhone.getHoldStatus());
      } catch (e) {
        return null;
      }
    },

    /**
     * Media is "up" when call is established and/or remote audio has live tracks.
     * Hold/UnHold is unreliable before this.
     */
    mediaStatus: function () {
      var details = null;
      try {
        var c = client && client.getCall && client.getCall();
        details = c && c.callDetails ? c.callDetails() : null;
      } catch (e) {
        details = null;
      }
      var established = !!(
        details &&
        details.callEstablishedTime &&
        String(details.callEstablishedTime).trim() !== ''
      );
      var liveRemoteTracks = 0;
      var audioElements = 0;
      try {
        document.querySelectorAll('audio').forEach(function (el) {
          audioElements += 1;
          var stream = el.srcObject;
          if (!stream || typeof stream.getAudioTracks !== 'function') return;
          stream.getAudioTracks().forEach(function (t) {
            if (t && t.readyState === 'live') liveRemoteTracks += 1;
          });
        });
      } catch (e) {
        /* ignore */
      }
      var ice = null;
      var receiverLive = 0;
      try {
        var phone = client && client.webrtcSIPPhone;
        var inner = phone && (phone.phone || phone);
        var session =
          (inner && inner.session) ||
          (inner && inner.activeSession) ||
          (inner && inner.sessions && Object.values(inner.sessions)[0]) ||
          null;
        var sdh = session && session.sessionDescriptionHandler;
        var pc = sdh && sdh.peerConnection;
        if (pc) {
          ice = pc.iceConnectionState || pc.connectionState || null;
          if (typeof pc.getReceivers === 'function') {
            pc.getReceivers().forEach(function (r) {
              if (r && r.track && r.track.kind === 'audio' && r.track.readyState === 'live') {
                receiverLive += 1;
              }
            });
          }
        }
      } catch (e) {
        /* ignore */
      }
      var iceOk = ice === 'connected' || ice === 'completed';
      var ready = established || liveRemoteTracks > 0 || (iceOk && receiverLive > 0);
      return {
        ready: ready,
        established: established,
        liveRemoteTracks: liveRemoteTracks,
        receiverLive: receiverLive,
        ice: ice,
        audioElements: audioElements,
        callEstablishedTime: details && details.callEstablishedTime ? details.callEstablishedTime : null,
        callState: details && details.callState ? details.callState : null,
      };
    },

    promptManualConfirm: function (title, steps) {
      manualConfirm.pending = true;
      manualConfirm.confirmed = false;
      manualConfirm.title = title || 'Manual step';
      manualConfirm.steps = Array.isArray(steps) ? steps : [];
      showManualConfirmUI();
      render();
      return { ok: true };
    },

    isManualConfirmed: function () {
      return {
        pending: !!manualConfirm.pending,
        confirmed: !!manualConfirm.confirmed,
        title: manualConfirm.title,
      };
    },

    clearManualConfirm: function () {
      manualConfirm.pending = false;
      manualConfirm.confirmed = false;
      manualConfirm.title = '';
      manualConfirm.steps = [];
      hideManualConfirmUI();
      render();
      return { ok: true };
    },

    sendDTMF: function (digit) {
      try {
        client.getCall().sendDTMF(digit);
        return { ok: true };
      } catch (e) {
        state.lastError = String(e && e.message ? e.message : e);
        return { ok: false, error: state.lastError };
      }
    },

    sessionListener: function () {
      try {
        if (typeof client.SessionListenerMethod === 'function') {
          client.SessionListenerMethod();
        }
        return { ok: true };
      } catch (e) {
        state.lastError = String(e && e.message ? e.message : e);
        return { ok: false, error: state.lastError };
      }
    },

    initDiagnostics: function () {
      client.initDiagnostics(
        function (report) {
          push(state.diagReports, { report: report });
        },
        function (key, status, desc) {
          push(state.diagKeys, { key: key, status: status, desc: desc });
        }
      );
      return { ok: true };
    },

    closeDiagnostics: function () {
      client.closeDiagnostics();
      return { ok: true };
    },

    startSpeakerDiagnosticsTest: function () {
      client.startSpeakerDiagnosticsTest();
    },

    stopSpeakerDiagnosticsTest: function (response) {
      client.stopSpeakerDiagnosticsTest(response == null ? 'none' : response);
    },

    startMicDiagnosticsTest: function () {
      client.startMicDiagnosticsTest();
    },

    stopMicDiagnosticsTest: function (response) {
      client.stopMicDiagnosticsTest(response == null ? 'none' : response);
    },

    startNetworkDiagnostics: function () {
      client.startNetworkDiagnostics();
    },

    stopNetworkDiagnostics: function () {
      return Promise.resolve(client.stopNetworkDiagnostics());
    },

    registerAudioDeviceChangeCallback: function () {
      client.registerAudioDeviceChangeCallback(
        function (id) {
          push(state.deviceEvents, { type: 'input', id: id });
        },
        function (id) {
          push(state.deviceEvents, { type: 'output', id: id });
        },
        function (info) {
          push(state.deviceEvents, { type: 'change', info: info });
        }
      );
      // Ensure SIPJSPhone listens for devicechange (init may have used default false
      // on older harness pages; attach idempotently for DEV-01).
      try {
        var wphone = client.webrtcSIPPhone;
        var phone = wphone && (wphone.phone || wphone);
        if (phone && typeof phone.setEnableAutoAudioDeviceChangeHandling === 'function') {
          phone.setEnableAutoAudioDeviceChangeHandling(true);
        }
        if (phone && typeof phone.attachGlobalDeviceChangeListener === 'function') {
          phone.attachGlobalDeviceChangeListener();
        }
      } catch (e) {
        /* ignore */
      }
      return { ok: true };
    },

    enumerateDevices: async function () {
      var devices = await navigator.mediaDevices.enumerateDevices();
      return devices.map(function (d) {
        return { deviceId: d.deviceId, kind: d.kind, label: d.label };
      });
    },

    changeAudioInputDevice: function (deviceId) {
      return new Promise(function (resolve) {
        client.changeAudioInputDevice(
          deviceId,
          function () {
            resolve({ ok: true });
          },
          function (err) {
            resolve({ ok: false, error: String(err) });
          }
        );
      });
    },

    changeAudioOutputDevice: function (deviceId) {
      return new Promise(function (resolve) {
        client.changeAudioOutputDevice(
          deviceId,
          function () {
            resolve({ ok: true });
          },
          function (err) {
            resolve({ ok: false, error: String(err) });
          }
        );
      });
    },

    setPreferredCodec: function (codecName) {
      client.setPreferredCodec(codecName);
      return { ok: true };
    },

    registerLoggerCallback: function () {
      ExotelWebClient.registerLoggerCallback(function (type, message, args) {
        push(state.logs, { type: String(type), message: String(message), args: args || null });
      });
      return { ok: true };
    },

    downloadLogs: function () {
      state.downloadTriggered = false;
      var prev = window.__parityDownloadHook;
      window.__parityDownloadHook = function () {
        state.downloadTriggered = true;
      };
      try {
        client.downloadLogs();
      } finally {
        if (prev) window.__parityDownloadHook = prev;
      }
      return { downloadTriggered: state.downloadTriggered };
    },

    forceTransportClose: function () {
      try {
        // SIPJSPhone keeps UserAgent on ctxSip.phone (see destroySocketConnection)
        var wphone = client && client.webrtcSIPPhone;
        var sipjs = wphone && (wphone.phone || wphone);
        var ctx = sipjs && sipjs.ctxSip;
        var ua = (ctx && ctx.phone) || (ctx && ctx.userAgent) || null;
        var transport =
          (ua && ua.transport) ||
          (sipjs && sipjs.transport) ||
          (wphone && wphone.transport) ||
          null;

        if (!transport) {
          // Last resort: SDK helper that disconnects the WS
          if (sipjs && typeof sipjs.destroySocketConnection === 'function') {
            sipjs.destroySocketConnection();
            return { ok: true, method: 'destroySocketConnection' };
          }
          return {
            ok: false,
            error: 'transport not found',
            paths: {
              hasWphone: !!wphone,
              hasSipjs: !!sipjs,
              hasCtx: !!ctx,
              hasUa: !!ua,
            },
          };
        }

        if (typeof transport.disconnect === 'function') {
          transport.disconnect();
          return { ok: true, method: 'disconnect' };
        }
        if (typeof transport.close === 'function') {
          transport.close();
          return { ok: true, method: 'close' };
        }
        return { ok: false, error: 'transport has no disconnect/close' };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    },

    getPreferredCodecFromPhone: function () {
      try {
        var phone = client.webrtcSIPPhone;
        if (phone && typeof phone.getPreferredCodec === 'function') {
          return phone.getPreferredCodec();
        }
        if (phone && phone.preferredCodec) return phone.preferredCodec;
        return null;
      } catch (e) {
        return null;
      }
    },
  };

  try {
    ExotelWebClient = resolveExotelWebClient();
    window.__parity = harness;
    var readyEl = document.getElementById('ready');
    if (readyEl) readyEl.textContent = 'Harness ready (window.__parity)';
    render();
  } catch (e) {
    var errEl = document.getElementById('ready');
    if (errEl) errEl.textContent = 'Harness failed: ' + e.message;
    window.__parityLoadError = String(e && e.message ? e.message : e);
  }
})();
