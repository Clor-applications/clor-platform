import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCompanyFromServer } from './useCompanyFromServer';

const ORG = {
  orgId: 'org-1',
  org: {
    id: 'org-1',
    name: 'Neev Steels',
    slug: 'neev-steels',
    profile: { state: 'Karnataka', gstin: '29ABCDE1234F1Z5', tradeName: 'Neev', baseCurrency: 'INR' },
  },
};

/** Runs the hook once against a starting book and returns what it produced. */
const run = (start, { orgs = [ORG], activeOrgId = 'org-1', enabled = true } = {}) => {
  let book = start;
  const setDb = (fn) => {
    book = typeof fn === 'function' ? fn(book) : fn;
  };
  const Harness = () => {
    useCompanyFromServer({ enabled, orgs, activeOrgId, setDb });
    return null;
  };
  render(<Harness />);
  return book;
};

/*
 * The company the browser is looking at.
 *
 * Signup creates it on the server. Signing in on another machine started from
 * an empty local book with no way to ask what company this account holds, so
 * the app showed a placeholder called "Company" with no GSTIN and no state and
 * offered to set it up again — the same questions, already answered, against
 * books that existed the whole time.
 */
describe('rebuilding the company from the server', () => {
  it('creates it when the browser has never seen these books', () => {
    const book = run({ companies: [] });

    expect(book.companies).toHaveLength(1);
    expect(book.companies[0]).toMatchObject({
      name: 'Neev Steels',
      gstin: '29ABCDE1234F1Z5',
      state: 'Karnataka',
      gstRegistration: 'Regular',
    });
    expect(book.companies[0].profile.backendCompanyId).toBe('org-1');
    expect(book.activeCompanyId).toBe(book.companies[0].id);
  });

  it('fills in the placeholder rather than adding a second company', () => {
    // The app invents { id: 1, name: 'Company' } when the book is empty.
    // Appending beside it would leave the person with two companies, one of
    // them fictional.
    const book = run({ companies: [{ id: 1, name: 'Company', currency: 'INR' }] });

    expect(book.companies).toHaveLength(1);
    expect(book.companies[0].id).toBe(1);
    expect(book.companies[0].name).toBe('Neev Steels');
    expect(book.companies[0].state).toBe('Karnataka');
  });

  it('never overwrites what somebody typed here', () => {
    // A corrected trade name or a deliberately different state is an answer,
    // not a gap. Reverting it on every sign-in would be worse than the bug.
    const book = run({
      companies: [
        { id: 4, name: 'Neev Steels & Co', gstin: '29ZZZZZ9999Z1Z5', state: 'Kerala', profile: { backendCompanyId: 'org-1' } },
      ],
    });

    expect(book.companies[0].name).toBe('Neev Steels & Co');
    expect(book.companies[0].gstin).toBe('29ZZZZZ9999Z1Z5');
    expect(book.companies[0].state).toBe('Kerala');
  });

  it('fills only the blanks on a company it already knows', () => {
    const book = run({
      companies: [{ id: 4, name: 'Neev Steels', gstin: '', state: '', profile: { backendCompanyId: 'org-1' } }],
    });

    expect(book.companies[0].gstin).toBe('29ABCDE1234F1Z5');
    expect(book.companies[0].state).toBe('Karnataka');
  });

  it('does nothing when there is no session or no active company', () => {
    const start = { companies: [] };
    expect(run(start, { enabled: false })).toBe(start);
    expect(run(start, { activeOrgId: '' })).toBe(start);
    expect(run(start, { orgs: [] })).toBe(start);
  });

  it('leaves the book alone when the record is already complete', () => {
    const start = {
      companies: [
        {
          id: 4,
          name: 'Neev Steels',
          gstin: '29ABCDE1234F1Z5',
          state: 'Karnataka',
          country: 'India',
          currency: 'INR',
          profile: { backendCompanyId: 'org-1', handle: 'neev-steels' },
        },
      ],
    };
    expect(run(start)).toBe(start);
  });
});
