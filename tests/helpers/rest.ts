import { hasIcoreConfig, isFullMode, isAutoMode } from './env';
import { placeOutboundCall } from './icore';
import { printInstructions, waitWithInstructions } from './manual';
import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import { waitForCallEvent } from './wait';

/**
 * Place a call the same way as the CRM sample app MakeCall:
 * POST integrationscore /v2/integrations/call/outbound_call
 */
export async function triggerOutboundCall(): Promise<boolean> {
  if (!hasIcoreConfig()) return false;
  await placeOutboundCall();
  return true;
}

/**
 * Ensure an inbound call arrives on the registered SDK leg.
 * Uses CRM MakeCall (icore outbound) when configured; otherwise manual / skip.
 */
export async function ensureIncomingCall(page: Page, title: string): Promise<void> {
  if (hasIcoreConfig()) {
    await triggerOutboundCall();
    // Click-to-call rings the agent SIP UA first → SDK sees "incoming"
    await waitForCallEvent(page, 'incoming', 90_000);
    return;
  }

  if (isAutoMode()) {
    test.skip(
      true,
      '[mode=auto] skipped @manual: No ICORE_* env; cannot place call via integrationscore'
    );
  }

  await waitWithInstructions(
    page,
    title,
    [
      'Keep this browser tab focused (SDK is registered).',
      'Place an inbound SIP/PSTN call to the registered UA (or trigger CRM MakeCall).',
      'Wait until the harness shows an incoming call event.',
    ],
    async () => {
      try {
        await waitForCallEvent(page, 'incoming', 2_000);
        return true;
      } catch {
        return false;
      }
    }
  );
}

/**
 * For CALL-OUT: same CRM MakeCall path; wait for ringing/incoming/connected.
 */
export async function ensureOutboundWebSdkLeg(page: Page): Promise<void> {
  if (hasIcoreConfig()) {
    await triggerOutboundCall();
  } else if (isFullMode()) {
    printInstructions('CALL-OUT-01 Place outbound via CRM MakeCall / UI', [
      'Trigger an outbound call for this registered app user (integrationscore outbound_call).',
      'Answer the far end if needed so the SDK sees ringing/connected.',
    ]);
  } else {
    test.skip(true, '[mode=auto] skipped @manual: No ICORE_* env for CALL-OUT-01');
  }
  await waitForCallEvent(page, /ringing|incoming|connected/, 90_000);
}
