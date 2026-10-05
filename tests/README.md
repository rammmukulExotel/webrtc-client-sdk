# WebRTC SDK Parity Tests

Playwright E2E suite covering every TC-ID from **WebRTC SDK Parity Testing**. Tests drive a dedicated browser harness (`window.__parity`) that loads the SDK UMD bundle — not the sample-app UI.

## Prerequisites

1. Build the client SDK (produces `webrtc-client-sdk/dist/exotelsdk.js`):

```bash
cd ../webrtc-client-sdk
npm install
npm run build
cd ../tests
```

2. Install suite deps and browsers:

```bash
npm install
npx playwright install chromium
```

3. Configure env:

```bash
cp .env.example .env
# fill SIP_USERNAME, SIP_PASSWORD, SIP_DOMAIN, SIP_HOST, SIP_PORT
```

## Modes (`mode` env)

| Value | Behavior |
|-------|----------|
| `auto` (default) | Runs automatable checks; skips `@manual` paths that need a human when ICORE_* missing |
| `full` | Runs perceptual/manual confirm paths; prints instructions and waits |

### Media devices

- Default: Chromium `--use-fake-device-for-media-stream`. **DEV-01** emulates plug/unplug via an in-page `devicechange` mock (fake media cannot hot-plug).
- Real hardware: `PARITY_REAL_MEDIA=1` → host Chrome, headed, no fake device. **DEV-01** waits for a physical plug/unplug + Confirm in the harness.

```bash
npm run test:auto    # mode=auto
npm run test:full    # mode=full
npm run test:headed  # mode=full --headed
```

## Optional call trigger (CRM / integrationscore)

Call tests follow the **CRM sample app** flow:

1. `GET {ICORE_BASE_URL}/v2/integrations/usermapping?user_id=…` → `customer_id` + `AppID`
2. `POST {ICORE_BASE_URL}/v2/integrations/call/outbound_call` (same as `MakeCall`)

| Env | Purpose |
|-----|---------|
| `ICORE_ACCESS_TOKEN` | App access token (Authorization header as-is) — same as `ExotelCRMWebSDK(accessToken, …)` |
| `ICORE_USER_ID` | AppUserId — same as CRM `userId` |
| `ICORE_TO` | Destination PSTN (E.164, e.g. `+91XXXXXXXXXX`) |
| `ICORE_VIRTUAL_NUMBER` | Exophone for the app user (PUT usermapping if empty) |
| `ICORE_BASE_URL` | Default `https://integrationscore.mum1.exotel.com` |
| `ICORE_CUSTOMER_ID` / `ICORE_APP_ID` | Optional overrides; else from usermapping |

When ICORE_* is set, global setup syncs `SIP_*` from usermapping (same SIP UA CRM registers).

`SIP_USERNAME` / `SIP_PASSWORD` / `SIP_DOMAIN` must be that app user's SIP identity (CRM uses `{AccountSid}.voip.exotel.com` + `voip.in1.exotel.com` WSS).

Without ICORE_*:

- `mode=auto` — call/control tests that need an active call are skipped
- `mode=full` — console prints dial instructions and waits up to `PARITY_MANUAL_TIMEOUT_MS`

## Harness

- Served at `http://127.0.0.1:4173` (Playwright `webServer` → `scripts/static-server.js`)
- `npm run prepare:harness` copies `exotelsdk.js` into `harness/vendor/` (also runs as `pretest`)

## Layout

- `specs/` — one file per CSV category (INIT, REG, CALL, …)
- `helpers/` — env, client wrappers, waits, manual instructions, icore call trigger (`rest.ts`)
- `harness/` — static page + `window.__parity` API
