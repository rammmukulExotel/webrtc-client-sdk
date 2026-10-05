import { test } from '@playwright/test';
import { isAutoMode } from './env';

/** Tags that are skipped when mode=auto */
export type SkipTag = 'manual' | 'hardware' | 'audio-perception';

/**
 * Skip the current test in mode=auto when it needs human/hardware interaction.
 * Call at the start of the test body.
 */
export function skipInAuto(tag: SkipTag, reason: string): void {
  test.skip(isAutoMode(), `[mode=auto] skipped @${tag}: ${reason}`);
}

export function annotate(tcId: string, tags: Array<'auto' | SkipTag> = ['auto']): void {
  test.info().annotations.push({ type: 'tc-id', description: tcId });
  for (const t of tags) {
    test.info().annotations.push({ type: 'tag', description: t });
  }
}
