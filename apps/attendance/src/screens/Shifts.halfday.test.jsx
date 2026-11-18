import { describe, expect, it } from 'vitest';
import { halfDaySentence } from './Shifts';

describe('halfDaySentence', () => {
  it('says the half-day rule in words', () => {
    expect(halfDaySentence(240, 480)).toBe('Less than 4 h worked is absent; 4 h up to 8 h is a half day.');
    expect(halfDaySentence('270', '510')).toBe('Less than 4 h 30 min worked is absent; 4 h 30 min up to 8 h 30 min is a half day.');
    expect(halfDaySentence(240, '')).toBe('Less than 4 h worked is absent.');
    expect(halfDaySentence('', 480)).toBeNull();
  });
});
