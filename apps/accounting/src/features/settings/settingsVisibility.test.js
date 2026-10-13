import { describe, expect, it } from 'vitest';

import { searchSettings, visibleCategories } from './settingsRegistry';

const access = { can: () => true, isEnabled: () => true };

describe('settings catalogue visibility', () => {
  it('shows only GST and TDS under Tax & Compliance', () => {
    const tax = visibleCategories(access).find((category) => category.id === 'tax');
    expect(tax?.items.map((item) => item.key)).toEqual(['settingsTax', 'settingsTds']);
    expect(searchSettings('tax rates', access)).toEqual([]);
  });

  it('removes Platform & Communication from the settings catalogue', () => {
    expect(visibleCategories(access).some((category) => category.id === 'platform')).toBe(false);
  });
});
