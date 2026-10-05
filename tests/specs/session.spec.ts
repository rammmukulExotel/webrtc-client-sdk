import { test, expect } from '../helpers/fixtures';
import { annotate } from '../helpers/tags';
import { parityInit, paritySessionListener, parityState } from '../helpers/client';

test.describe('Session Broadcast', () => {
  test('SESSION-01: SessionListener() + sessionCallback without crash', async ({ page }) => {
    annotate('SESSION-01', ['auto']);
    await parityInit(page);
    const result = await paritySessionListener(page);
    expect(result.ok).toBeTruthy();
    const st = await parityState(page);
    expect(st.lastError).toBeNull();
  });
});
