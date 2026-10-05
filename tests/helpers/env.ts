export type SipConfig = {
  userName: string;
  secret: string;
  sipdomain: string;
  host: string;
  port: string;
  displayname: string;
  security: string;
  endpoint: string;
  badPassword: string;
  badDomain: string;
};

/**
 * CRM sample MakeCall inputs.
 * customer_id / app_id are optional — resolved via usermapping when omitted (same as CRM WebSDK).
 */
export type IcoreConfig = {
  accessToken: string;
  userId: string;
  to: string;
  baseUrl: string;
  customerId?: string;
  appId?: string;
};

function req(name: string): string {
  const v = process.env[name];
  if (v == null || String(v).trim() === '') {
    throw new Error(
      `[parity] Missing required env var ${name}. Copy .env.example → .env and fill credentials.`
    );
  }
  return String(v).trim();
}

function opt(name: string, fallback = ''): string {
  const v = process.env[name];
  return v == null || String(v).trim() === '' ? fallback : String(v).trim();
}

export function getMode(): 'auto' | 'full' {
  const m = (process.env.mode || 'auto').toLowerCase();
  return m === 'full' ? 'full' : 'auto';
}

export function isAutoMode(): boolean {
  return getMode() === 'auto';
}

export function isFullMode(): boolean {
  return getMode() === 'full';
}

/**
 * Use host Chrome + real mic/speakers (no --use-fake-device-for-media-stream).
 * Set PARITY_REAL_MEDIA=1. Implies headed for reliable device access.
 */
export function useRealDevices(): boolean {
  const v = (process.env.PARITY_REAL_MEDIA || process.env.USE_REAL_DEVICES || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function manualTimeoutMs(): number {
  const n = Number(process.env.PARITY_MANUAL_TIMEOUT_MS || 120000);
  return Number.isFinite(n) && n > 0 ? n : 120000;
}

export function loadSipConfig(): SipConfig {
  return {
    userName: req('SIP_USERNAME'),
    secret: req('SIP_PASSWORD'),
    sipdomain: req('SIP_DOMAIN'),
    host: req('SIP_HOST'),
    port: req('SIP_PORT'),
    displayname: opt('SIP_DISPLAY_NAME', process.env.SIP_USERNAME || ''),
    security: opt('SIP_SECURITY', 'wss'),
    // Match CRM WebSDK default (wss://host:port/wss)
    endpoint: opt('SIP_ENDPOINT', 'wss'),
    badPassword: opt('SIP_BAD_PASSWORD', 'definitely-wrong-password'),
    badDomain: opt('SIP_BAD_DOMAIN', 'invalid.example.invalid'),
  };
}

export function hasIcoreConfig(): boolean {
  const filled = (name: string) => Boolean(process.env[name]?.trim());
  return filled('ICORE_ACCESS_TOKEN') && filled('ICORE_USER_ID') && filled('ICORE_TO');
}

/** @deprecated use hasIcoreConfig */
export function hasRestConfig(): boolean {
  return hasIcoreConfig();
}

export function loadIcoreConfig(): IcoreConfig {
  if (!hasIcoreConfig()) {
    throw new Error(
      '[parity] ICORE_* env incomplete (need ACCESS_TOKEN, USER_ID, TO)'
    );
  }
  const customerId = opt('ICORE_CUSTOMER_ID');
  const appId = opt('ICORE_APP_ID');
  return {
    accessToken: req('ICORE_ACCESS_TOKEN'),
    userId: req('ICORE_USER_ID'),
    to: req('ICORE_TO'),
    baseUrl: opt('ICORE_BASE_URL', 'https://integrationscore.mum1.exotel.com'),
    ...(customerId ? { customerId } : {}),
    ...(appId ? { appId } : {}),
  };
}

/** @deprecated use loadIcoreConfig */
export function loadRestConfig(): IcoreConfig {
  return loadIcoreConfig();
}

export function sipDefaultsPayload(sip: SipConfig) {
  return {
    userName: sip.userName,
    secret: sip.secret,
    sipdomain: sip.sipdomain,
    host: sip.host,
    port: sip.port,
    displayname: sip.displayname,
    security: sip.security,
    endpoint: sip.endpoint,
  };
}
