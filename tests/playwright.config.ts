import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { useRealDevices } from './helpers/env';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const baseURL = process.env.PARITY_BASE_URL || 'http://127.0.0.1:4173';
const realMedia = useRealDevices();
const headed =
  realMedia || (process.env.mode === 'full' && process.env.HEADED === '1');

export default defineConfig({
  globalSetup: require.resolve('./helpers/global-setup.ts'),
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    headless: !headed,
    permissions: ['microphone', 'camera'],
    launchOptions: {
      // Real devices: host Chrome, no fake device (still auto-accept permission UI)
      ...(realMedia ? { channel: 'chrome' as const } : {}),
      args: [
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        ...(realMedia ? [] : ['--use-fake-device-for-media-stream']),
      ],
    },
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node scripts/static-server.js',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
