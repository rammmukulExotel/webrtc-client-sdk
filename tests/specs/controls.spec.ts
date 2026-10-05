import { test, expect } from '../helpers/fixtures';
import { annotate } from '../helpers/tags';
import {
  parityAnswer,
  parityDrain,
  parityHangup,
  parityHold,
  parityInit,
  parityMute,
  parityRegister,
  paritySendDTMF,
  parityState,
  parityUnhold,
  parityUnmute,
} from '../helpers/client';
import {
  waitForCallEvent,
  waitForHoldStatus,
  waitForMediaUp,
  waitForRegisterEvent,
} from '../helpers/wait';
import { ensureIncomingCall } from '../helpers/rest';
import { isFullMode } from '../helpers/env';
import { waitWithInstructions } from '../helpers/manual';

async function connectedCall(page: import('@playwright/test').Page) {
  await parityInit(page);
  await parityRegister(page);
  await waitForRegisterEvent(page, 'registered', 60_000);
  await parityDrain(page);
  await ensureIncomingCall(page, 'Active call setup');
  await parityAnswer(page);
  await waitForCallEvent(page, 'connected', 60_000);
}

test.describe('In-Call Controls', () => {
  test('CTRL-01: Mute() / UnMute()', async ({ page }) => {
    annotate('CTRL-01', ['auto', 'audio-perception']);
    await connectedCall(page);
    const muted = await parityMute(page);
    if (muted.muted != null) expect(muted.muted).toBeTruthy();

    if (isFullMode()) {
      await waitWithInstructions(
        page,
        'CTRL-01 Remote hears silence',
        ['Confirm remote hears silence while muted.'],
        async () => true,
        2000
      );
    }

    await page.waitForTimeout(500);
    const unmuted = await parityUnmute(page);
    if (unmuted.muted != null) expect(unmuted.muted).toBeFalsy();
    await parityHangup(page);
  });

  test('CTRL-02: Hold() / UnHold()', async ({ page }) => {
    annotate('CTRL-02', ['auto', 'audio-perception']);
    await connectedCall(page);
    // Hold needs established media / live remote tracks — connected alone is early
    await waitForMediaUp(page, 60_000);
    await parityHold(page);
    await waitForHoldStatus(page, true, 20_000);
    await page.waitForTimeout(1000);
    await parityUnhold(page);
    await waitForHoldStatus(page, false, 20_000);
    await parityHangup(page);
  });

  test('CTRL-03: sendDTMF("2")', async ({ page }) => {
    annotate('CTRL-03', ['auto', 'manual']);
    await connectedCall(page);
    const result = await paritySendDTMF(page, '2');
    expect(result.ok).toBeTruthy();

    if (isFullMode()) {
      await waitWithInstructions(
        page,
        'CTRL-03 IVR reacts to DTMF 2',
        ['If connected to an IVR, confirm it reacted to digit 2.'],
        async () => true,
        3000
      );
    }

    await parityHangup(page);
  });

  test('CTRL-04–07: Edge-idempotence on Mute/Hold', async ({ page }) => {
    annotate('CTRL-04', ['auto']);
    await connectedCall(page);
    await parityMute(page);
    await parityMute(page); // already muted
    await parityHold(page);
    await parityHold(page); // already held
    await parityUnmute(page);
    await parityUnmute(page); // already unmuted
    await parityUnhold(page);
    await parityUnhold(page); // already unheld
    const st = await parityState(page);
    expect(st.lastError).toBeNull();
    await parityHangup(page);
  });

  test('CTRL-08: sendDTMF() invalid digit', async ({ page }) => {
    annotate('CTRL-08', ['auto']);
    await connectedCall(page);
    await paritySendDTMF(page, '');
    await paritySendDTMF(page, 'x');
    const st = await parityState(page);
    // No crash required
    expect(st).toBeTruthy();
    await parityHangup(page);
  });
});
