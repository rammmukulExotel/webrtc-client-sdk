import type { Page } from '@playwright/test';
import { loadSipConfig, sipDefaultsPayload, type SipConfig } from './env';

export type ParityState = {
  registerEvents: Array<{ state: string; phone: unknown; ts?: number }>;
  callEvents: Array<{ eventType: string; callId: string | null; phone: unknown; ts?: number }>;
  sessionEvents: Array<{ state: string; phone: unknown; ts?: number }>;
  logs: Array<{ type: string; message: string; args: unknown; ts?: number }>;
  diagKeys: Array<{ key: string; status: unknown; desc: unknown; ts?: number }>;
  diagReports: Array<{ report: unknown; ts?: number }>;
  deviceEvents: Array<{ type: string; id?: unknown; info?: unknown; ts?: number }>;
  lastError: string | null;
  initResult: unknown;
  downloadTriggered: boolean;
};

async function api<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ({ method: m, args: a }) => {
      const h = (window as unknown as { __parity: Record<string, (...x: unknown[]) => unknown> }).__parity;
      if (!h) throw new Error('window.__parity missing');
      const fn = h[m];
      if (typeof fn !== 'function') throw new Error(`__parity.${m} is not a function`);
      return fn.apply(h, a) as T;
    },
    { method, args }
  );
}

export async function openHarness(page: Page, sip?: SipConfig): Promise<void> {
  const cfg = sip || loadSipConfig();
  await page.goto('/');
  await page.waitForFunction(() => {
    const w = window as unknown as { __parity?: { ready: () => boolean }; __parityLoadError?: string };
    if (w.__parityLoadError) throw new Error(w.__parityLoadError);
    return !!(w.__parity && w.__parity.ready());
  });
  await api(page, 'setSipDefaults', sipDefaultsPayload(cfg));
}

export async function parityState(page: Page): Promise<ParityState> {
  return api<ParityState>(page, 'getState');
}

export async function parityReset(page: Page): Promise<void> {
  await api(page, 'reset');
}

export async function parityDrain(page: Page): Promise<void> {
  await api(page, 'drainEvents');
}

export async function parityInit(page: Page, overrides?: Record<string, unknown>) {
  return api<{ result: unknown; sip: Record<string, string> }>(page, 'init', overrides || {});
}

export async function parityRegister(page: Page) {
  return api<boolean>(page, 'register');
}

export async function parityUnregister(page: Page) {
  return api(page, 'unregister');
}

export async function parityEnableAutoRetry(page: Page) {
  return api(page, 'enableAutoRetry');
}

export async function parityDisableAutoRetry(page: Page) {
  return api(page, 'disableAutoRetry');
}

export async function parityGetStatus(page: Page) {
  return api<string>(page, 'getStatus');
}

export async function parityGetCall(page: Page) {
  return api<{ exists: boolean; callId: string | null; details: unknown }>(page, 'getCall');
}

export async function parityGetCallRefs(page: Page) {
  return api<{ sameRef: boolean; callIdA: string | null; callIdB: string | null }>(page, 'getCallRefs');
}

export async function parityAnswer(page: Page) {
  return api<{ ok: boolean; error?: string }>(page, 'answer');
}

export async function parityHangup(page: Page) {
  return api<{ ok: boolean; error?: string }>(page, 'hangup');
}

export async function parityMute(page: Page) {
  return api<{ muted: boolean | null }>(page, 'mute');
}

export async function parityUnmute(page: Page) {
  return api<{ muted: boolean | null }>(page, 'unmute');
}

export async function parityHold(page: Page) {
  return api<{ onHold: boolean | null }>(page, 'hold');
}

export async function parityUnhold(page: Page) {
  return api<{ onHold: boolean | null }>(page, 'unhold');
}

export async function parityGetHoldStatus(page: Page) {
  return api<boolean | null>(page, 'getHoldStatus');
}

export type MediaStatus = {
  ready: boolean;
  established: boolean;
  liveRemoteTracks: number;
  receiverLive: number;
  ice: string | null;
  audioElements: number;
  callEstablishedTime: string | null;
  callState: string | null;
};

export async function parityMediaStatus(page: Page) {
  return api<MediaStatus>(page, 'mediaStatus');
}

export async function parityPromptManualConfirm(page: Page, title: string, steps: string[]) {
  return api<{ ok: boolean }>(page, 'promptManualConfirm', title, steps);
}

export async function parityIsManualConfirmed(page: Page) {
  return api<{ pending: boolean; confirmed: boolean; title: string }>(page, 'isManualConfirmed');
}

export async function parityClearManualConfirm(page: Page) {
  return api<{ ok: boolean }>(page, 'clearManualConfirm');
}

export async function paritySendDTMF(page: Page, digit: string) {
  return api<{ ok: boolean; error?: string }>(page, 'sendDTMF', digit);
}

export async function paritySessionListener(page: Page) {
  return api<{ ok: boolean; error?: string }>(page, 'sessionListener');
}

export async function parityInitDiagnostics(page: Page) {
  return api(page, 'initDiagnostics');
}

export async function parityCloseDiagnostics(page: Page) {
  return api(page, 'closeDiagnostics');
}

export async function parityStartSpeaker(page: Page) {
  return api(page, 'startSpeakerDiagnosticsTest');
}

export async function parityStopSpeaker(page: Page, response = 'yes') {
  return api(page, 'stopSpeakerDiagnosticsTest', response);
}

export async function parityStartMic(page: Page) {
  return api(page, 'startMicDiagnosticsTest');
}

export async function parityStopMic(page: Page, response = 'yes') {
  return api(page, 'stopMicDiagnosticsTest', response);
}

export async function parityStartNetwork(page: Page) {
  return api(page, 'startNetworkDiagnostics');
}

export async function parityStopNetwork(page: Page) {
  return api(page, 'stopNetworkDiagnostics');
}

export async function parityRegisterDeviceCb(page: Page) {
  return api(page, 'registerAudioDeviceChangeCallback');
}

export async function parityEnumerateDevices(page: Page) {
  return api<Array<{ deviceId: string; kind: string; label: string }>>(page, 'enumerateDevices');
}

export async function parityChangeInput(page: Page, deviceId: string) {
  return api<{ ok: boolean; error?: string }>(page, 'changeAudioInputDevice', deviceId);
}

export async function parityChangeOutput(page: Page, deviceId: string) {
  return api<{ ok: boolean; error?: string }>(page, 'changeAudioOutputDevice', deviceId);
}

export async function paritySetPreferredCodec(page: Page, codec: string) {
  return api(page, 'setPreferredCodec', codec);
}

export async function parityRegisterLogger(page: Page) {
  return api(page, 'registerLoggerCallback');
}

export async function parityDownloadLogs(page: Page) {
  return api<{ downloadTriggered: boolean }>(page, 'downloadLogs');
}

export async function parityForceTransportClose(page: Page) {
  return api<{ ok: boolean; method?: string; error?: string }>(page, 'forceTransportClose');
}

export async function parityGetPreferredCodec(page: Page) {
  return api<string | null>(page, 'getPreferredCodecFromPhone');
}
