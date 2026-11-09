import type { SampleApi } from './sampleCompany.js';
import { isValidGstinChecksum } from '../utils/gstin.js';

/**
 * What the Explore sample company holds (services/sampleCompany.ts writes it
 * through the real HTTP API, as the sample owner).
 *
 * A Pune trading company of twelve people selling electrical goods and small
 * appliances: Books with customers in and outside Maharashtra (so both
 * CGST + SGST and IGST appear), vendors, items, three months of invoices,
 * bills, receipts and payments; People with departments and positions;
 * Payroll with last month's pay run posted to the ledger; and leave and
 * attendance for the last few weeks.
 *
 * Everything is invented. GSTINs and PANs are built on 0000-style serials
 * (the GSTIN check digit is computed so the parties API accepts it), emails
 * are on the reserved `.example` domain, bank details are a made-up bank.
 * Dates are counted back from today, so the sample never looks stale.
 *
 * Every step looks before it writes (by name, code or document number), so a
 * second run, or one that stopped halfway, adds only what is missing. A step
 * that fails is logged and the rest carry on.
 */

type Res = { status: number; body: any };

/* ------------------------------------------------------------------ dates */

/** Today in India, as YYYY-MM-DD. */
const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isSunday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 0;
/** n days from today, moved back off a Sunday. */
const workday = (n: number) => {
  let d = addDays(todayIst(), n);
  while (isSunday(d)) d = addDays(d, -1);
  return d;
};
const minDate = (a: string, b: string) => (a < b ? a : b);
const maxDate = (a: string, b: string) => (a > b ? a : b);

/** A month `back` months before this one: its name and first and last day. */
const monthBack = (back: number) => {
  const [y, m] = todayIst().split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1 - back, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const name = start.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { name, startDate: iso(start), endDate: iso(end) };
};
/** The Indian financial year a date is in, as 2026-27, and its first day. */
const fyOf = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const start = Number(iso.slice(5, 7)) >= 4 ? y : y - 1;
  return { fy: `${start}-${String((start + 1) % 100).padStart(2, '0')}`, start: `${start}-04-01` };
};

/* ------------------------------------------------------------ identifiers */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A sample GSTIN: state code, PAN, entity 1, Z, and the check digit that makes it valid. */
const gstinFor = (stateCode: string, pan: string) => {
  const stem = `${stateCode}${pan}1Z`;
  for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (isValidGstinChecksum(stem + ch)) return stem + ch;
  throw new Error(`no GSTIN check digit for ${stem}`);
};
/** A sample company PAN on a 0000-style serial: AAAC, the name's first letter, the serial, A. */
const companyPan = (name: string, serial: number) => `AAAC${name[0].toUpperCase()}${String(serial).padStart(4, '0')}A`;

/* ------------------------------------------------------------------- data */

type Party = { name: string; state: string; code: string; city: string; pincode: string; line1: string; contact: string; days: number };

const CUSTOMERS: Party[] = [
  { name: 'Deccan Hardware Mart', state: 'Maharashtra', code: '27', city: 'Pune', pincode: '411002', line1: '212 Laxmi Road, Budhwar Peth', contact: 'Prakash Deo', days: 30 },
  { name: 'Shivajinagar Electricals', state: 'Maharashtra', code: '27', city: 'Pune', pincode: '411005', line1: '8 FC Road, Shivajinagar', contact: 'Mahesh Kale', days: 15 },
  { name: 'Kolhapur Agro Supplies', state: 'Maharashtra', code: '27', city: 'Kolhapur', pincode: '416001', line1: '45 Station Road, Shahupuri', contact: 'Sunil Patil', days: 30 },
  { name: 'Nashik Home Stores', state: 'Maharashtra', code: '27', city: 'Nashik', pincode: '422001', line1: '17 MG Road', contact: 'Rekha Borse', days: 30 },
  { name: 'Thane Office Solutions', state: 'Maharashtra', code: '27', city: 'Thane', pincode: '400601', line1: '3 Gokhale Road, Naupada', contact: 'Ajay Mhatre', days: 45 },
  { name: 'Surat Lighting House', state: 'Gujarat', code: '24', city: 'Surat', pincode: '395003', line1: '21 Ring Road', contact: 'Hitesh Shah', days: 30 },
  { name: 'Bengaluru Home Needs', state: 'Karnataka', code: '29', city: 'Bengaluru', pincode: '560004', line1: '67 DVG Road, Basavanagudi', contact: 'Ravi Gowda', days: 30 },
  { name: 'Indore Retail Mart', state: 'Madhya Pradesh', code: '23', city: 'Indore', pincode: '452001', line1: '9 MG Road', contact: 'Anil Jain', days: 45 },
];

const VENDORS: Party[] = [
  { name: 'Mumbai Electrical Distributors', state: 'Maharashtra', code: '27', city: 'Mumbai', pincode: '400002', line1: '114 Lohar Chawl, Kalbadevi', contact: 'Dinesh Mehta', days: 30 },
  { name: 'Pune Packaging Works', state: 'Maharashtra', code: '27', city: 'Pune', pincode: '411026', line1: 'Plot 12, Bhosari MIDC', contact: 'Santosh Lande', days: 15 },
  { name: 'Ahmedabad Appliances Pvt Ltd', state: 'Gujarat', code: '24', city: 'Ahmedabad', pincode: '380015', line1: '5 Vastrapur Industrial Estate', contact: 'Ketan Patel', days: 30 },
  { name: 'Chennai Cables and Wires', state: 'Tamil Nadu', code: '33', city: 'Chennai', pincode: '600001', line1: '40 Armenian Street, George Town', contact: 'Senthil Kumar', days: 45 },
  { name: 'Delhi Fans Depot', state: 'Delhi', code: '07', city: 'New Delhi', pincode: '110006', line1: '22 Bhagirath Palace, Chandni Chowk', contact: 'Rajesh Gupta', days: 30 },
];

type Item = { name: string; type: 'STOCK' | 'SERVICE'; unit: string; hsnSac: string; gstRate: number; sale: number; buy: number; opening: number };

const ITEMS: Item[] = [
  { name: 'LED bulb 9 W', type: 'STOCK', unit: 'Pcs', hsnSac: '85395000', gstRate: 18, sale: 95, buy: 62, opening: 800 },
  { name: 'Ceiling fan 1200 mm', type: 'STOCK', unit: 'Pcs', hsnSac: '84145110', gstRate: 18, sale: 1850, buy: 1420, opening: 60 },
  { name: 'Mixer grinder 750 W', type: 'STOCK', unit: 'Pcs', hsnSac: '85094010', gstRate: 18, sale: 3250, buy: 2580, opening: 30 },
  { name: 'Extension board 4 socket', type: 'STOCK', unit: 'Pcs', hsnSac: '85366990', gstRate: 18, sale: 420, buy: 290, opening: 200 },
  { name: 'Copper wire 1.5 sq mm, 90 m', type: 'STOCK', unit: 'Roll', hsnSac: '85444999', gstRate: 18, sale: 1650, buy: 1310, opening: 80 },
  { name: 'Steel water bottle 1 L', type: 'STOCK', unit: 'Pcs', hsnSac: '73239390', gstRate: 5, sale: 380, buy: 260, opening: 150 },
  { name: 'Fan installation', type: 'SERVICE', unit: 'Nos', hsnSac: '998729', gstRate: 18, sale: 350, buy: 0, opening: 0 },
  { name: 'Annual maintenance contract', type: 'SERVICE', unit: 'Nos', hsnSac: '998719', gstRate: 18, sale: 4500, buy: 0, opening: 0 },
];

/* Invoice lines as [item index, quantity]; one invoice per row, oldest first. */
const INVOICE_LINES: Array<Array<[number, number]>> = [
  [[0, 120], [3, 20]],
  [[1, 8], [6, 8]],
  [[2, 4]],
  [[4, 10], [0, 50]],
  [[5, 40], [3, 15]],
  [[1, 12], [4, 6]],
  [[7, 1]],
  [[0, 200]],
  [[2, 6], [5, 24]],
  [[3, 30], [0, 80]],
  [[1, 5], [6, 5]],
  [[4, 12]],
  [[2, 3], [3, 10]],
  [[0, 150], [5, 20]],
  [[1, 10]],
  [[7, 2], [6, 4]],
  [[4, 8], [3, 12]],
  [[2, 5]],
  [[0, 90], [1, 4]],
  [[5, 30], [3, 25]],
];
/* How much of each invoice the customer has paid: all, some, or none yet. */
const PAID_SHARE = [1, 1, 1, 0.5, 1, 1, 0, 1, 0, 1, 0.4, 1, 0, 1, 0, 0.5, 0, 0, 0, 0];

/* Bills as [vendor index, lines]; oldest first. */
const BILLS: Array<[number, Array<[number, number]>]> = [
  [0, [[0, 300], [3, 100]]],
  [4, [[1, 30]]],
  [2, [[2, 20]]],
  [3, [[4, 40]]],
  [1, [[5, 80]]],
  [0, [[0, 200], [3, 60]]],
  [4, [[1, 20]]],
  [3, [[4, 30]]],
];
const BILL_PAID_SHARE = [1, 1, 1, 0.5, 1, 0, 0, 0];

const DEPARTMENTS: Record<string, string[]> = {
  Sales: ['Sales manager', 'Sales executive'],
  Accounts: ['Accounts manager', 'Accountant'],
  Warehouse: ['Storekeeper', 'Warehouse assistant'],
  Operations: ['Operations manager', 'Delivery driver'],
  Admin: ['HR executive', 'Office administrator'],
};

type Person = { code: string; first: string; last: string; gender: 'MALE' | 'FEMALE'; dept: string; position: string; joined: string; ctc: number; manager?: string };

/* Managers first, so their reports can name them. */
const PEOPLE: Person[] = [
  { code: 'STP-001', first: 'Sameer', last: 'Joshi', gender: 'MALE', dept: 'Operations', position: 'Operations manager', joined: '2019-06-03', ctc: 900_000 },
  { code: 'STP-002', first: 'Neha', last: 'Pawar', gender: 'FEMALE', dept: 'Accounts', position: 'Accounts manager', joined: '2020-01-15', ctc: 720_000, manager: 'STP-001' },
  { code: 'STP-003', first: 'Vikas', last: 'Shinde', gender: 'MALE', dept: 'Sales', position: 'Sales manager', joined: '2020-08-10', ctc: 840_000, manager: 'STP-001' },
  { code: 'STP-004', first: 'Pooja', last: 'Gokhale', gender: 'FEMALE', dept: 'Accounts', position: 'Accountant', joined: '2021-04-05', ctc: 480_000, manager: 'STP-002' },
  { code: 'STP-005', first: 'Amit', last: 'Jadhav', gender: 'MALE', dept: 'Sales', position: 'Sales executive', joined: '2021-11-22', ctc: 420_000, manager: 'STP-003' },
  { code: 'STP-006', first: 'Sneha', last: 'Bhosale', gender: 'FEMALE', dept: 'Sales', position: 'Sales executive', joined: '2022-07-01', ctc: 396_000, manager: 'STP-003' },
  { code: 'STP-007', first: 'Rahul', last: 'More', gender: 'MALE', dept: 'Warehouse', position: 'Storekeeper', joined: '2022-02-14', ctc: 336_000, manager: 'STP-001' },
  { code: 'STP-008', first: 'Ganesh', last: 'Salunkhe', gender: 'MALE', dept: 'Warehouse', position: 'Warehouse assistant', joined: '2023-05-08', ctc: 252_000, manager: 'STP-007' },
  { code: 'STP-009', first: 'Kiran', last: 'Wagh', gender: 'MALE', dept: 'Warehouse', position: 'Warehouse assistant', joined: '2024-01-10', ctc: 240_000, manager: 'STP-007' },
  { code: 'STP-010', first: 'Priyanka', last: 'Kale', gender: 'FEMALE', dept: 'Admin', position: 'HR executive', joined: '2023-09-18', ctc: 408_000, manager: 'STP-001' },
  { code: 'STP-011', first: 'Tushar', last: 'Gaikwad', gender: 'MALE', dept: 'Operations', position: 'Delivery driver', joined: '2024-06-03', ctc: 264_000, manager: 'STP-001' },
  { code: 'STP-012', first: 'Anjali', last: 'Phadke', gender: 'FEMALE', dept: 'Admin', position: 'Office administrator', joined: '2025-03-03', ctc: 300_000, manager: 'STP-010' },
];

const LEAVE_TYPES = [
  { name: 'Casual leave', code: 'CL', annualDays: 8, color: '#2B6CB0' },
  { name: 'Sick leave', code: 'SL', annualDays: 7, color: '#2F855A' },
  { name: 'Earned leave', code: 'EL', annualDays: 15, color: '#B7791F', carryForwardMax: 30 },
  { name: 'Leave without pay', code: 'LWP', annualDays: 0, isPaid: false, color: '#718096' },
];

/* [person code, leave code, days back from today (negative is ahead), working days, reason, approve?] */
const LEAVE: Array<[string, string, number, number, string, boolean]> = [
  ['STP-007', 'EL', -36, 3, 'Family function in Satara', true],
  ['STP-004', 'CL', -26, 1, 'Bank work', true],
  ['STP-005', 'SL', -19, 2, 'Fever', true],
  ['STP-006', 'CL', -11, 1, 'Personal errand', true],
  ['STP-008', 'CL', 6, 1, 'Child’s school meeting', false],
];

/* Fixed-date holidays; the ones that fall in the attendance window are added. */
const FIXED_HOLIDAYS: Array<[string, string]> = [
  ['01-26', 'Republic Day'],
  ['05-01', 'Maharashtra Day'],
  ['08-15', 'Independence Day'],
  ['10-02', 'Gandhi Jayanti'],
  ['12-25', 'Christmas'],
];

/* ------------------------------------------------------------------- fill */

export async function fillSampleData(api: SampleApi): Promise<void> {
  const o = `/orgs/${api.orgId}`;
  const short = (r: Res) => `${r.status} ${JSON.stringify(r.body ?? '').slice(0, 200)}`;
  /** The body if the call worked; otherwise logs and gives null. */
  const ok = (r: Res, what: string) => {
    if (r.status >= 200 && r.status < 300) return r.body;
    api.log(`! ${what}: ${short(r)}`);
    return null;
  };
  const list = async (path: string, key: string): Promise<any[]> => {
    const r = await api.get(path);
    return r.status < 300 && Array.isArray(r.body?.[key]) ? r.body[key] : [];
  };
  const step = async (name: string, fn: () => Promise<void>) => {
    const t = Date.now();
    try {
      await fn();
    } catch (e: any) {
      api.log(`! ${name} stopped: ${String(e?.message || e).slice(0, 200)}`);
    }
    api.log(`${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  };

  /* The apps the sample shows, on (only what is off is switched, so a second run writes nothing). */
  const features = (await api.get(`${o}/features`)).body?.features || {};
  const wanted = ['people', 'attendance', 'payroll', 'paymentTerms', 'creditNotes', 'debitNotes', 'expenses'];
  const off = Object.fromEntries(wanted.filter((k) => k in features && !features[k]).map((k) => [k, true]));
  if (Object.keys(off).length) ok(await api.put(`${o}/features`, { features: off }), 'switching the apps on');

  const ctx = {
    customers: new Map<string, any>(),
    vendors: new Map<string, any>(),
    items: new Map<string, any>(),
    warehouseId: null as string | null,
    bankId: null as string | null,
    ledgers: {} as Record<string, string | null>,
    employees: new Map<string, any>(),
  };

  await step('books: parties, items, ledgers', () => books(api, o, ok, list, ctx));
  /* Then two chains side by side, as two people would work: the Books documents, and People through to Payroll. */
  await Promise.all([
    (async () => {
      /* Bills before invoices: the goods are in the store before they are sold. */
      await step('books: bills and payments', () => purchases(api, o, ok, list, ctx));
      await step('books: invoices and receipts', () => sales(api, o, ok, list, ctx));
    })(),
    (async () => {
      await step('people: departments, positions, employees', () => people(api, o, ok, list, ctx));
      /* Leave and attendance before the payroll that takes last month's days. */
      await step('time: holidays, leave, attendance', () => time(api, o, ok, list, ctx));
      await step('payroll: setup, profiles, last month posted', () => payroll(api, o, ok, list, ctx));
    })(),
  ]);
}

type Ok = (r: Res, what: string) => any;
type List = (path: string, key: string) => Promise<any[]>;
type Ctx = {
  customers: Map<string, any>;
  vendors: Map<string, any>;
  items: Map<string, any>;
  warehouseId: string | null;
  bankId: string | null;
  ledgers: Record<string, string | null>;
  employees: Map<string, any>;
};

/* ------------------------------------------------------------------ books */

async function books(api: SampleApi, o: string, ok: Ok, list: List, ctx: Ctx) {
  const partyBody = (p: Party, serial: number) => {
    const pan = companyPan(p.name, serial);
    const slug = p.name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
    return {
      name: p.name,
      gstin: gstinFor(p.code, pan),
      gstRegistrationType: 'REGULAR',
      pan,
      placeOfSupplyState: p.state,
      email: `accounts@${slug}.example`,
      phone: `98000${String(10000 + serial * 37).padStart(5, '0')}`,
      contactPerson: p.contact,
      paymentTermDays: p.days,
      paymentTermName: `Net ${p.days}`,
      billingLine1: p.line1,
      billingCity: p.city,
      billingState: p.state,
      billingPincode: p.pincode,
      billingCountry: 'India',
      shippingSameAsBilling: true,
    };
  };

  for (const [kind, parties, map, first] of [
    ['customers', CUSTOMERS, ctx.customers, 1],
    ['vendors', VENDORS, ctx.vendors, 21],
  ] as const) {
    const have = new Map((await list(`${o}/${kind}?limit=500`, kind)).map((p) => [p.name, p]));
    for (const [i, p] of parties.entries()) {
      let row = have.get(p.name);
      if (!row) row = ok(await api.post(`${o}/${kind}`, partyBody(p, first + i)), `${kind} ${p.name}`)?.party;
      if (row) map.set(p.name, row);
    }
  }

  const warehouses = await list(`${o}/warehouses`, 'warehouses');
  ctx.warehouseId = (warehouses.find((w) => w.name === 'Main Store') || warehouses[0])?.id || null;

  const haveItems = new Map((await list(`${o}/items?limit=500&includeInactive=true`, 'items')).map((i) => [i.name, i]));
  for (const it of ITEMS) {
    let row = haveItems.get(it.name);
    if (!row) {
      row = ok(
        await api.post(`${o}/items`, {
          name: it.name,
          itemType: it.type,
          unit: it.unit,
          hsnSac: it.hsnSac,
          gstRate: it.gstRate,
          salePrice: it.sale,
          purchasePrice: it.buy,
          ...(it.type === 'STOCK' ? { openingQty: it.opening, openingWarehouseId: ctx.warehouseId, reorderLevel: Math.round(it.opening / 10) } : {}),
        }),
        `item ${it.name}`
      )?.item;
    }
    if (row) ctx.items.set(it.name, row);
  }

  /* The bank account money comes in and goes out through, and the ledgers a salary posts to: made here, before the two chains run side by side. */
  const accounts = await list(`${o}/ledger/accounts`, 'accounts');
  const ledger = async (name: string, accountType: string, controlKind?: string) =>
    accounts.find((a) => String(a.name).toLowerCase() === name.toLowerCase())?.id ||
    ok(await api.post(`${o}/ledger/accounts`, { name, accountType, ...(controlKind ? { controlKind } : {}) }), `ledger ${name}`)?.account?.id ||
    null;
  ctx.bankId = await ledger('Sample Bank Current A/c', 'ASSET', 'BANK');
  ctx.ledgers = {
    salaries: await ledger('Salaries & Wages', 'EXPENSE'),
    pfExpense: await ledger('Employer PF Contribution', 'EXPENSE'),
    pfPayable: await ledger('PF Payable', 'LIABILITY'),
    ptPayable: await ledger('Professional Tax Payable', 'LIABILITY'),
    tdsPayable: await ledger('TDS on Salary Payable', 'LIABILITY'),
  };
}

/** A document's lines and totals, with GST split by where the party is. */
function docLines(lines: Array<[number, number]>, ctx: Ctx, intra: boolean, price: 'sale' | 'buy') {
  let subtotal = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  const items = lines.map(([idx, qty]) => {
    const it = ITEMS[idx];
    const row = ctx.items.get(it.name);
    const rate = it[price] || it.sale;
    const taxable = round2(qty * rate);
    const gst = round2((taxable * it.gstRate) / 100);
    const c = intra ? round2(gst / 2) : 0;
    const s = intra ? round2(gst - c) : 0;
    const i = intra ? 0 : gst;
    subtotal += taxable;
    cgst += c;
    sgst += s;
    igst += i;
    return {
      itemId: row?.id ?? null,
      description: it.name,
      hsnSac: it.hsnSac,
      quantity: qty,
      rate,
      gstRate: it.gstRate,
      amount: taxable,
      taxableAmount: taxable,
      gstAmount: gst,
      cgstAmount: c,
      sgstAmount: s,
      igstAmount: i,
      lineTotal: round2(taxable + gst),
      taxType: intra ? 'CGST_SGST' : 'IGST',
    };
  });
  subtotal = round2(subtotal);
  cgst = round2(cgst);
  sgst = round2(sgst);
  igst = round2(igst);
  const gstTotal = round2(cgst + sgst + igst);
  return { items, subtotal, cgstTotal: cgst, sgstTotal: sgst, igstTotal: igst, gstTotal, total: round2(subtotal + gstTotal), taxType: intra ? 'CGST_SGST' : 'IGST' };
}

async function sales(api: SampleApi, o: string, ok: Ok, list: List, ctx: Ctx) {
  const today = todayIst();
  const have = new Map((await list(`${o}/invoices?limit=1000`, 'invoices')).map((i) => [i.number, i]));
  const receipts = new Set((await list(`${o}/payments?direction=RECEIPT&limit=200`, 'payments')).map((p) => p.number));
  let made = 0;
  let paid = 0;
  for (const [n, lines] of INVOICE_LINES.entries()) {
    const number = `SMP-INV-${String(n + 1).padStart(3, '0')}`;
    const p = CUSTOMERS[(n * 3) % CUSTOMERS.length];
    const party = ctx.customers.get(p.name);
    if (!party) continue;
    /* Spread over the last three months, the newest two days ago. */
    const date = workday(-(88 - Math.round(n * 4.5)));
    const due = addDays(date, p.days);
    let inv = have.get(number);
    if (!inv) {
      const doc = docLines(lines, ctx, p.code === '27', 'sale');
      inv = ok(
        await api.post(`${o}/invoices`, {
          number,
          date,
          dueDate: due,
          customerId: party.id,
          customerName: party.name,
          customerGstin: party.gstin,
          placeOfSupplyState: p.state,
          warehouseId: ctx.warehouseId,
          status: due < today && !PAID_SHARE[n] ? 'Overdue' : 'Unpaid',
          ...doc,
        }),
        `invoice ${number}`
      )?.invoice;
      if (inv) made += 1;
    }
    const share = PAID_SHARE[n];
    const rnum = `SMP-RCT-${String(n + 1).padStart(3, '0')}`;
    if (!inv || !share || receipts.has(rnum) || !ctx.bankId) continue;
    const amount = round2(Number(inv.total) * share);
    const on = minDate(addDays(date, 8 + (n % 4) * 5), addDays(today, -1));
    const r = ok(
      await api.post(`${o}/payments`, {
        direction: 'RECEIPT',
        number: rnum,
        date: on,
        partyType: 'CUSTOMER',
        partyId: party.id,
        partyName: party.name,
        ledgerAccountId: ctx.bankId,
        instrumentRef: `NEFT${String(700100 + n * 13)}`,
        instrumentDate: on,
        amount,
        notes: share < 1 ? `Part payment against ${number}` : `Against ${number}`,
        allocations: [{ docType: 'INVOICE', docId: inv.id, amount }],
      }),
      `receipt ${rnum}`
    );
    if (r) paid += 1;
  }
  api.log(`  invoices made ${made}, receipts made ${paid}`);
}

async function purchases(api: SampleApi, o: string, ok: Ok, list: List, ctx: Ctx) {
  const today = todayIst();
  const have = new Map((await list(`${o}/bills?limit=500`, 'bills')).map((b) => [b.number, b]));
  const payments = new Set((await list(`${o}/payments?direction=PAYMENT&limit=200`, 'payments')).map((p) => p.number));
  let made = 0;
  let paid = 0;
  for (const [n, [vi, lines]] of BILLS.entries()) {
    const number = `SMP-BILL-${String(n + 1).padStart(3, '0')}`;
    const p = VENDORS[vi];
    const party = ctx.vendors.get(p.name);
    if (!party) continue;
    const date = workday(-(92 - n * 11));
    let bill = have.get(number);
    if (!bill) {
      const doc = docLines(lines, ctx, p.code === '27', 'buy');
      bill = ok(
        await api.post(`${o}/bills`, {
          number,
          date,
          dueDate: addDays(date, p.days),
          refNo: `${p.name.split(' ')[0].slice(0, 3).toUpperCase()}/${2600 + n * 7}`,
          refDate: date,
          partyId: party.id,
          partyName: party.name,
          partyGstin: party.gstin,
          placeOfSupplyState: 'Maharashtra',
          warehouseId: ctx.warehouseId,
          status: 'Unpaid',
          ...doc,
        }),
        `bill ${number}`
      )?.document;
      if (bill) made += 1;
    }
    const share = BILL_PAID_SHARE[n];
    const pnum = `SMP-PAY-${String(n + 1).padStart(3, '0')}`;
    if (!bill || !share || payments.has(pnum) || !ctx.bankId) continue;
    const amount = round2(Number(bill.total) * share);
    const on = minDate(addDays(date, p.days - 3), addDays(today, -1));
    const r = ok(
      await api.post(`${o}/payments`, {
        direction: 'PAYMENT',
        number: pnum,
        date: on,
        partyType: 'VENDOR',
        partyId: party.id,
        partyName: party.name,
        ledgerAccountId: ctx.bankId,
        instrumentRef: `RTGS${String(500200 + n * 17)}`,
        instrumentDate: on,
        amount,
        notes: share < 1 ? `Part payment against ${bill.refNo || number}` : `Against ${bill.refNo || number}`,
        allocations: [{ docType: 'BILL', docId: bill.id, amount }],
      }),
      `payment ${pnum}`
    );
    if (r) paid += 1;
  }
  api.log(`  bills made ${made}, payments made ${paid}`);
}

/* ----------------------------------------------------------------- people */

async function people(api: SampleApi, o: string, ok: Ok, list: List, ctx: Ctx) {
  const P = `${o}/people`;
  const depts = new Map((await list(`${P}/structure/departments`, 'items')).map((d) => [d.name, d.id]));
  for (const name of Object.keys(DEPARTMENTS)) {
    if (!depts.has(name)) {
      const id = ok(await api.post(`${P}/structure/departments`, { name }), `department ${name}`)?.item?.id;
      if (id) depts.set(name, id);
    }
  }
  const positions = new Map((await list(`${P}/structure/job-positions`, 'items')).map((d) => [d.name, d.id]));
  for (const [dept, names] of Object.entries(DEPARTMENTS)) {
    for (const name of names) {
      if (positions.has(name)) continue;
      const id = ok(await api.post(`${P}/structure/job-positions`, { name, departmentId: depts.get(dept) }), `position ${name}`)?.item?.id;
      if (id) positions.set(name, id);
    }
  }

  const have = new Map((await list(`${P}/employees?limit=500`, 'employees')).map((e) => [e.code, e]));
  let made = 0;
  for (const [i, p] of PEOPLE.entries()) {
    let row = have.get(p.code);
    if (!row) {
      const email = `${p.first}.${p.last}@sample-traders.example`.toLowerCase();
      row = ok(
        await api.post(`${P}/employees`, {
          firstName: p.first,
          lastName: p.last,
          code: p.code,
          gender: p.gender,
          dateOfJoining: p.joined,
          departmentId: depts.get(p.dept),
          jobPositionId: positions.get(p.position),
          reportingManagerId: p.manager ? ctx.employees.get(p.manager)?.id : undefined,
          workEmail: email,
          email,
          phone: `98000${String(20000 + i * 41).padStart(5, '0')}`,
          city: 'Pune',
          state: 'Maharashtra',
          country: 'India',
          workLocation: 'Pune head office',
        }),
        `employee ${p.code}`
      )?.employee;
      if (row) made += 1;
    }
    if (row) ctx.employees.set(p.code, row);
  }
  api.log(`  employees made ${made} of ${PEOPLE.length}`);
}

/* ------------------------------------------------------------------- time */

async function time(api: SampleApi, o: string, ok: Ok, list: List, ctx: Ctx) {
  const A = `${o}/attendance`;
  const today = todayIst();
  const from = monthBack(1).startDate;
  const to = addDays(today, -1);

  /* Holidays in the window. */
  const holidays = new Set<string>();
  for (const year of new Set([from.slice(0, 4), to.slice(0, 4)])) {
    const have = new Set((await list(`${A}/holidays?year=${year}`, 'holidays')).map((h) => h.date));
    for (const [md, name] of FIXED_HOLIDAYS) {
      const date = `${year}-${md}`;
      if (date < from || date > addDays(today, 60)) continue;
      holidays.add(date);
      if (!have.has(date)) ok(await api.post(`${A}/holidays`, { date, name }), `holiday ${name}`);
    }
  }

  /* Leave types, then the requests: approved ones before the days around them are marked. */
  const types = new Map((await list(`${A}/leave/types`, 'types')).map((t) => [t.code || t.name, t]));
  for (const t of LEAVE_TYPES) {
    if (types.has(t.code)) continue;
    const row = ok(await api.post(`${A}/leave/types`, { isPaid: true, accrual: 'YEARLY', allowHalfDay: true, ...t }), `leave type ${t.name}`)?.type;
    if (row) types.set(t.code, row);
  }
  const requests = await list(`${A}/leave/requests?limit=500`, 'requests');
  const leaveDays = new Set<string>();
  for (const [code, typeCode, back, days, reason, approve] of LEAVE) {
    const emp = ctx.employees.get(code);
    const type = types.get(typeCode);
    if (!emp || !type) continue;
    /* `days` working days from the start, past Sundays and holidays. */
    let fromDate = workday(back);
    while (holidays.has(fromDate) || isSunday(fromDate)) fromDate = addDays(fromDate, 1);
    let toDate = fromDate;
    for (let left = days - 1; left > 0; ) {
      toDate = addDays(toDate, 1);
      if (!isSunday(toDate) && !holidays.has(toDate)) left -= 1;
    }
    for (let d = fromDate; d <= toDate; d = addDays(d, 1)) leaveDays.add(`${emp.id}|${d}`);
    if (requests.some((r) => r.employeeId === emp.id && r.fromDate === fromDate)) continue;
    const made = ok(await api.post(`${A}/leave/requests`, { employeeId: emp.id, leaveTypeId: type.id, fromDate, toDate, reason }), `leave for ${code}`)?.request;
    if (made && approve && made.status === 'PENDING') ok(await api.post(`${A}/leave/requests/${made.id}/approve`, { note: 'Approved' }), `approving leave for ${code}`);
  }

  /* Attendance from the first of last month to yesterday: the days not yet recorded. */
  const recorded = new Set((await list(`${A}/records?from=${from}&to=${to}`, 'records')).map((r) => `${r.employeeId}|${r.date}`));
  const rows: any[] = [];
  for (const [i, p] of PEOPLE.entries()) {
    const emp = ctx.employees.get(p.code);
    if (!emp) continue;
    let n = 0;
    for (let d = maxDate(from, p.joined); d <= to; d = addDays(d, 1)) {
      n += 1;
      if (isSunday(d) || holidays.has(d)) continue;
      const key = `${emp.id}|${d}`;
      if (recorded.has(key) || leaveDays.has(key)) continue;
      const seed = (i * 31 + n * 17) % 97;
      if (seed === 5 || seed === 61) {
        rows.push({ employeeCode: p.code, date: d, status: 'ABSENT', note: 'Did not come in' });
        continue;
      }
      /* Mostly on time; now and then late (and staying on to make the day up), or a long day. */
      const late = seed % 13 === 0;
      const inMin = 9 * 60 + (late ? 22 + (seed % 15) : seed % 9);
      const outMin = inMin + 9 * 60 + (late ? 2 : 0) + (seed % 11 === 0 ? 60 + (seed % 30) : seed % 20);
      const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      rows.push({ employeeCode: p.code, date: d, checkIn: hhmm(inMin), checkOut: hhmm(outMin) });
    }
  }
  if (rows.length) {
    /* Attendance is kept on CLOR from the first of last month; days before that are not counted absent. */
    ok(await api.put(`${A}/start-date`, { date: from }), 'attendance start date');
    const r = ok(await api.post(`${A}/records/import`, { rows }), 'attendance import');
    if (r) api.log(`  attendance days imported ${r.imported}, refused ${r.failed}${r.failed ? `: ${JSON.stringify(r.results.slice(0, 3))}` : ''}`);
  }
}

/* ---------------------------------------------------------------- payroll */

async function payroll(api: SampleApi, o: string, ok: Ok, list: List, ctx: Ctx) {
  const Y = `${o}/payroll`;
  const period = monthBack(1);
  const { fy, start: fyStart } = fyOf(period.startDate);

  const { salaries, pfExpense, pfPayable, ptPayable, tdsPayable } = ctx.ledgers;

  /* The statutory schemes in force: PF, PT and TDS on (ESI does not reach these salaries). */
  let schemes = await list(`${Y}/statutory`, 'schemes');
  if (!schemes.length) {
    ok(await api.post(`${Y}/statutory/seed`), 'statutory rates');
    schemes = await list(`${Y}/statutory`, 'schemes');
  }
  for (const s of schemes.filter((x) => ['PF', 'PT', 'TDS'].includes(x.code) && !x.isEnabled)) {
    ok(await api.put(`${Y}/statutory/schemes/${s.id}`, { isEnabled: true }), `switching ${s.code} on`);
  }

  /* What a salary is made of. */
  const comps = new Map((await list(`${Y}/components`, 'components')).map((c) => [c.code, c.id]));
  const component = async (body: Record<string, unknown>) => {
    const code = String(body.code);
    if (!comps.has(code)) {
      const id = ok(await api.post(`${Y}/components`, body), `component ${code}`)?.component?.id;
      if (id) comps.set(code, id);
    }
    return comps.get(code) as string | undefined;
  };
  const lines = [
    await component({ name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC', includeInPfWage: true, expenseLedgerId: salaries, displayOrder: 1 }),
    await component({ name: 'House rent allowance', code: 'HRA', type: 'EARNING', calculationMethod: 'FORMULA', formula: 'BASIC * 0.4', expenseLedgerId: salaries, displayOrder: 2 }),
    await component({ name: 'Special allowance', code: 'SPECIAL', type: 'EARNING', calculationMethod: 'BALANCING', expenseLedgerId: salaries, displayOrder: 3 }),
    await component({ name: 'Provident fund (employee)', code: 'EPF', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'PF', includeInGross: false, isTaxable: false, liabilityLedgerId: pfPayable, displayOrder: 10 }),
    await component({ name: 'Professional tax', code: 'PT', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'PT', includeInGross: false, isTaxable: false, liabilityLedgerId: ptPayable, displayOrder: 11 }),
    await component({ name: 'Income tax (TDS)', code: 'TDS', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'TDS', includeInGross: false, isTaxable: false, liabilityLedgerId: tdsPayable, displayOrder: 12 }),
    await component({ name: 'Provident fund (employer)', code: 'ER_PF', type: 'EMPLOYER_CONTRIBUTION', calculationMethod: 'STATUTORY', statutoryScheme: 'PF', includeInGross: false, includeInNetPay: false, isTaxable: false, expenseLedgerId: pfExpense, liabilityLedgerId: pfPayable, displayOrder: 20 }),
  ];
  if (lines.some((x) => !x)) throw new Error('the salary components are not all there');

  const STRUCTURE = 'Staff, monthly';
  const structureId =
    (await list(`${Y}/structures`, 'structures')).find((s) => s.name === STRUCTURE)?.id ||
    ok(
      await api.post(`${Y}/structures`, {
        name: STRUCTURE,
        frequency: 'MONTHLY',
        effectiveFrom: fyStart,
        status: 'ACTIVE',
        components: lines.map((componentId, i) => ({ componentId, displayOrder: i + 1, ...(i === 2 ? { isBalancing: true } : {}) })),
      }),
      'salary structure'
    )?.structure?.id;
  if (!structureId) throw new Error('no salary structure');

  /* The payroll half of each person: on the People record, not a second employee. */
  const assigned = new Set((await list(`${Y}/assignments`, 'assignments')).map((a) => a.employeeId));
  const profiles = new Map((await list(`${Y}/employees?limit=500`, 'employees')).map((e) => [e.id, e]));
  for (const [i, p] of PEOPLE.entries()) {
    const emp = ctx.employees.get(p.code);
    if (!emp) continue;
    const current = profiles.get(emp.id);
    if (current && !current.payroll) {
      const serial = String(i + 1).padStart(4, '0');
      ok(
        await api.put(`${Y}/employees/${emp.id}`, {
          name: current.name,
          code: current.code,
          email: current.email,
          phone: current.phone,
          designation: current.designation,
          department: current.department,
          dateOfJoining: current.dateOfJoining,
          dateOfLeaving: current.dateOfLeaving,
          status: current.status,
          branchId: current.branchId,
          notes: current.notes,
          payroll: {
            payrollStatus: 'IN_PAYROLL',
            bankAccountName: current.name,
            bankAccountNumber: `00001234${serial}`,
            bankIfsc: 'SMPL0000001',
            bankName: 'Sample Bank',
            pan: `AAAP${p.last[0]}${serial}A`,
            uan: `10000000${serial}`,
            taxRegime: 'NEW',
            professionalTaxState: 'Maharashtra',
            pfApplicable: true,
            esiApplicable: false,
            ptApplicable: true,
          },
        }),
        `payroll profile ${p.code}`
      );
    }
    if (!assigned.has(emp.id)) {
      ok(await api.post(`${Y}/assignments`, { employeeId: emp.id, structureId, effectiveFrom: maxDate(fyStart, p.joined), annualCtc: p.ctc }), `salary for ${p.code}`);
    }
  }

  /* Pay earlier this year, before the company's payroll came to CLOR: income tax needs it. */
  const opening = await api.get(`${Y}/opening-ytd?fy=${fy}`);
  for (const row of opening.body?.people || []) {
    if (row.opening) continue;
    const p = PEOPLE.find((x) => x.code === row.code);
    if (!p) continue;
    const startedOn = maxDate(fyStart, p.joined);
    const months = (Number(period.startDate.slice(0, 4)) - Number(startedOn.slice(0, 4))) * 12 + Number(period.startDate.slice(5, 7)) - Number(startedOn.slice(5, 7));
    if (months <= 0) continue;
    const monthly = p.ctc / 12;
    const basic = round2(monthly * 0.5);
    const pf = Math.min(round2(basic * 0.12), 1800);
    const gross = round2(monthly - pf);
    const pt = p.gender === 'FEMALE' ? (gross > 25_000 ? 200 : 0) : gross > 10_000 ? 200 : gross > 7_500 ? 175 : 0;
    ok(
      await api.put(`${Y}/opening-ytd/${row.employeeId}?fy=${fy}`, {
        grossPay: round2(gross * months),
        basicDa: round2(basic * months),
        hraReceived: round2(basic * 0.4 * months),
        employeePf: round2(pf * months),
        professionalTax: pt * months,
        tds: 0,
        throughMonth: addDays(period.startDate, -1).slice(0, 7),
        note: 'Paid on the earlier payroll system',
      }),
      `pay earlier this year for ${p.code}`
    );
  }

  /* Last month's payroll, taken all the way to the ledger. */
  const periods = await list(`${Y}/periods`, 'periods');
  const periodId =
    periods.find((x) => x.startDate === period.startDate)?.id ||
    ok(await api.post(`${Y}/periods`, { ...period, paymentDate: period.endDate }), `pay period ${period.name}`)?.period?.id;
  if (!periodId) return;
  let run = (await list(`${Y}/runs`, 'runs')).find((r) => r.periodId === periodId && r.status !== 'CANCELLED');
  if (!run) run = ok(await api.post(`${Y}/runs`, { periodId }), 'starting the payroll')?.run;
  if (!run) return;
  const id = run.id;
  const statusOf = async () => String((await api.get(`${Y}/runs/${id}`)).body?.run?.status || '');
  let status = String(run.status);
  if (!['CALCULATED', 'REVIEW', 'APPROVED', 'LOCKED', 'POSTED', 'PAID'].includes(status)) {
    if (!ok(await api.post(`${Y}/runs/${id}/validate`), 'validating the payroll')) return;
    if (!ok(await api.post(`${Y}/runs/${id}/calculate`), 'calculating the payroll')) return;
    status = await statusOf();
  }
  if (status === 'CALCULATED') {
    if (!ok(await api.post(`${Y}/runs/${id}/submit-review`), 'sending the payroll for review')) return;
    status = 'REVIEW';
  }
  /* Approved by the second director: whoever prepared a payroll does not approve it (maker-checker). */
  if (status === 'REVIEW') {
    let r = await api.approver.post(`${Y}/runs/${id}/approve`);
    /* A state rule nobody has confirmed against its notice: confirmed here, as an owner would. */
    if (r.status === 409 && r.body?.code === 'RULE_NEEDS_CHECK') {
      for (const c of r.body.checks || []) ok(await api.post(`${Y}/statutory/rules/${c.ruleId}/confirm`), 'confirming a state rule');
      r = await api.approver.post(`${Y}/runs/${id}/approve`);
    }
    if (!ok(r, 'approving the payroll')) return;
    status = 'APPROVED';
  }
  if (status === 'APPROVED') {
    if (!ok(await api.post(`${Y}/runs/${id}/post`, { postingDate: period.endDate }), 'posting the payroll')) return;
  }
  const done = (await api.get(`${Y}/runs/${id}`)).body?.run;
  api.log(`  payroll ${done?.number}: ${done?.status}, ${done?.employeeCount} people, net ${done?.netTotal}`);
}
