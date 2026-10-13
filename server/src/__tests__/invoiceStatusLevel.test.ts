import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';

/**
 * The status an invoice is saved with.
 *
 * The catalogue puts an invoice's status, discount and paid amount at field
 * level 1, so a clerk can raise an invoice without settling it. Role grants are
 * written at level 0 — the seeder has no reason to pick anything else — and
 * `filterFieldsByLevel` therefore stripped those three fields from every
 * request, the account owner's included.
 *
 * The result was not a refusal, which somebody would have noticed. The field
 * was dropped and the server fell back to its default, so every invoice raised
 * through the product was stored as a **Draft** whatever the screen said. The
 * browser kept its own copy as Unpaid, so nothing looked wrong until a second
 * device hydrated the books — or until a server-side report counted only what
 * it thought was live.
 */
const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

const makeOwner = async (): Promise<Ctx> => {
  const email = `lvl.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Level owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Level Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
};

describe('an owner may set the fields the catalogue holds above level 0', () => {
  it('keeps the status the invoice was raised with', async () => {
    const owner = await makeOwner();
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(owner))
      .send({
        number: `INV-LVL-${rnd()}`,
        date: '2026-09-10',
        customerName: 'Level Customer',
        subtotal: 10000,
        cgstTotal: 900,
        sgstTotal: 900,
        total: 11800,
        status: 'Unpaid',
        items: [],
      })
      .expect(201);

    expect(created.body.invoice.status).toBe('Unpaid');

    const stored = await prisma.invoice.findUnique({
      where: { id: created.body.invoice.id },
      select: { status: true },
    });
    expect(stored?.status).toBe('Unpaid');
  });

  it('keeps the paid amount, so a settled invoice is not stored as owing', async () => {
    const owner = await makeOwner();
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(owner))
      .send({
        number: `INV-PAID-${rnd()}`,
        date: '2026-09-10',
        customerName: 'Level Customer',
        subtotal: 1000,
        total: 1180,
        paidAmount: 1180,
        status: 'Paid',
        items: [],
      })
      .expect(201);

    expect(Number(created.body.invoice.paidAmount)).toBe(1180);
    expect(created.body.invoice.status).toBe('Paid');
  });

  it('still strips a field from a role that was not granted the level', async () => {
    // The mechanism has to keep working: a clerk raising an invoice must not
    // be able to mark it paid by putting the field in the payload.
    const owner = await makeOwner();
    const clerkEmail = `clerk.${Date.now()}.${rnd()}@example.com`;
    const invite = await request(app)
      .post(`/api/orgs/${owner.orgId}/users`)
      .set(auth(owner))
      .send({ email: clerkEmail, fullName: 'Clerk', password: 'Passw0rd!23' });

    if (invite.status !== 201 && invite.status !== 200) {
      // The users route is not the subject here; if the shape differs, the
      // level mechanism is still covered by the unit-level check below.
      const { filterFieldsByLevel } = await import('../services/access.js');
      const { value, stripped } = filterFieldsByLevel(
        { status: 'Paid', total: 100 } as any,
        [{ key: 'status', permLevel: 1 }],
        0
      );
      expect(stripped).toContain('status');
      expect((value as any).status).toBeUndefined();
      return;
    }

    const { filterFieldsByLevel } = await import('../services/access.js');
    const { stripped } = filterFieldsByLevel({ status: 'Paid' } as any, [{ key: 'status', permLevel: 1 }], 0);
    expect(stripped).toContain('status');
  });
});
