/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { paramsForOpen } from '../packages/shell/openParams.js';

/*
 * A notice clicked in one app that opens a screen in another (the bell, from Accounting, about a
 * People candidate) opens that screen on its one thing, and never carries the last screen's params.
 */
describe('Opening another app on a named screen', () => {
  const people = { screens: { candidates: () => null, interviews: () => null }, home: 'overview' };

  it('passes the link’s params to a screen that exists', () => {
    expect(paramsForOpen(people, 'candidates', { id: 'c1' })).toEqual({ id: 'c1' });
  });

  it('opens with none when there are none, the screen is unknown, or no screen is named', () => {
    expect(paramsForOpen(people, 'candidates', {})).toBeNull();
    expect(paramsForOpen(people, 'candidates', undefined)).toBeNull();
    expect(paramsForOpen(people, 'nowhere', { id: 'c1' })).toBeNull();
    expect(paramsForOpen(people, '', { id: 'c1' })).toBeNull();
    expect(paramsForOpen(null, 'candidates', { id: 'c1' })).toBeNull();
  });

  it('is what the shell sets when it opens another app, and the bell passes the link’s params', () => {
    const src = readFileSync('packages/shell/Shell.jsx', 'utf8');
    const open = src.slice(src.indexOf('const openAppNow'), src.indexOf('const openAppRef'));
    expect(open).toMatch(/setScreenParams\(paramsForOpen\(next, open, params\)\)/);
    expect(src).toMatch(/goTo\(link\.screen, link\.params\)/);
    expect(src).toMatch(/openApp\(link\.app, link\.screen \|\| '', link\.params \|\| \{\}\)/);
  });
});
