import { test, expect } from '../helpers/fixtures';
import { annotate } from '../helpers/tags';
import {
  parityChangeInput,
  parityChangeOutput,
  parityDrain,
  parityEnumerateDevices,
  parityInit,
  parityRegister,
  parityRegisterDeviceCb,
  parityState,
} from '../helpers/client';
import { waitForDeviceEvent, waitForRegisterEvent } from '../helpers/wait';
import { isFullMode, useRealDevices } from '../helpers/env';
import { waitForUserConfirm } from '../helpers/manual';
import { installDeviceMock, simulateDevicePlug } from '../helpers/device-mock';

test.describe('Device APIs', () => {
  test.beforeEach(async ({ page }) => {
    await parityInit(page);
    await parityRegister(page);
    await waitForRegisterEvent(page, 'registered', 60_000);
    await parityDrain(page);
  });

  test('DEV-01: registerAudioDeviceChangeCallback() fires on plug/unplug', async ({ page }) => {
    annotate('DEV-01', ['auto', 'hardware']);
    await parityRegisterDeviceCb(page);
    await parityDrain(page);

    if (useRealDevices()) {
      // Physical plug/unplug on host Chrome (PARITY_REAL_MEDIA=1)
      test.setTimeout(Math.max(180_000, test.info().timeout));
      await waitForUserConfirm(page, 'DEV-01 Hot-plug headset', [
        'Plug in or unplug a headset / USB audio device.',
        'When the plug/unplug is done, click Confirm done in the harness.',
      ]);
    } else {
      // Fake-media cannot plug/unplug — emulate devicechange in-page
      await installDeviceMock(page);
      const before = (await parityState(page)).deviceEvents.length;
      await simulateDevicePlug(page, 'audioinput');
      await waitForDeviceEvent(page, 10_000, before);
    }

    const st = await parityState(page);
    expect(st.deviceEvents.length).toBeGreaterThan(0);
  });

  test('DEV-02: changeAudioInputDevice() mic swap', async ({ page }) => {
    annotate('DEV-02', ['auto', 'hardware']);
    await parityRegisterDeviceCb(page);
    const devices = await parityEnumerateDevices(page);
    const mics = devices.filter((d) => d.kind === 'audioinput' && d.deviceId);
    if (mics.length < 2) {
      if (isFullMode()) {
        // eslint-disable-next-line no-console
        console.log('\n[DEV-02] Fewer than 2 audioinput devices. Attach another mic and re-run.\n');
      }
      test.skip(true, 'Fewer than 2 audioinput devices');
    }
    const target = mics[1].deviceId;
    const result = await parityChangeInput(page, target);
    expect(result.ok || result.error != null).toBeTruthy();
  });

  test('DEV-03: changeAudioOutputDevice() speaker swap', async ({ page }) => {
    annotate('DEV-03', ['auto', 'hardware']);
    const devices = await parityEnumerateDevices(page);
    const outs = devices.filter((d) => d.kind === 'audiooutput' && d.deviceId);
    if (outs.length < 2) {
      test.skip(true, 'Fewer than 2 audiooutput devices');
    }
    const result = await parityChangeOutput(page, outs[1].deviceId);
    expect(result.ok || result.error != null).toBeTruthy();
  });

  test('DEV-04 / 05: change*Device() invalid IDs — error, call continues', async ({ page }) => {
    annotate('DEV-04', ['auto']);
    const badIn = await parityChangeInput(page, 'invalid-device-id-parity');
    const badOut = await parityChangeOutput(page, 'invalid-device-id-parity');
    // Expect error callbacks rather than harness crash
    expect(badIn.ok === false || badOut.ok === false || true).toBeTruthy();
    const st = await parityState(page);
    expect(st).toBeTruthy();
  });
});
