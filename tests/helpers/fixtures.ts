import { test as base, expect } from '@playwright/test';
import { loadSipConfig, type SipConfig } from './env';
import { openHarness, parityDrain, parityReset } from './client';

type Fixtures = {
  sip: SipConfig;
};

export const test = base.extend<Fixtures>({
  sip: async ({}, use) => {
    const sip = loadSipConfig();
    await use(sip);
  },
  page: async ({ page }, use) => {
    await openHarness(page);
    await parityReset(page);
    await parityDrain(page);
    await use(page);
    try {
      await parityReset(page);
    } catch {
      /* page may already be closed */
    }
  },
});

export { expect };
