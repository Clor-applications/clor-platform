/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { describe, expect, it } from 'vitest';

import { partyEmail, partyMobile, primaryContactOf } from './contacts';

/**
 * Who a reminder is addressed to.
 *
 * The party's own field wins where it is filled — somebody typed it on the
 * master itself — and the contact marked primary answers for it where it is
 * not, which is the common case for a company whose "email" is a person.
 */
describe('the primary contact', () => {
  const party = {
    contacts: [
      { name: 'Accounts desk', email: 'accounts@acme.test', mobile: '9000000001' },
      { name: 'R. Nair', email: 'nair@acme.test', mobile: '9000000002', isPrimary: true },
    ],
  };

  it('is the flagged one, not the first typed', () => {
    expect(primaryContactOf(party).name).toBe('R. Nair');
  });

  it('falls back to the first named contact when nothing is flagged', () => {
    const plain = { contacts: [{ name: 'Accounts desk' }, { name: 'R. Nair' }] };
    expect(primaryContactOf(plain).name).toBe('Accounts desk');
  });

  it('ignores an empty row left ready to type into', () => {
    expect(primaryContactOf({ contacts: [{ name: '   ' }] })).toBeNull();
    expect(primaryContactOf({})).toBeNull();
  });
});

describe('where a message goes', () => {
  it('prefers what is on the master itself', () => {
    const p = { email: 'billing@acme.test', mobile: '9111111111', contacts: [{ name: 'R. Nair', email: 'nair@acme.test', mobile: '9000000002', isPrimary: true }] };
    expect(partyEmail(p)).toBe('billing@acme.test');
    expect(partyMobile(p)).toBe('9111111111');
  });

  it('uses the primary contact when the master carries none', () => {
    const p = { contacts: [{ name: 'R. Nair', email: 'nair@acme.test', mobile: '9000000002', isPrimary: true }] };
    expect(partyEmail(p)).toBe('nair@acme.test');
    expect(partyMobile(p)).toBe('9000000002');
  });

  it('returns nothing rather than a stray space', () => {
    expect(partyEmail({ email: '  ' })).toBe('');
    expect(partyMobile({})).toBe('');
  });
});
