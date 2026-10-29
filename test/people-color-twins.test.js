import { describe, expect, it } from 'vitest';
import * as lucide from 'lucide-react';
import { TWIN_NAMES } from '@ui/components/ui/colorSwap';

/*
 * The colour set swaps a line icon by its Lucide displayName. Lucide renames icons between versions and keeps
 * the old export as an alias with the new displayName (BarChart3 now reports ChartColumn), so a key under the
 * old name silently stops matching. Every key must be an export whose displayName is that same name.
 */
describe('colour twins of line icons', () => {
  it('are keyed by names Lucide still reports as displayName', () => {
    const stale = TWIN_NAMES.filter((name) => lucide[name]?.displayName !== name);
    expect(stale).toEqual([]);
  });

  it('exist to be checked', () => {
    expect(TWIN_NAMES.length).toBeGreaterThan(10);
  });
});
