import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useTextSize } from './useTextSize';

afterEach(() => { document.documentElement.removeAttribute('data-text-size'); localStorage.removeItem('uiTextSize'); });

it('starts at Medium, writes Large to the page and remembers it', () => {
  const { result } = renderHook(() => useTextSize());
  expect(result.current.size).toBe('medium');
  expect(document.documentElement.hasAttribute('data-text-size')).toBe(false);
  act(() => result.current.set('large'));
  expect(document.documentElement.getAttribute('data-text-size')).toBe('large');
  expect(localStorage.getItem('uiTextSize')).toBe('large');
  act(() => result.current.set('medium'));
  expect(document.documentElement.hasAttribute('data-text-size')).toBe(false);
});
