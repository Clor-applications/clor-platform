import { describe, expect, it } from 'vitest';

import { allCountries } from './countries';

describe('countries for an address', () => {
  it('lists every country by its English name, India included', () => {
    const list = allCountries();
    expect(list.length).toBeGreaterThan(240);
    expect(list).toContainEqual({ isoCode: 'IN', name: 'India' });
    expect(list.find((c) => c.isoCode === 'AE').name).toBe('United Arab Emirates');
    expect(list.map((c) => c.name)).toEqual([...list.map((c) => c.name)].sort((a, b) => a.localeCompare(b)));
  });
});
