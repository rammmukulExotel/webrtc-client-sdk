import type { Page } from '@playwright/test';
import {
  parityClearManualConfirm,
  parityIsManualConfirmed,
  parityPromptManualConfirm,
} from './client';
import { manualTimeoutMs } from './env';

export function printInstructions(title: string, steps: string[]): void {
  const lines = [
    '',
    '════════════════════════════════════════',
    ` MANUAL: ${title}`,
    '════════════════════════════════════════',
    ...steps.map((s, i) => `  ${i + 1}. ${s}`),
    '  Waiting for automated signal or timeout…',
    '════════════════════════════════════════',
    '',
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
  try {
    testInfoAnnotate(title, steps);
  } catch {
    /* test.info may be unavailable outside a test */
  }
}

function testInfoAnnotate(title: string, steps: string[]): void {
  // Lazy require to avoid hard dependency when imported outside tests
  const { test } = require('@playwright/test');
  test.info().annotations.push({
    type: 'manual-instructions',
    description: `${title}\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
  });
}

/**
 * Print instructions and poll until `predicate` is true, or fail with instructions echoed.
 */
export async function waitWithInstructions(
  page: Page,
  title: string,
  steps: string[],
  predicate: () => Promise<boolean>,
  timeoutMs = manualTimeoutMs()
): Promise<void> {
  printInstructions(title, steps);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await page.waitForTimeout(500);
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for: ${title}\n` +
      steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
  );
}

/**
 * Show Confirm button in the harness and wait until the operator clicks it.
 * Use for true manual/hardware steps (e.g. DEV-01 headset plug).
 */
export async function waitForUserConfirm(
  page: Page,
  title: string,
  steps: string[],
  timeoutMs = manualTimeoutMs()
): Promise<void> {
  printInstructions(title, [
    ...steps,
    'Click “Confirm done” in the harness browser page when finished.',
  ]);
  await parityPromptManualConfirm(page, title, [
    ...steps,
    'Then click Confirm done below.',
  ]);
  const start = Date.now();
  try {
    while (Date.now() - start < timeoutMs) {
      const st = await parityIsManualConfirmed(page);
      if (st.confirmed) return;
      await page.waitForTimeout(300);
    }
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for user confirm: ${title}\n` +
        steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
    );
  } finally {
    await parityClearManualConfirm(page).catch(() => undefined);
  }
}
