import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import LegalPage from './LegalPage';
import LegalLinks from './LegalLinks';
import { DOCUMENTS } from './documents';
import { missingDetails } from '@platform/operator';

/**
 * The legal pages never present a draft as though it were in force, and never
 * invent who runs the service.
 */
describe('legal pages', () => {
  it.each(Object.keys(DOCUMENTS))('renders %s with one heading, a draft notice and visible placeholders', (doc) => {
    render(<LegalPage doc={doc} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DOCUMENTS[doc].title);
    // No operator details in the test environment: the page must say so.
    expect(missingDetails().length).toBeGreaterThan(0);
    expect(screen.getByRole('note').textContent).toMatch(/Draft/);
    expect(document.querySelectorAll('.legal-placeholder').length).toBeGreaterThan(0);
  });

  it('links every document, and no refund policy since nothing is sold', () => {
    render(<LegalLinks />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['#/legal/privacy', '#/legal/terms', '#/legal/cookies', '#/legal/accessibility']);
  });

  it('lists the sign-in cookie and the access token in the storage notice', () => {
    render(<LegalPage doc="cookies" />);
    const cells = screen.getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toContain('neev_rt');
    expect(cells).toContain('token');
  });
});
