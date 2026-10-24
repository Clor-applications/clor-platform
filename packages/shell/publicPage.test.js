import { describe, expect, it, vi } from 'vitest';

vi.mock('./registry', () => ({ APPS: [], appById: () => null, availableApps: () => [], landingApp: () => null, subscribedApps: () => [] }));

/*
 * clor.in is the product's front page. Its Get started opens the app at
 * /signup and Sign in at /signin; anything else signed-out opens sign-in, not
 * the old landing page.
 */
describe('which door a signed-out visitor sees', async () => {
  const { publicPageFromPath } = await import('./Shell.jsx');
  it('opens sign-up from clor.in’s Get started', () => {
    expect(publicPageFromPath('/signup')).toBe('signup');
    expect(publicPageFromPath('/signup/')).toBe('signup');
    expect(publicPageFromPath('/get-started')).toBe('signup');
  });
  it('opens sign-in everywhere else', () => {
    expect(publicPageFromPath('/')).toBe('signin');
    expect(publicPageFromPath('/signin')).toBe('signin');
    expect(publicPageFromPath('/o/ATES-C100/')).toBe('signin');
  });
  it('opens the reset form at its own address', () => {
    expect(publicPageFromPath('/forgot-password')).toBe('forgot');
  });
});
