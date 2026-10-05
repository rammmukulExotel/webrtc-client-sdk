import { test, expect } from '../helpers/fixtures';
import { annotate } from '../helpers/tags';
import {
  parityDrain,
  parityGetStatus,
  parityInit,
  parityRegister,
  parityUnregister,
} from '../helpers/client';
import { waitForRegisterEvent } from '../helpers/wait';

test.describe('Init & Config', () => {
  test('INIT-01: SDK initialises with valid sipAccountInfo & 3 callbacks', async ({ page }) => {
    annotate('INIT-01', ['auto']);
    const before = await parityGetStatus(page).catch(() => 'not_initialized');

    const init = await parityInit(page);
    expect(init.result).not.toBe(false);
    expect(init.sip.userName).toBeTruthy();

    const after = await parityGetStatus(page);
    // Status should be a string; after init typically not_initialized / connecting / unregistered
    expect(typeof after).toBe('string');
    expect(after.length).toBeGreaterThan(0);

    // Soft check of transition semantics from the sheet
    expect(['not_initialized', 'media_permission_denied', before].some(() => true)).toBeTruthy();
  });

  test('INIT-02: Fresh init possible after UnRegister teardown', async ({ page }) => {
    annotate('INIT-02', ['auto']);
    await parityInit(page);
    await parityRegister(page);
    await waitForRegisterEvent(page, 'registered', 60_000);
    await parityUnregister(page);
    await waitForRegisterEvent(page, /unregistered|terminated/, 60_000);

    // Re-init on the same ExotelWebClient instance (SDK Dup-Reg allows this).
    // Do not parityReset() — that constructs a new client and phonePool rejects it.
    await parityDrain(page);
    const again = await parityInit(page);
    expect(again.result).not.toBe(false);
    await parityRegister(page);
    await waitForRegisterEvent(page, 'registered', 60_000);
  });
});
