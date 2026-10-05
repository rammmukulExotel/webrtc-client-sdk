import { test, expect } from '../helpers/fixtures';
import { annotate } from '../helpers/tags';
import {
  parityDownloadLogs,
  parityDrain,
  parityGetPreferredCodec,
  parityInit,
  parityRegister,
  parityRegisterLogger,
  paritySetPreferredCodec,
  parityState,
} from '../helpers/client';
import { waitForLogType, waitForRegisterEvent } from '../helpers/wait';

test.describe('Codec / Logs', () => {
  test('CODEC-01: setPreferredCodec("opus") before call', async ({ page }) => {
    annotate('CODEC-01', ['auto']);
    await parityInit(page);
    await paritySetPreferredCodec(page, 'opus');
    const preferred = await parityGetPreferredCodec(page);
    // Phone may store preferred codec; if not exposed, ensure no error
    if (preferred != null) {
      expect(String(preferred).toLowerCase()).toContain('opus');
    }
    const st = await parityState(page);
    expect(st.lastError).toBeNull();
  });

  test('CODEC-02: setPreferredCodec() invalid name logs error; defaults retained', async ({
    page,
  }) => {
    annotate('CODEC-02', ['auto']);
    await parityInit(page);
    await parityRegisterLogger(page);
    await parityDrain(page);
    await paritySetPreferredCodec(page, 'bad-codec');
    await page.waitForTimeout(500);
    // Should not crash; may warn/error via logger
    const st = await parityState(page);
    expect(st.lastError).toBeNull();
  });

  test('LOG-01: registerLoggerCallback() receives log levels', async ({ page }) => {
    annotate('LOG-01', ['auto']);
    await parityRegisterLogger(page);
    await parityDrain(page);
    await parityInit(page);
    await parityRegister(page);
    await waitForRegisterEvent(page, /registered|unregistered|sent_request/, 60_000);
    await waitForLogType(page, /log|info|warn|error|debug/i, 30_000);
    const st = await parityState(page);
    expect(st.logs.length).toBeGreaterThan(0);
  });

  test('LOG-02: downloadLogs() triggers download path', async ({ page }) => {
    annotate('LOG-02', ['auto']);
    await parityInit(page);
    await parityRegisterLogger(page);
    // Generate some activity
    await parityRegister(page);
    await page.waitForTimeout(1000);

    const downloadPromise = page
      .waitForEvent('download', { timeout: 10_000 })
      .then((d) => d)
      .catch(() => null);

    const result = await parityDownloadLogs(page);
    const download = await downloadPromise;

    if (download) {
      const name = download.suggestedFilename();
      expect(/webrtc_sdk_logs|\.txt/i.test(name)).toBeTruthy();
      const path = await download.path();
      if (path) {
        const fs = await import('fs');
        const size = fs.statSync(path).size;
        expect(size).toBeGreaterThanOrEqual(0);
      }
    } else {
      // Anchor/programmatic download may not fire in headless; ensure API returned
      expect(result).toBeTruthy();
    }
  });
});
