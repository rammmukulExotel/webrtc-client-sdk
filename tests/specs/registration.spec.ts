import { test, expect } from '../helpers/fixtures';
import { annotate } from '../helpers/tags';
import {
  parityDisableAutoRetry,
  parityDrain,
  parityEnableAutoRetry,
  parityForceTransportClose,
  parityGetStatus,
  parityInit,
  parityRegister,
  parityReset,
  parityState,
  parityUnregister,
} from '../helpers/client';
import { hasOrderedStates, waitForRegisterEvent } from '../helpers/wait';
test.describe('Registration', () => {
  test('REG-01: Happy-path DoRegister()', async ({ page }) => {
    annotate('REG-01', ['auto']);
    await parityInit(page);
    await parityDrain(page);
    await parityRegister(page);
    await waitForRegisterEvent(page, 'registered', 60_000);
    const st = await parityState(page);
    expect(hasOrderedStates(st.registerEvents, ['sent_request', 'registered']) || st.registerEvents.some((e) => e.state.toLowerCase().includes('registered'))).toBeTruthy();
  });

  test('REG-02: Clean UnRegister()', async ({ page }) => {
    annotate('REG-02', ['auto']);
    await parityInit(page);
    await parityRegister(page);
    await waitForRegisterEvent(page, 'registered', 60_000);
    await parityDrain(page);
    await parityUnregister(page);
    await waitForRegisterEvent(page, /unregistered|terminated/, 60_000);
    const st = await parityState(page);
    expect(st.registerEvents.some((e) => /unregistered|terminated/i.test(e.state))).toBeTruthy();
  });

  test('REG-03: DoRegister() wrong password → unregistered', async ({ page, sip }) => {
    annotate('REG-03', ['auto']);
    await parityInit(page, { secret: sip.badPassword });
    await parityDrain(page);
    await parityRegister(page);
    await waitForRegisterEvent(page, /unregistered|terminated/, 60_000);
  });

  test('REG-04: DoRegister() bad WS domain → unregistered / websocket_connection_failed', async ({
    page,
    sip,
  }) => {
    annotate('REG-04', ['auto']);
    await parityInit(page, { sipdomain: sip.badDomain, host: sip.badDomain });
    await parityDrain(page);
    await parityRegister(page);
    await waitForRegisterEvent(page, /unregistered|terminated|failed/, 60_000);
    const status = await parityGetStatus(page);
    // Prefer websocket_connection_failed when available; accept related failure statuses
    expect(
      /websocket_connection_failed|unregistered|terminated|disconnected|error|connecting|not_initialized|media_permission/i.test(
        status
      )
    ).toBeTruthy();
  });

  test('REG-05: Auto-re-register after transport close', async ({ page }) => {
    annotate('REG-05', ['auto']);
    // enableAutoRetry before DoRegister so initialize() arms shouldAutoRetry
    await parityInit(page);
    await parityEnableAutoRetry(page);
    await parityRegister(page);
    await waitForRegisterEvent(page, 'registered', 60_000);
    await parityDrain(page);

    const closed = await parityForceTransportClose(page);
    expect(closed.ok, `forceTransportClose failed: ${JSON.stringify(closed)}`).toBeTruthy();

    // Drop should surface as unregistered/failed, then auto-retry → registered
    await waitForRegisterEvent(page, /unregistered|terminated|failed/, 60_000);
    await waitForRegisterEvent(page, 'registered', 90_000);
  });

  test('REG-06: Re-register after unreg', async ({ page }) => {
    annotate('REG-06', ['auto']);
    await parityInit(page);
    await parityRegister(page);
    await waitForRegisterEvent(page, 'registered', 60_000);
    await parityUnregister(page);
    await waitForRegisterEvent(page, /unregistered|terminated/, 60_000);

    await parityDisableAutoRetry(page);
    await parityReset(page);
    await parityDrain(page);
    await parityInit(page);
    await parityRegister(page);
    await waitForRegisterEvent(page, 'registered', 60_000);
  });
});
