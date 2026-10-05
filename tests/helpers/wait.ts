import type { Page } from '@playwright/test';
import { parityGetHoldStatus, parityMediaStatus, parityState } from './client';

export async function waitForRegisterEvent(
  page: Page,
  expected: string | RegExp,
  timeoutMs = 60_000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = await parityState(page);
    const hit = st.registerEvents.some((e) => match(e.state, expected));
    if (hit) return;
    await page.waitForTimeout(250);
  }
  const st = await parityState(page);
  throw new Error(
    `Timeout waiting for register event ${expected}. Got: ${JSON.stringify(st.registerEvents)}`
  );
}

export async function waitForCallEvent(
  page: Page,
  expected: string | RegExp,
  timeoutMs = 90_000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = await parityState(page);
    const hit = st.callEvents.some((e) => match(e.eventType, expected));
    if (hit) return;
    await page.waitForTimeout(250);
  }
  const st = await parityState(page);
  throw new Error(
    `Timeout waiting for call event ${expected}. Got: ${JSON.stringify(st.callEvents)}`
  );
}

export async function waitForDiagKey(
  page: Page,
  key: string,
  timeoutMs = 30_000
): Promise<{ key: string; status: unknown; desc: unknown }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = await parityState(page);
    const hit = st.diagKeys.find((k) => k.key === key);
    if (hit) return hit;
    await page.waitForTimeout(250);
  }
  throw new Error(`Timeout waiting for diag key ${key}`);
}

export async function waitForDeviceEvent(
  page: Page,
  timeoutMs = 60_000,
  /** Snapshot length before the action that should produce an event (avoids races). */
  beforeCount?: number
): Promise<void> {
  const start = Date.now();
  const before =
    beforeCount != null ? beforeCount : (await parityState(page)).deviceEvents.length;
  while (Date.now() - start < timeoutMs) {
    const st = await parityState(page);
    if (st.deviceEvents.length > before) return;
    await page.waitForTimeout(250);
  }
  throw new Error(
    `Timeout waiting for device change event (before=${before}, last=${
      (await parityState(page)).deviceEvents.length
    })`
  );
}

export async function waitForLogType(
  page: Page,
  type: string | RegExp,
  timeoutMs = 30_000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = await parityState(page);
    if (st.logs.some((l) => match(l.type, type) || match(l.message, type))) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`Timeout waiting for log matching ${type}`);
}

/** Wait until remote/local media looks established (needed before Hold). */
export async function waitForMediaUp(page: Page, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  let last: unknown = null;
  while (Date.now() - start < timeoutMs) {
    const st = await parityMediaStatus(page);
    last = st;
    if (st.ready) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`Timeout waiting for media up. Last status: ${JSON.stringify(last)}`);
}

/** Hold/UnHold is async (re-INVITE) — poll getHoldStatus. */
export async function waitForHoldStatus(
  page: Page,
  expected: boolean,
  timeoutMs = 20_000
): Promise<void> {
  const start = Date.now();
  let last: boolean | null = null;
  while (Date.now() - start < timeoutMs) {
    last = await parityGetHoldStatus(page);
    if (last === expected) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`Timeout waiting for hold=${expected}. Last: ${last}`);
}

function match(value: string, expected: string | RegExp): boolean {
  if (typeof expected === 'string') {
    return value.toLowerCase() === expected.toLowerCase() || value.toLowerCase().includes(expected.toLowerCase());
  }
  return expected.test(value);
}

/** Assert register callback chain contains ordered subsequence */
export function hasOrderedStates(events: Array<{ state: string }>, ordered: string[]): boolean {
  let i = 0;
  for (const e of events) {
    if (e.state.toLowerCase().includes(ordered[i].toLowerCase())) {
      i += 1;
      if (i >= ordered.length) return true;
    }
  }
  return false;
}
