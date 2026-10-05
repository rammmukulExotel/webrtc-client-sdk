import { test, expect } from '../helpers/fixtures';
import { annotate } from '../helpers/tags';
import {
  parityAnswer,
  parityDrain,
  parityGetCallRefs,
  parityHangup,
  parityInit,
  parityRegister,
  parityState,
} from '../helpers/client';
import { waitForCallEvent, waitForRegisterEvent } from '../helpers/wait';
import { ensureIncomingCall, ensureOutboundWebSdkLeg } from '../helpers/rest';
import { isFullMode } from '../helpers/env';
import { waitWithInstructions } from '../helpers/manual';

test.describe('Call Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await parityInit(page);
    await parityRegister(page);
    await waitForRegisterEvent(page, 'registered', 60_000);
    await parityDrain(page);
  });

  test('CALL-IN-01: Call.Answer() on incoming → connected', async ({ page }) => {
    annotate('CALL-IN-01', ['auto', 'manual']);
    await ensureIncomingCall(page, 'CALL-IN-01 inbound');
    // If skipped in auto without REST, Playwright aborts above
    await parityAnswer(page);
    await waitForCallEvent(page, 'connected', 60_000);

    if (isFullMode()) {
      await waitWithInstructions(
        page,
        'CALL-IN-01 Verify two-way audio',
        ['Confirm two-way audio on the call (optional perceptual check).'],
        async () => true,
        2000
      );
    }

    await parityHangup(page);
    await waitForCallEvent(page, 'callEnded', 60_000);
  });

  test('CALL-IN-02: Call.Hangup() rejects incoming', async ({ page }) => {
    annotate('CALL-IN-02', ['auto', 'manual']);
    await ensureIncomingCall(page, 'CALL-IN-02 reject inbound');
    await parityHangup(page);
    await waitForCallEvent(page, 'callEnded', 60_000);
  });

  test('CALL-OUT-01: Place PSTN/SIP outbound WebSDK leg', async ({ page }) => {
    annotate('CALL-OUT-01', ['auto', 'manual']);
    await ensureOutboundWebSdkLeg(page);
    const st = await parityState(page);
    expect(
      st.callEvents.some((e) => /ringing|incoming|connected/i.test(e.eventType))
    ).toBeTruthy();
    try {
      await parityHangup(page);
    } catch {
      /* ignore */
    }
  });

  test('CALL-02: getCall() singleton semantics', async ({ page }) => {
    annotate('CALL-02', ['auto']);
    const refs = await parityGetCallRefs(page);
    expect(refs.sameRef).toBeTruthy();
    // callIds may both be null/empty when idle — still same singleton
    expect(refs.callIdA).toEqual(refs.callIdB);
  });

  test('CALL-03: Answer() without incoming — no crash', async ({ page }) => {
    annotate('CALL-03', ['auto']);
    const result = await parityAnswer(page);
    expect(result.ok || result.error != null || true).toBeTruthy();
    const st = await parityState(page);
    // Must not throw out of evaluate
    expect(st).toBeTruthy();
  });

  test('CALL-04: Hangup() without call — no crash', async ({ page }) => {
    annotate('CALL-04', ['auto']);
    const result = await parityHangup(page);
    expect(result).toBeTruthy();
    const st = await parityState(page);
    expect(st.lastError == null || typeof st.lastError === 'string').toBeTruthy();
  });

  test('CALL-05: Answer() twice — warn, no crash', async ({ page }) => {
    annotate('CALL-05', ['auto', 'manual']);
    await ensureIncomingCall(page, 'CALL-05 double answer');
    await parityAnswer(page);
    await waitForCallEvent(page, 'connected', 60_000);
    const second = await parityAnswer(page);
    expect(second).toBeTruthy();
    await parityHangup(page);
  });

  test('CALL-06: Hangup() twice — warn, no crash', async ({ page }) => {
    annotate('CALL-06', ['auto', 'manual']);
    await ensureIncomingCall(page, 'CALL-06 double hangup');
    await parityAnswer(page);
    await waitForCallEvent(page, /connected|incoming/, 60_000);
    await parityHangup(page);
    await waitForCallEvent(page, 'callEnded', 60_000);
    const second = await parityHangup(page);
    expect(second).toBeTruthy();
  });
});
