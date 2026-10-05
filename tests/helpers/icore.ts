import crypto from 'crypto';
import { hasIcoreConfig, loadIcoreConfig, type SipConfig } from './env';

/** Same key as CRM WebSDK Constants.publicKey */
const SIP_SECRET_KEY_HEX =
  '6368616e676520746869732070617373776f726420746f206120736563726574';

export type UserMapping = {
  customerId: string;
  appId: string;
  userId: string;
  accountSid: string;
  sipId: string;
  sipUserName: string;
  sipSecretEnc: string;
  displayName: string;
  virtualNumber: string;
};

function icoreHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: accessToken,
    'Content-Type': 'application/json',
  };
}

/** Decrypt SipSecret the same way as CRM WebSDK User.sipSecret */
export function decryptSipSecret(ciphertext: string): string {
  const key = Buffer.from(SIP_SECRET_KEY_HEX, 'hex');
  const iv = Buffer.from(ciphertext.substring(0, 32), 'hex');
  const encrypted = Buffer.from(ciphertext.substring(32), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cfb', key, iv);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return plain.toString('utf8').replace(/\0+$/g, '');
}

/**
 * GET /v2/integrations/usermapping?user_id=… (CRM Initialize path).
 */
export async function fetchUserMapping(): Promise<UserMapping> {
  const cfg = loadIcoreConfig();
  const base = cfg.baseUrl.replace(/\/$/, '');
  const url = `${base}/v2/integrations/usermapping?user_id=${encodeURIComponent(cfg.userId)}`;
  const res = await fetch(url, { method: 'GET', headers: icoreHeaders(cfg.accessToken) });
  const body = (await res.json()) as {
    Code?: number;
    Data?: Record<string, unknown>;
    Error?: unknown;
  };

  if (res.status === 404) {
    throw new Error(`integrationscore usermapping not found for user_id=${cfg.userId}`);
  }
  if (!res.ok || (body.Code != null && body.Code >= 400)) {
    throw new Error(
      `integrationscore usermapping failed ${res.status}: ${JSON.stringify(body.Error ?? body)}`
    );
  }

  const d = body.Data || {};
  // API returns PascalCase; CRM SDK historically expected mixed snake/Pascal
  const customerId = String(d.CustomerId ?? d.customer_id ?? cfg.customerId ?? '');
  const appId = String(d.AppID ?? d.app_id ?? cfg.appId ?? '');
  const userId = String(d.AppUserId ?? d.app_user_id ?? cfg.userId);
  const accountSid = String(d.ExotelAccountSid ?? '');
  const sipId = String(d.SipId ?? '');
  const sipSecretEnc = String(d.SipSecret ?? '');
  const displayName = String(d.ExotelUserName ?? d.AppUsername ?? userId);
  const virtualNumber = String(d.VirtualNumber ?? d.virtual_number ?? '').trim();

  if (!customerId || !appId) {
    throw new Error(
      `integrationscore usermapping missing CustomerId/AppID: ${JSON.stringify(d)}`
    );
  }
  if (!sipId || !sipSecretEnc) {
    throw new Error(`integrationscore usermapping missing SipId/SipSecret: ${JSON.stringify(d)}`);
  }

  const sipUserName = sipId.includes(':') ? sipId.split(':')[1] : sipId;
  return {
    customerId,
    appId,
    userId,
    accountSid,
    sipId,
    sipUserName,
    sipSecretEnc,
    displayName,
    virtualNumber,
  };
}

/** Build SIP config matching CRM WebSDK #getSIPInfo() */
export function sipConfigFromMapping(m: UserMapping): SipConfig {
  const secret = decryptSipSecret(m.sipSecretEnc);
  if (!secret) {
    throw new Error('Failed to decrypt SipSecret from usermapping');
  }
  return {
    userName: m.sipUserName,
    secret,
    sipdomain: m.accountSid
      ? `${m.accountSid}.voip.exotel.com`
      : process.env.SIP_DOMAIN || '',
    host: 'voip.in1.exotel.com',
    port: '443',
    displayname: m.displayName,
    security: 'wss',
    endpoint: 'wss',
    badPassword: process.env.SIP_BAD_PASSWORD || 'definitely-wrong-password',
    badDomain: process.env.SIP_BAD_DOMAIN || 'invalid.example.invalid',
  };
}

/** PUT usermapping VirtualNumber (Exophone used by outbound_call). */
export async function putVirtualNumber(virtualNumber: string): Promise<void> {
  const cfg = loadIcoreConfig();
  const base = cfg.baseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/v2/integrations/usermapping`, {
    method: 'PUT',
    headers: icoreHeaders(cfg.accessToken),
    body: JSON.stringify({ AppUserId: cfg.userId, VirtualNumber: virtualNumber }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`integrationscore PUT usermapping VirtualNumber failed ${res.status}: ${text}`);
  }
}

/**
 * When ICORE_* is set, overlay process.env SIP_* from usermapping
 * so the harness registers the same UA CRM MakeCall will dial.
 */
export async function syncSipEnvFromIcore(): Promise<UserMapping | null> {
  if (!hasIcoreConfig()) return null;

  let m = await fetchUserMapping();
  const desiredVn = process.env.ICORE_VIRTUAL_NUMBER?.trim();
  if (desiredVn && desiredVn !== m.virtualNumber) {
    await putVirtualNumber(desiredVn);
    m = await fetchUserMapping();
  }
  if (!m.virtualNumber) {
    throw new Error(
      '[parity] usermapping.VirtualNumber is empty — set ICORE_VIRTUAL_NUMBER (Exophone) in .env'
    );
  }

  const sip = sipConfigFromMapping(m);
  process.env.SIP_USERNAME = sip.userName;
  process.env.SIP_PASSWORD = sip.secret;
  process.env.SIP_DOMAIN = sip.sipdomain;
  process.env.SIP_HOST = sip.host;
  process.env.SIP_PORT = sip.port;
  process.env.SIP_DISPLAY_NAME = sip.displayname;
  process.env.SIP_SECURITY = sip.security;
  process.env.SIP_ENDPOINT = sip.endpoint;
  return m;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isDeviceBusy(status: number, body: string): boolean {
  return status === 404 && /User device is currently busy|10706/i.test(body);
}

export async function placeOutboundCall(to?: string): Promise<unknown> {
  const cfg = loadIcoreConfig();
  const m = await fetchUserMapping();
  if (!m.virtualNumber) {
    throw new Error(
      '[parity] usermapping.VirtualNumber empty — outbound_call needs Exophone; set ICORE_VIRTUAL_NUMBER'
    );
  }
  const base = cfg.baseUrl.replace(/\/$/, '');
  const url = `${base}/v2/integrations/call/outbound_call`;
  const payload = {
    customer_id: m.customerId,
    app_id: m.appId,
    to: to || cfg.to,
    user_id: m.userId,
  };

  const maxAttempts = 5;
  let lastText = '';
  let lastStatus = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: icoreHeaders(cfg.accessToken),
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return res.json().catch(() => ({}));
    }
    lastStatus = res.status;
    lastText = await res.text();
    if (isDeviceBusy(lastStatus, lastText) && attempt < maxAttempts) {
      await sleep(3000 * attempt);
      continue;
    }
    break;
  }
  throw new Error(`integrationscore outbound_call failed ${lastStatus}: ${lastText}`);
}
