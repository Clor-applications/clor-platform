import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { generateKeyPairSync, privateDecrypt, constants as cryptoConstants } from 'node:crypto';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import {
  registerOnIrp,
  getEInvoiceConfig,
  nicCrypto,
  clearNicSessions,
  generateEwbByIrn,
} from '../services/einvoice.js';

/**
 * e-Invoice (IRP) integration: settings round-trip (secrets never echoed),
 * gateway registration via injected fetch, and the invoice endpoint storing
 * the IRN on the row.
 */

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
let owner: Ctx;

const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

async function makeOwner(): Promise<Ctx> {
  const email = `einv.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'EInvoice owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({
      companyName: `EInv Co ${Date.now()}-${rnd()}`,
      state: 'Karnataka',
      gstin: '29ABCDE1234F1ZW',
      profile: { addressLine: '12, 3rd Cross, Jayanagar', city: 'Bengaluru', pincode: '560011' },
    })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}

/**
 * A registered buyer and an item with an HSN — what the server needs to build
 * an INV-01 payload. Returns the invoice body fields that point at them.
 */
async function eInvoiceable(c: Ctx) {
  const org = await platformPrisma.org.findUnique({ where: { id: c.orgId }, select: { accountId: true, createdByUserId: true } });
  const scope = { accountId: org!.accountId, orgId: c.orgId, createdByUserId: org!.createdByUserId };
  const party = await prisma.party.create({
    data: {
      ...scope,
      partyType: 'CUSTOMER',
      name: `Buyer ${rnd()}`,
      gstin: '29AWGPV7107B1ZF',
      gstRegistrationType: 'REGULAR',
      billingLine1: '44 Market Road',
      billingCity: 'Mysuru',
      billingState: 'Karnataka',
      billingPincode: '570001',
    },
  });
  const item = await prisma.itemMaster.create({
    data: { ...scope, name: `Widget ${rnd()}`, unit: 'Pcs', hsnSac: '84719000', gstRate: 18, openingQty: 1000 },
  });
  return {
    customerId: party.id,
    customerName: party.name,
    customerGstin: party.gstin,
    placeOfSupplyState: 'Karnataka',
    lineItemId: item.id,
    scope,
  };
}

const setFeature = async (key: string, enabled: boolean) => {
  const current = await request(app).get(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).expect(200);
  const features = { ...(current.body.features || {}), [key]: enabled };
  await request(app).put(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).send({ features }).expect(200);
};

beforeAll(async () => {
  owner = await makeOwner();
}, 60_000);

describe('e-invoice settings', () => {
  it('stores the gateway config and never echoes secrets', async () => {
    const put = await request(app)
      .put(`/api/orgs/${owner.orgId}/einvoice/settings`)
      .set(auth(owner))
      .send({
        mode: 'SANDBOX',
        baseUrl: 'https://gsp.example.test/einvoice',
        gstin: '29ABCDE1234F1Z5',
        username: 'apiuser',
        password: 'topsecret',
        clientId: 'client-1',
        clientSecret: 'supersecret',
        autoRegister: true,
      })
      .expect(200);

    expect(put.body.settings.baseUrl).toBe('https://gsp.example.test/einvoice');
    expect(put.body.settings.hasPassword).toBe(true);
    expect(put.body.settings.hasClientSecret).toBe(true);
    expect(JSON.stringify(put.body)).not.toContain('topsecret');
    expect(JSON.stringify(put.body)).not.toContain('supersecret');

    const get = await request(app).get(`/api/orgs/${owner.orgId}/einvoice/settings`).set(auth(owner)).expect(200);
    expect(get.body.settings.username).toBe('apiuser');
    expect(JSON.stringify(get.body)).not.toContain('topsecret');

    // Decryption round-trips for the caller that actually needs the secret.
    const cfg = await getEInvoiceConfig(owner.orgId);
    expect(cfg?.password).toBe('topsecret');
    expect(cfg?.clientSecret).toBe('supersecret');
  });

  it('rejects extra headers that are not a JSON object', async () => {
    await request(app)
      .put(`/api/orgs/${owner.orgId}/einvoice/settings`)
      .set(auth(owner))
      .send({ headersJson: 'not json' })
      .expect(400);
  });
});

describe('IRP registration', () => {
  it('parses a wrapped gateway success into IRN fields', async () => {
    const doFetch = async () => ({
      status: 200,
      json: async () => ({
        data: {
          Irn: 'a1b2c3irn',
          AckNo: '112010036563',
          AckDt: '2026-08-19 12:00:00',
          SignedQRCode: 'signed.qr.jwt',
        },
      }),
      text: async () => '',
    });
    const result = await registerOnIrp(owner.orgId, { Version: '1.1' }, doFetch as any);
    expect(result.ok).toBe(true);
    expect(result.irn).toBe('a1b2c3irn');
    expect(result.ackNo).toBe('112010036563');
    expect(result.signedQr).toBe('signed.qr.jwt');
  });

  it('surfaces NIC-style error details as a readable message', async () => {
    const doFetch = async () => ({
      status: 200,
      json: async () => ({ ErrorDetails: [{ ErrorCode: '2150', ErrorMessage: 'Duplicate IRN' }] }),
      text: async () => '',
    });
    const result = await registerOnIrp(owner.orgId, {}, doFetch as any);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Duplicate IRN');
  });

  it('registers an invoice and stores the IRN on the row', async () => {
    await setFeature('einvoice', true);

    const buyer = await eInvoiceable(owner);
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(owner))
      .send({
        date: '2026-08-01',
        customerId: buyer.customerId,
        customerName: buyer.customerName,
        customerGstin: buyer.customerGstin,
        placeOfSupplyState: buyer.placeOfSupplyState,
        subtotal: 1000,
        cgstTotal: 90,
        sgstTotal: 90,
        gstTotal: 180,
        total: 1180,
        status: 'Unpaid',
        items: [{ itemId: buyer.lineItemId, description: 'Widget', quantity: 1, rate: 1000, gstRate: 18 }],
      })
      .expect(201);
    const invoiceId = created.body.invoice.id;

    // The route uses global fetch; point the gateway at a stubbed one.
    let sent: any = null;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: any) => {
      sent = JSON.parse(init.body);
      return {
        status: 200,
        json: async () => ({ Irn: 'irn-for-row', AckNo: '9', AckDt: '2026-08-19', SignedQRCode: 'qr' }),
        text: async () => '',
      };
    }) as any;
    try {
      const reg = await request(app)
        .post(`/api/orgs/${owner.orgId}/invoices/${invoiceId}/einvoice`)
        .set(auth(owner))
        // A payload from the browser is ignored: the server builds its own.
        .send({ payload: { Version: '1.1', TranDtls: { SupTyp: 'B2C' } } })
        .expect(200);
      expect(reg.body.irn).toBe('irn-for-row');
    } finally {
      globalThis.fetch = origFetch;
    }

    // What reached the gateway is the server-built INV-01.
    expect(sent.TranDtls).toMatchObject({ SupTyp: 'B2B', TaxSch: 'GST' });
    expect(sent.DocDtls).toMatchObject({ Typ: 'INV', No: created.body.invoice.number, Dt: '01/08/2026' });
    expect(sent.SellerDtls).toMatchObject({ Gstin: '29ABCDE1234F1ZW', Pin: 560011, Stcd: '29' });
    expect(sent.ItemList[0]).toMatchObject({ HsnCd: '84719000', Unit: 'PCS', IsServc: 'N', CgstAmt: 90, SgstAmt: 90 });

    const row = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    expect(row?.irn).toBe('irn-for-row');
    expect(row?.irnStatus).toBe('REGISTERED');
    expect(JSON.parse(row!.einvoicePayloadJson!).TranDtls.SupTyp).toBe('B2B');

    // Second registration refuses: the IRN is immutable.
    const again = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices/${invoiceId}/einvoice`)
      .set(auth(owner))
      .send({ payload: {} })
      .expect(409);
    expect(String(again.body.error)).toContain('irn-for-row');
  });

  it('refuses a B2C invoice with the reasons, without calling the gateway', async () => {
    await setFeature('einvoice', true);
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(owner))
      .send({
        date: '2026-08-03',
        customerName: 'Walk-in',
        subtotal: 100,
        total: 100,
        status: 'Unpaid',
        items: [{ description: 'Loose item', quantity: 1, rate: 100, gstRate: 0 }],
      })
      .expect(201);
    const origFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error('should not be called');
    }) as any;
    try {
      const reg = await request(app)
        .post(`/api/orgs/${owner.orgId}/invoices/${created.body.invoice.id}/einvoice`)
        .set(auth(owner))
        .send({})
        .expect(422);
      expect(reg.body.issues.join(' ')).toMatch(/not e-invoiced/);
      expect(reg.body.code).toBe('B2C_NOT_EINVOICED');
      expect(reg.body.issues.join(' ')).toMatch(/no HSN\/SAC code/);
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
    const preview = await request(app)
      .get(`/api/orgs/${owner.orgId}/invoices/${created.body.invoice.id}/einvoice/payload`)
      .set(auth(owner))
      .expect(422);
    expect(preview.body.issues.length).toBeGreaterThan(0);
  });

  it('builds a credit note as CRN with the original invoice referenced', async () => {
    const buyer = await eInvoiceable(owner);
    const inv = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(owner))
      .send({
        date: '2026-08-04',
        customerId: buyer.customerId,
        customerName: buyer.customerName,
        customerGstin: buyer.customerGstin,
        placeOfSupplyState: 'Karnataka',
        subtotal: 1000,
        cgstTotal: 90,
        sgstTotal: 90,
        gstTotal: 180,
        total: 1180,
        status: 'Unpaid',
        items: [{ itemId: buyer.lineItemId, description: 'Widget', quantity: 1, rate: 1000, gstRate: 18 }],
      })
      .expect(201);
    const note = await prisma.creditNote.create({
      data: {
        accountId: buyer.scope.accountId,
        orgId: owner.orgId,
        branchId: owner.branchId,
        number: `CN-${rnd()}`,
        date: '2026-08-05',
        againstDocId: inv.body.invoice.id,
        partyId: buyer.customerId,
        partyName: buyer.customerName,
        partyGstin: buyer.customerGstin,
        placeOfSupplyState: 'Karnataka',
        subtotal: 500,
        cgstTotal: 45,
        sgstTotal: 45,
        gstTotal: 90,
        total: 590,
        status: 'Open',
        itemsJson: JSON.stringify([{ itemId: buyer.lineItemId, description: 'Widget', quantity: 0.5, rate: 1000, gstRate: 18 }]),
        createdByUserId: buyer.scope.createdByUserId,
      },
    });
    const res = await request(app)
      .get(`/api/orgs/${owner.orgId}/credit-notes/${note.id}/einvoice/payload`)
      .set(auth(owner))
      .expect(200);
    expect(res.body.payload.DocDtls).toMatchObject({ Typ: 'CRN', No: note.number, Dt: '05/08/2026' });
    expect(res.body.payload.RefDtls.PrecDocDtls[0]).toEqual({ InvNo: inv.body.invoice.number, InvDt: '04/08/2026' });
    expect(res.body.payload.ValDtls).toMatchObject({ AssVal: 500, TotInvVal: 590 });
  });

  it('refuses when the feature flag is off', async () => {
    await setFeature('einvoice', false);
    await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices/nonexistent/einvoice`)
      .set(auth(owner))
      .send({ payload: {} })
      .expect(400);
  });
});

describe('NIC direct provider', () => {
  /**
   * A stub NIC server implementing the real spec crypto: RSA-PKCS1 decrypt of
   * the auth payload, AES-256-ECB Sek wrapping, AES-encrypted request/response
   * bodies. If our client interoperates with this, it speaks the NIC dialect.
   */
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const SEK = Buffer.alloc(32, 7); // the "server"-side session key

  const nicServer = (assertions: { sawAuth?: boolean; lastInvoicePayload?: any; lastPath?: string } = {}) =>
    (async (url: string, init: any) => {
      assertions.lastPath = String(url);
      if (String(url).includes('/eivital/')) {
        assertions.sawAuth = true;
        // Decrypt exactly the way NIC would.
        const encrypted = Buffer.from(JSON.parse(init.body).Data, 'base64');
        const b64Json = privateDecrypt({ key: privateKey, padding: cryptoConstants.RSA_PKCS1_PADDING }, encrypted).toString('utf8');
        const creds = JSON.parse(Buffer.from(b64Json, 'base64').toString('utf8'));
        expect(creds.UserName).toBe('nic_user');
        expect(creds.Password).toBe('nic_pass');
        const appKey = Buffer.from(creds.AppKey, 'base64');
        expect(appKey.length).toBe(32);
        return {
          status: 200,
          json: async () => ({
            Status: '1',
            Data: { AuthToken: 'tok-123', Sek: nicCrypto.aesEncrypt(appKey, SEK), TokenExpiry: '2026-08-19 23:59:59' },
          }),
          text: async () => '',
        };
      }
      // Core call: decrypt request with SEK, answer encrypted with SEK.
      expect(init.headers.AuthToken).toBe('tok-123');
      expect(init.headers.user_name).toBe('nic_user');
      const reqPayload = JSON.parse(nicCrypto.aesDecrypt(SEK, JSON.parse(init.body).Data).toString('utf8'));
      assertions.lastInvoicePayload = reqPayload;
      const responseData = String(url).includes('/eiewb/')
        ? { EwbNo: 331002345678, EwbDt: '2026-08-19 13:00:00', EwbValidTill: '2026-08-20 23:59:00' }
        : { Irn: 'nic-irn-sha256', AckNo: 112010012345, AckDt: '2026-08-19 12:30:00', SignedQRCode: 'nic.qr.jwt', Status: 'ACT' };
      return {
        status: 200,
        json: async () => ({ Status: '1', Data: nicCrypto.aesEncrypt(SEK, Buffer.from(JSON.stringify(responseData), 'utf8')) }),
        text: async () => '',
      };
    }) as any;

  beforeAll(async () => {
    clearNicSessions();
    await request(app)
      .put(`/api/orgs/${owner.orgId}/einvoice/settings`)
      .set(auth(owner))
      .send({
        provider: 'NIC',
        mode: 'SANDBOX',
        baseUrl: 'https://einv-apisandbox.nic.in',
        gstin: '29ABCDE1234F1Z5',
        username: 'nic_user',
        password: 'nic_pass',
        clientId: 'nic-client',
        clientSecret: 'nic-secret',
        publicKeyPem,
      })
      .expect(200);
  });

  it('completes the auth handshake and registers an IRN through real crypto', async () => {
    const seen: any = {};
    const result = await registerOnIrp(owner.orgId, { Version: '1.1', DocDtls: { No: 'INV-NIC-1' } }, nicServer(seen));
    expect(seen.sawAuth).toBe(true);
    expect(seen.lastInvoicePayload?.DocDtls?.No).toBe('INV-NIC-1');
    expect(result.ok).toBe(true);
    expect(result.irn).toBe('nic-irn-sha256');
    expect(result.ackNo).toBe('112010012345');
    expect(result.signedQr).toBe('nic.qr.jwt');
  });

  it('reuses the cached session on the next call', async () => {
    const seen: any = { sawAuth: false };
    const result = await registerOnIrp(owner.orgId, { DocDtls: { No: 'INV-NIC-2' } }, nicServer(seen));
    expect(result.ok).toBe(true);
    expect(seen.sawAuth).toBe(false); // no second handshake
  });

  it('generates an e-Way Bill from the IRN', async () => {
    const seen: any = {};
    const result = await generateEwbByIrn(owner.orgId, 'nic-irn-sha256', { VehNo: 'KA01AB1234', TransMode: '1' }, nicServer(seen));
    expect(result.ok).toBe(true);
    expect(result.ewbNo).toBe('331002345678');
    expect(String(seen.lastPath)).toContain('/eiewb/');
    expect(seen.lastInvoicePayload?.Irn).toBe('nic-irn-sha256');
    expect(seen.lastInvoicePayload?.VehNo).toBe('KA01AB1234');
  });

  it('surfaces NIC error details decoded from base64', async () => {
    clearNicSessions();
    const errServer = (async (url: string, init: any) => {
      if (String(url).includes('/eivital/')) {
        const encrypted = Buffer.from(JSON.parse(init.body).Data, 'base64');
        const b64Json = privateDecrypt({ key: privateKey, padding: cryptoConstants.RSA_PKCS1_PADDING }, encrypted).toString('utf8');
        const creds = JSON.parse(Buffer.from(b64Json, 'base64').toString('utf8'));
        const appKey = Buffer.from(creds.AppKey, 'base64');
        return {
          status: 200,
          json: async () => ({ Status: '1', Data: { AuthToken: 'tok-e', Sek: nicCrypto.aesEncrypt(appKey, SEK) } }),
          text: async () => '',
        };
      }
      const details = Buffer.from(JSON.stringify([{ ErrorCode: '2150', ErrorMessage: 'Duplicate IRN' }]), 'utf8').toString('base64');
      return { status: 200, json: async () => ({ Status: '0', ErrorDetails: details }), text: async () => '' };
    }) as any;
    const result = await registerOnIrp(owner.orgId, {}, errServer);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Duplicate IRN');
  });

  it('stores the signed invoice and payload, then cancels within the window', async () => {
    clearNicSessions();
    // point the org back at a working NIC config
    await request(app)
      .put(`/api/orgs/${owner.orgId}/einvoice/settings`)
      .set(auth(owner))
      .send({ publicKeyPem })
      .expect(200);
    await setFeature('einvoice', true);
    const cancelBuyer = await eInvoiceable(owner);

    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(owner))
      .send({
        date: '2026-08-02',
        customerId: cancelBuyer.customerId,
        customerName: cancelBuyer.customerName,
        customerGstin: cancelBuyer.customerGstin,
        placeOfSupplyState: 'Karnataka',
        subtotal: 500,
        cgstTotal: 45,
        sgstTotal: 45,
        gstTotal: 90,
        total: 590,
        status: 'Unpaid',
        items: [{ itemId: cancelBuyer.lineItemId, description: 'Widget', quantity: 1, rate: 500, gstRate: 18 }],
      })
      .expect(201);
    const invoiceId = created.body.invoice.id;

    const nicWithSigned = ((seen: any) => (async (url: string, init: any) => {
      if (String(url).includes('/eivital/')) {
        const encrypted = Buffer.from(JSON.parse(init.body).Data, 'base64');
        const b64Json = privateDecrypt({ key: privateKey, padding: cryptoConstants.RSA_PKCS1_PADDING }, encrypted).toString('utf8');
        const creds = JSON.parse(Buffer.from(b64Json, 'base64').toString('utf8'));
        const appKey = Buffer.from(creds.AppKey, 'base64');
        return { status: 200, json: async () => ({ Status: '1', Data: { AuthToken: 'tok-c', Sek: nicCrypto.aesEncrypt(appKey, SEK) } }), text: async () => '' };
      }
      const reqPayload = JSON.parse(nicCrypto.aesDecrypt(SEK, JSON.parse(init.body).Data).toString('utf8'));
      seen.lastPayload = reqPayload;
      seen.lastPath = String(url);
      const data = String(url).includes('/Cancel')
        ? { Irn: reqPayload.Irn, CancelDate: '2026-08-19 15:00:00' }
        : { Irn: 'irn-cancel-test', AckNo: 7, AckDt: '2026-08-19 14:00:00', SignedQRCode: 'qr.jwt', SignedInvoice: 'signed.invoice.jwt' };
      return { status: 200, json: async () => ({ Status: '1', Data: nicCrypto.aesEncrypt(SEK, Buffer.from(JSON.stringify(data), 'utf8')) }), text: async () => '' };
    }) as any);

    const seen: any = {};
    const origFetch = globalThis.fetch;
    globalThis.fetch = nicWithSigned(seen);
    try {
      const reg = await request(app)
        .post(`/api/orgs/${owner.orgId}/invoices/${invoiceId}/einvoice`)
        .set(auth(owner))
        .send({ payload: { Version: '1.1', DocDtls: { No: created.body.invoice.number } } })
        .expect(200);
      expect(reg.body.signedInvoice).toBe('signed.invoice.jwt');

      // Full record endpoint returns everything stored.
      const details = await request(app)
        .get(`/api/orgs/${owner.orgId}/invoices/${invoiceId}/einvoice`)
        .set(auth(owner))
        .expect(200);
      expect(details.body.irn).toBe('irn-cancel-test');
      expect(details.body.signedInvoice).toBe('signed.invoice.jwt');
      expect(details.body.payload?.Version).toBe('1.1');

      // Cancel within the window.
      const cancel = await request(app)
        .post(`/api/orgs/${owner.orgId}/invoices/${invoiceId}/einvoice/cancel`)
        .set(auth(owner))
        .send({ reason: '2', remarks: 'Wrong rate' })
        .expect(200);
      expect(cancel.body.status).toBe('CANCELLED');
      expect(String(seen.lastPath)).toContain('/Cancel');
      expect(seen.lastPayload.Irn).toBe('irn-cancel-test');
      expect(seen.lastPayload.CnlRsn).toBe('2');
    } finally {
      globalThis.fetch = origFetch;
    }

    const row = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    expect(row?.irnStatus).toBe('CANCELLED');
    expect(row?.irnCancelReason).toContain('Data entry mistake');

    // A cancelled IRN cannot be cancelled again.
    await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices/${invoiceId}/einvoice/cancel`)
      .set(auth(owner))
      .send({ reason: '4' })
      .expect(400);
  });

  it('refuses cancellation after the 24-hour window', async () => {
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(owner))
      .send({
        date: '2026-08-03',
        customerName: 'Old Buyer',
        subtotal: 100,
        total: 100,
        status: 'Unpaid',
        items: [],
      })
      .expect(201);
    const invoiceId = created.body.invoice.id;
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { irn: 'old-irn', irnStatus: 'REGISTERED', irnRegisteredAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices/${invoiceId}/einvoice/cancel`)
      .set(auth(owner))
      .send({ reason: '3' })
      .expect(400);
    expect(String(res.body.error)).toContain('24-hour');
  });

  it('fails with a clear message when the public key is missing', async () => {
    clearNicSessions();
    await request(app)
      .put(`/api/orgs/${owner.orgId}/einvoice/settings`)
      .set(auth(owner))
      .send({ publicKeyPem: '' })
      .expect(200);
    const result = await registerOnIrp(owner.orgId, {}, (async () => {
      throw new Error('should not be called');
    }) as any);
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain('public key');
  });
});
