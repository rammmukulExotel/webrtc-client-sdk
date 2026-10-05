import type { Page } from '@playwright/test';

/**
 * In-page MediaDevices mock: append fake devices + fire `devicechange`.
 * Chromium fake-media flags cannot plug/unplug; this exercises the SDK listener path.
 */
export async function installDeviceMock(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __parityDeviceMock?: {
        plug: (kind?: string) => string;
        unplug: (deviceId?: string) => void;
      };
    };
    if (w.__parityDeviceMock) return;

    const md = navigator.mediaDevices;
    const origEnumerate = md.enumerateDevices.bind(md);
    let extra: Array<{
      deviceId: string;
      groupId: string;
      kind: MediaDeviceKind;
      label: string;
      toJSON: () => unknown;
    }> = [];

    w.__parityDeviceMock = {
      plug(kind = 'audioinput') {
        const k = (kind === 'audiooutput' ? 'audiooutput' : 'audioinput') as MediaDeviceKind;
        const id = `parity-mock-${k}-${Date.now()}`;
        extra.push({
          deviceId: id,
          groupId: 'parity-mock-group',
          kind: k,
          label: `Parity Mock ${k}`,
          toJSON() {
            return this;
          },
        });
        md.dispatchEvent(new Event('devicechange'));
        return id;
      },
      unplug(deviceId?: string) {
        extra = deviceId ? extra.filter((d) => d.deviceId !== deviceId) : [];
        md.dispatchEvent(new Event('devicechange'));
      },
    };

    md.enumerateDevices = async () => {
      const real = await origEnumerate();
      return [...real, ...(extra as unknown as MediaDeviceInfo[])];
    };
  });
}

export async function simulateDevicePlug(
  page: Page,
  kind: 'audioinput' | 'audiooutput' = 'audioinput'
): Promise<string> {
  return page.evaluate((k) => {
    const w = window as unknown as {
      __parityDeviceMock?: { plug: (kind?: string) => string };
    };
    if (!w.__parityDeviceMock) {
      throw new Error('Device mock not installed — call installDeviceMock first');
    }
    return w.__parityDeviceMock.plug(k);
  }, kind);
}

export async function simulateDeviceUnplug(page: Page, deviceId?: string): Promise<void> {
  await page.evaluate((id) => {
    const w = window as unknown as {
      __parityDeviceMock?: { unplug: (deviceId?: string) => void };
    };
    if (!w.__parityDeviceMock) {
      throw new Error('Device mock not installed — call installDeviceMock first');
    }
    w.__parityDeviceMock.unplug(id);
  }, deviceId);
}
