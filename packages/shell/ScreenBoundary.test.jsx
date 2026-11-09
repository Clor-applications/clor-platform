import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ScreenBoundary, { isStaleRelease } from './ScreenBoundary';

const Throws = ({ error }) => {
  throw error;
};

describe('ScreenBoundary after a release', () => {
  afterEach(() => vi.restoreAllMocks());

  it('knows each browser’s words for a code file of an older release', () => {
    expect(isStaleRelease(new TypeError('Failed to fetch dynamically imported module: https://people.clor.in/assets/panels-CSGy0fIt.js'))).toBe(true);
    expect(isStaleRelease(new TypeError('error loading dynamically imported module: https://people.clor.in/assets/panels-CSGy0fIt.js'))).toBe(true);
    expect(isStaleRelease(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isStaleRelease(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('offers a reload, not a retry that asks for the same missing file', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    render(<ScreenBoundary appName="People"><Throws error={new TypeError('error loading dynamically imported module: /assets/panels-CSGy0fIt.js')} /></ScreenBoundary>);
    expect(screen.getByRole('heading', { name: 'CLOR has been updated' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalled();
  });

  it('keeps Try again for any other failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ScreenBoundary appName="People"><Throws error={new Error('boom')} /></ScreenBoundary>);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
