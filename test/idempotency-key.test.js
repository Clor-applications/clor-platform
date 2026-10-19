// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { idempotencyKeyFor } from '../packages/platform/http.js';

/**
 * The web app sends an Idempotency-Key on writes that create money records,
 * and the same one when the same form is sent again within seconds — a double
 * click or a retry — so the server replays the first answer.
 */
describe('idempotency keys from the web app', () => {
  it('reuses the key for the same write sent again, and makes a new one for a different write', () => {
    const body = { partyId: 'p1', amount: 1180 };
    const a = idempotencyKeyFor('POST', '/orgs/o1/payments', body);
    const b = idempotencyKeyFor('POST', '/orgs/o1/payments', { ...body });
    const c = idempotencyKeyFor('POST', '/orgs/o1/payments', { ...body, amount: 1181 });
    expect(a).toBeTruthy();
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
  it('leaves reads and other writes alone', () => {
    expect(idempotencyKeyFor('GET', '/orgs/o1/payments', null)).toBeNull();
    expect(idempotencyKeyFor('POST', '/orgs/o1/items', { name: 'x' })).toBeNull();
    expect(idempotencyKeyFor('POST', '/orgs/o1/payroll/payments/9/post', {})).toBeTruthy();
  });
});
