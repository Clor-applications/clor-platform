/**
 * The four figures a dashboard opens with, and the rule that keeps them honest.
 *
 * Two of them are **balances** — what is true right now — and two are **flows**
 * — what happened over a window. Applying a period filter to a balance produces
 * a number that means nothing: "cash available in the last 30 days" is not a
 * quantity. So the period never reaches the balances, and the balances say
 * "as of today" on their face.
 *
 * Everything here is derived from documents the book already holds. Nothing is
 * stored, so nothing can drift out of step with the ledger.
 */

const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const arr = (v) => (Array.isArray(v) ? v : []);

const isDraft = (r) => String(r?.status || '').trim().toLowerCase() === 'draft';
const isCancelled = (r) => String(r?.status || '').trim().toLowerCase() === 'cancelled';

/** A document that is live on the books: not a draft, not cancelled. */
const isLive = (r) => !isDraft(r) && !isCancelled(r);

const ymd = (v) => String(v || '').slice(0, 10);

/** Local date parts, never toISOString — that shifts a day for anyone east of UTC. */
export const todayIso = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const daysBetween = (fromIso, toIso) => {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
};

/**
 * Cash and bank, per the books.
 *
 * Deliberately labelled that way wherever it is shown. There is no bank feed
 * in this product, so this figure is what the ledger says, not what the
 * passbook says — and the two will differ. Calling it "your bank balance"
 * would be a claim the product cannot support, and the first person to find a
 * discrepancy stops trusting every other number on the page.
 *
 * Opening balances of the cash and bank ledgers, plus money in, less money out.
 */
export const cashPosition = (db, companyId) => {
  const groups = arr(db?.accountGroups).filter((g) => g.companyId === companyId && !g.isLegacy);
  const groupById = new Map(groups.map((g) => [String(g.id), g]));

  const underRoot = (groupId, rootLower) => {
    let cur = groupById.get(String(groupId || '')) || null;
    const seen = new Set();
    while (cur && !seen.has(String(cur.id))) {
      seen.add(String(cur.id));
      if (String(cur.name || '').trim().toLowerCase() === rootLower) return true;
      const pid = cur.parentGroupId;
      if (pid === null || pid === undefined || pid === '') return false;
      cur = groupById.get(String(pid)) || null;
    }
    return false;
  };

  const accounts = arr(db?.chartOfAccounts)
    .filter((a) => a.companyId === companyId)
    .filter((a) => underRoot(a.groupId, 'bank accounts') || underRoot(a.groupId, 'cash-in-hand'));

  const opening = accounts.reduce((t, a) => t + num(a.openingBalance ?? a.balance), 0);

  const movements = arr(db?.payments).filter((p) => p.companyId === companyId);
  const inflow = movements
    .filter((p) => String(p.direction || '').toUpperCase() === 'IN')
    .reduce((t, p) => t + num(p.amount), 0);
  const outflow = movements
    .filter((p) => String(p.direction || '').toUpperCase() === 'OUT')
    .reduce((t, p) => t + num(p.amount), 0);

  const byAccount = accounts
    .map((a) => ({
      id: String(a.id),
      name: String(a.name || 'Account').trim(),
      bank: String(a.bankDetails?.bankName || '').trim(),
      opening: num(a.openingBalance ?? a.balance),
    }))
    .sort((x, y) => y.opening - x.opening);

  return { total: opening + inflow - outflow, accounts: byAccount, inflow, outflow, accountCount: accounts.length };
};

/** Ageing buckets, in the order a collections conversation actually goes. */
export const AGEING_BUCKETS = [
  { key: 'notDue', label: 'Not due', tone: 'pos' },
  { key: 'd30', label: '1–30 days', tone: 'warn' },
  { key: 'd60', label: '31–60 days', tone: 'warn2' },
  { key: 'd90', label: '61–90 days', tone: 'neg2' },
  { key: 'd90plus', label: '90+ days', tone: 'neg' },
];

/**
 * What customers owe, as of today — across every open invoice, not only those
 * raised inside the selected period.
 *
 * This is the balance rule doing real work. Ageing was previously computed from
 * the invoices in the chosen window, so a five-month-old unpaid invoice was
 * absent from the 90+ bucket on a 90-day view: the one invoice you most need to
 * see was the one the filter removed.
 */
export const receivables = (db, companyId, asOf = todayIso()) => {
  const open = arr(db?.invoices)
    .filter((i) => i.companyId === companyId && isLive(i))
    .map((i) => ({ ...i, balance: Math.max(0, num(i.total) - num(i.paidAmount)) }))
    .filter((i) => i.balance > 0.004);

  const buckets = Object.fromEntries(AGEING_BUCKETS.map((b) => [b.key, 0]));
  let overdue = 0;
  let oldestDays = 0;

  for (const inv of open) {
    const due = ymd(inv.dueDate || inv.date);
    const late = due ? daysBetween(due, asOf) : 0;
    if (late <= 0) buckets.notDue += inv.balance;
    else {
      overdue += inv.balance;
      oldestDays = Math.max(oldestDays, late);
      if (late <= 30) buckets.d30 += inv.balance;
      else if (late <= 60) buckets.d60 += inv.balance;
      else if (late <= 90) buckets.d90 += inv.balance;
      else buckets.d90plus += inv.balance;
    }
  }

  const total = open.reduce((t, i) => t + i.balance, 0);

  const byCustomer = [...open
    .reduce((map, inv) => {
      const name = String(inv.customerName || 'Unnamed customer').trim() || 'Unnamed customer';
      const prev = map.get(name) || { name, amount: 0, oldest: 0 };
      const late = Math.max(0, daysBetween(ymd(inv.dueDate || inv.date), asOf));
      map.set(name, { name, amount: prev.amount + inv.balance, oldest: Math.max(prev.oldest, late) });
      return map;
    }, new Map())
    .values()]
    .sort((a, b) => b.amount - a.amount);

  return { total, overdue, buckets, oldestDays, count: open.length, byCustomer };
};

/**
 * What is owed to vendors, as of today, and what falls due inside a week.
 *
 * The dashboard watched receivables and ignored this entirely, which is how a
 * business that is owed money still runs out of it.
 */
export const payables = (db, companyId, asOf = todayIso()) => {
  const open = [...arr(db?.bills), ...arr(db?.expenses)]
    .filter((b) => b.companyId === companyId && isLive(b))
    .map((b) => ({
      number: b.number,
      vendorName: String(b.vendorName || 'Vendor').trim(),
      due: ymd(b.dueDate || b.date),
      balance: Math.max(0, num(b.total) - num(b.paidAmount)),
    }))
    .filter((b) => b.balance > 0.004);

  const weekAhead = daysBetween.bind(null);
  const dueThisWeek = open
    .filter((b) => {
      const d = weekAhead(asOf, b.due);
      return d >= 0 && d <= 7;
    })
    .reduce((t, b) => t + b.balance, 0);

  const overdue = open.filter((b) => daysBetween(b.due, asOf) > 0).reduce((t, b) => t + b.balance, 0);

  return {
    total: open.reduce((t, b) => t + b.balance, 0),
    dueThisWeek,
    overdue,
    count: open.length,
    rows: open.sort((a, b) => String(a.due).localeCompare(String(b.due))).slice(0, 5),
  };
};

/**
 * GST for the month a return is next filed for, and how long is left to file.
 *
 * Output tax on live invoices, less input credit on live purchase bills. Drafts
 * are excluded on both sides: a draft is an intention, and one that is still a
 * draft on the 11th simply is not in the return.
 *
 * The dates are the statutory ones for a monthly filer — GSTR-1 on the 11th,
 * GSTR-3B on the 20th, both for the previous month. Quarterly filers are not
 * modelled here and would report a deadline that is not theirs, so the caller
 * shows this only when monthly filing is set.
 */
export const gstPosition = (db, companyId, asOf = todayIso()) => {
  const [y, m] = asOf.split('-').map(Number);
  // Before the 11th the live return is still last month's; after it, this
  // month's is the one being accumulated.
  const day = Number(asOf.slice(8, 10));
  const forMonth = day <= 11 ? m - 1 : m;
  const year = forMonth < 1 ? y - 1 : y;
  const month = forMonth < 1 ? 12 : forMonth;
  const prefix = `${year}-${String(month).padStart(2, '0')}`;

  const inMonth = (r) => ymd(r.date).startsWith(prefix);

  const output = arr(db?.invoices)
    .filter((i) => i.companyId === companyId && isLive(i) && inMonth(i))
    .reduce((t, i) => t + num(i.gstTotal), 0);

  const input = arr(db?.bills)
    .filter((b) => b.companyId === companyId && isLive(b) && inMonth(b))
    .reduce((t, b) => t + num(b.gstTotal), 0);

  const draftsInMonth = arr(db?.invoices).filter(
    (i) => i.companyId === companyId && isDraft(i) && inMonth(i)
  ).length;

  const nextMonth = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const gstr1Due = `${nextMonth.y}-${String(nextMonth.m).padStart(2, '0')}-11`;
  const gstr3bDue = `${nextMonth.y}-${String(nextMonth.m).padStart(2, '0')}-20`;

  return {
    monthLabel: new Date(`${prefix}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    output,
    input,
    payable: Math.max(0, output - input),
    creditCarried: Math.max(0, input - output),
    gstr1Due,
    gstr3bDue,
    daysToGstr1: daysBetween(asOf, gstr1Due),
    daysToGstr3b: daysBetween(asOf, gstr3bDue),
    draftsInMonth,
  };
};

/**
 * Money in and money out per bucket, plus the closing cash line.
 *
 * Actual movements, not documents: a receipt is cash, an invoice is a promise.
 * The closing balance walks backwards from today's cash so the last point on
 * the line agrees with the Cash card above it — a chart that ends on a
 * different number from the card beside it destroys both.
 */
export const cashFlowSeries = (db, companyId, { days = 90, buckets = 6, asOf = todayIso() } = {}) => {
  const movements = arr(db?.payments).filter((p) => p.companyId === companyId);
  const end = new Date(`${asOf}T00:00:00Z`).getTime();
  const span = Math.max(1, Math.round(days / buckets));

  const out = [];
  for (let i = buckets - 1; i >= 0; i -= 1) {
    const to = end - i * span * 86_400_000;
    const from = to - span * 86_400_000;
    const inSlice = movements.filter((p) => {
      const t = new Date(`${ymd(p.date)}T00:00:00Z`).getTime();
      return Number.isFinite(t) && t > from && t <= to;
    });
    out.push({
      to: todayIso(new Date(to)),
      received: inSlice.filter((p) => String(p.direction || '').toUpperCase() === 'IN').reduce((t, p) => t + num(p.amount), 0),
      spent: inSlice.filter((p) => String(p.direction || '').toUpperCase() === 'OUT').reduce((t, p) => t + num(p.amount), 0),
    });
  }

  // Walk the closing balance backwards from the figure the Cash card shows.
  const cash = cashPosition(db, companyId).total;
  let running = cash;
  for (let i = out.length - 1; i >= 0; i -= 1) {
    out[i].closing = running;
    running -= out[i].received - out[i].spent;
  }
  return out;
};

/**
 * The setup steps a company has genuinely not done.
 *
 * Only real gaps in this book — never a generic tour. The card retires itself
 * the moment nothing is left, rather than lingering as a completed checklist,
 * because a finished job should leave the screen.
 */
export const setupGaps = (db, companyId) => {
  const has = (key, extra = () => true) => arr(db?.[key]).some((r) => r.companyId === companyId && extra(r));
  const liveInvoices = arr(db?.invoices).filter((i) => i.companyId === companyId && isLive(i));
  const drafts = arr(db?.invoices).filter((i) => i.companyId === companyId && isDraft(i));

  const steps = [
    { key: 'customer', done: has('customers'), label: 'Add a customer', hint: 'An invoice needs somebody to bill' },
    { key: 'item', done: has('items'), label: 'Add an item or service', hint: 'What you are selling' },
    {
      key: 'ledger',
      done: cashPosition(db, companyId).accountCount > 0,
      label: 'Open a cash or bank ledger',
      hint: 'So receipts have somewhere to land',
    },
    {
      key: 'invoice',
      done: liveInvoices.length > 0,
      label: drafts.length ? `Finalise your ${drafts.length} draft invoice${drafts.length === 1 ? '' : 's'}` : 'Raise your first invoice',
      hint: drafts.length ? 'Nothing is owed to you until they go out' : 'The first one your customer sees',
    },
  ];

  return { steps, done: steps.filter((s) => s.done).length, total: steps.length, complete: steps.every((s) => s.done) };
};

/**
 * Where cash lands over the next N days, from documents already committed.
 *
 * **Finalised documents only.** A draft is an intention, and one draft can be
 * larger than the whole cash balance — a projection that swallows drafts is a
 * projection that swings on a document nobody has sent. Excluding them means
 * the line understates rather than flatters, which is the right direction for a
 * number somebody may pay a vendor on.
 *
 * Money already overdue is treated as arriving today rather than in the past:
 * it is still expected, and dropping it would flatter the opening point.
 */
export const cashForecast = (db, companyId, { days = 30, asOf = todayIso() } = {}) => {
  const start = cashPosition(db, companyId).total;

  const events = [];
  for (const inv of arr(db?.invoices).filter((i) => i.companyId === companyId && isLive(i))) {
    const bal = Math.max(0, num(inv.total) - num(inv.paidAmount));
    if (bal > 0.004) events.push({ day: Math.max(0, daysBetween(asOf, ymd(inv.dueDate || inv.date))), amount: bal });
  }
  for (const b of [...arr(db?.bills), ...arr(db?.expenses)].filter((r) => r.companyId === companyId && isLive(r))) {
    const bal = Math.max(0, num(b.total) - num(b.paidAmount));
    if (bal > 0.004) events.push({ day: Math.max(0, daysBetween(asOf, ymd(b.dueDate || b.date))), amount: -bal });
  }

  const points = [];
  let running = start;
  let lowest = { day: 0, value: start };
  for (let d = 0; d <= days; d += 1) {
    running += events.filter((e) => e.day === d).reduce((t, e) => t + e.amount, 0);
    points.push({ day: d, value: running });
    if (running < lowest.value) lowest = { day: d, value: running };
  }

  const expectedIn = events.filter((e) => e.amount > 0 && e.day <= days).reduce((t, e) => t + e.amount, 0);
  const expectedOut = -events.filter((e) => e.amount < 0 && e.day <= days).reduce((t, e) => t + e.amount, 0);

  return { start, points, end: running, lowest, expectedIn, expectedOut, days, hasEvents: events.length > 0 };
};

/**
 * Income against expenses, on either basis.
 *
 * The two answer different questions and must never be mixed on one screen:
 * accrual says what the business earned, cash says what reached the account.
 * A company can be profitable on accrual and unable to pay a vendor on cash,
 * which is precisely the situation the switch exists to reveal.
 */
export const incomeVsExpenses = (db, companyId, { basis = 'accrual', days = 90, buckets = 6, asOf = todayIso() } = {}) => {
  const end = new Date(`${asOf}T00:00:00Z`).getTime();
  const span = Math.max(1, Math.round(days / buckets));

  const sales =
    basis === 'cash'
      ? arr(db?.payments).filter((p) => p.companyId === companyId && String(p.direction || '').toUpperCase() === 'IN')
          .map((p) => ({ date: p.date, amount: num(p.amount) }))
      : arr(db?.invoices).filter((i) => i.companyId === companyId && isLive(i))
          .map((i) => ({ date: i.date, amount: num(i.subtotal) || num(i.total) }));

  const costs =
    basis === 'cash'
      ? arr(db?.payments).filter((p) => p.companyId === companyId && String(p.direction || '').toUpperCase() === 'OUT')
          .map((p) => ({ date: p.date, amount: num(p.amount) }))
      : [...arr(db?.bills), ...arr(db?.expenses)].filter((r) => r.companyId === companyId && isLive(r))
          .map((r) => ({ date: r.date, amount: num(r.subtotal) || num(r.total) }));

  const sum = (rows, from, to) =>
    rows.reduce((t, r) => {
      const d = new Date(`${ymd(r.date)}T00:00:00Z`).getTime();
      return Number.isFinite(d) && d > from && d <= to ? t + r.amount : t;
    }, 0);

  const out = [];
  for (let i = buckets - 1; i >= 0; i -= 1) {
    const to = end - i * span * 86_400_000;
    const from = to - span * 86_400_000;
    out.push({ to: todayIso(new Date(to)), income: sum(sales, from, to), expense: sum(costs, from, to) });
  }
  return { basis, series: out, income: out.reduce((t, b) => t + b.income, 0), expense: out.reduce((t, b) => t + b.expense, 0) };
};

/**
 * What has happened lately, newest first.
 *
 * Derived from the documents themselves rather than from an audit log: the
 * `AuditLog` table has no read route yet, and a timeline that quietly showed
 * only invoices — the one entity that currently writes to it — would read as a
 * complete history while being a quarter of one.
 */
export const recentActivity = (db, companyId, limit = 8) => {
  const rows = [];
  const push = (list, kind, fmt) =>
    arr(list).filter((r) => r.companyId === companyId).forEach((r) => rows.push({ kind, date: ymd(r.date), ...fmt(r) }));

  push(db?.invoices, 'invoice', (r) => ({
    title: `Invoice ${r.number || ''}`.trim(),
    who: String(r.customerName || '').trim(),
    amount: num(r.total),
    tone: isDraft(r) ? 'muted' : 'brand',
    note: isDraft(r) ? 'saved as draft' : 'raised',
  }));
  push(db?.bills, 'bill', (r) => ({
    title: `Bill ${r.number || ''}`.trim(),
    who: String(r.vendorName || '').trim(),
    amount: -num(r.total),
    tone: 'muted',
    note: 'recorded',
  }));
  push(db?.payments, 'payment', (r) => {
    const isIn = String(r.direction || '').toUpperCase() === 'IN';
    return {
      title: isIn ? `Receipt ${r.receiptNo || ''}`.trim() : `Payment ${r.paymentNo || ''}`.trim(),
      who: String(r.customerName || r.vendorName || '').trim(),
      amount: isIn ? num(r.amount) : -num(r.amount),
      tone: isIn ? 'pos' : 'neg',
      note: String(r.mode || '').trim() || (isIn ? 'received' : 'paid'),
    };
  });

  return rows
    .filter((r) => r.date)
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
    .slice(0, limit);
};
