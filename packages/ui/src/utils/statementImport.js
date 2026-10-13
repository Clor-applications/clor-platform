/**
 * Reading a bank statement file.
 *
 * Lifted out of the cash-book screen unchanged so that importing a statement
 * and reconciling one read the same file the same way. Two parsers for one
 * format is two sets of rules about what a date looks like, and the reconciler
 * would have disagreed with the importer about the very rows it was meant to
 * match.
 *
 * Every bank exports differently — comma, semicolon or tab; `Debit`/`Credit`,
 * `Withdrawal`/`Deposit`, or one signed `Amount`; dd/mm/yyyy or ISO — so the
 * columns are found by name from a list of what banks actually call them, and
 * the delimiter is detected rather than assumed.
 */

export const parseAmount = (v) => {
  const raw = String(v ?? '').trim();
  if (!raw) return 0;
  const cleaned = raw
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^0-9.\-()]/g, '')
    .trim();

  // Handle (123.45) as negative
  const isParen = cleaned.startsWith('(') && cleaned.endsWith(')');
  const num = Number(isParen ? cleaned.slice(1, -1) : cleaned);
  if (!Number.isFinite(num)) return 0;
  return isParen ? -num : num;
};

export const inferDirection = (typeText, signedAmount) => {
  const t = String(typeText || '').trim().toLowerCase();
  if (t) {
    if (t.includes('out') || t.includes('debit') || t === 'dr' || t.includes('payment') || t.includes('withdraw')) return 'OUT';
    if (t.includes('in') || t.includes('credit') || t === 'cr' || t.includes('receipt') || t.includes('deposit')) return 'IN';
  }
  return Number(signedAmount || 0) < 0 ? 'OUT' : 'IN';
};

export const toIsoDate = (value) => {
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '';
};

export const normalizeDate = (value) => {
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // dd-mm-yyyy / dd/mm/yyyy (also accepts mm-dd-yyyy when unambiguous)
  // `/` and `-` need no escaping inside a character class.
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let y = Number(m[3]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(y)) return '';
    if (y < 100) y += 2000;

    let day = a;
    let month = b;

    // If second part can't be month, treat as mm/dd/yyyy.
    if (a <= 12 && b > 12) {
      day = b;
      month = a;
    }

    const dt = new Date(Date.UTC(y, month - 1, day));
    if (
      Number.isFinite(dt.getTime()) &&
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === month - 1 &&
      dt.getUTCDate() === day
    ) {
      return dt.toISOString().slice(0, 10);
    }
  }

  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '';
};

export const normalizeHeader = (h) =>
  String(h || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export const parseCsv = (text) => {
  // Minimal CSV parser (supports quoted fields)
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => String(l).trim() !== '');

  if (lines.length === 0) return { headers: [], rows: [] };

  const detectDelimiter = (line) => {
    const s = String(line || '');
    const commas = (s.match(/,/g) || []).length;
    const semis = (s.match(/;/g) || []).length;
    const tabs = (s.match(/\t/g) || []).length;
    if (semis > commas && semis >= tabs) return ';';
    if (tabs > commas && tabs > semis) return '\t';
    return ',';
  };

  const delimiter = detectDelimiter(lines[0]);

  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const nx = line[i + 1];

      if (ch === '"') {
        if (inQuotes && nx === '"') {
          cur += '"';
          i++;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }

      if (!inQuotes && ch === delimiter) {
        out.push(cur);
        cur = '';
        continue;
      }

      cur += ch;
    }
    out.push(cur);
    return out;
  };

  const rawHeaders = parseLine(lines[0]);
  const headers = rawHeaders.map(normalizeHeader);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
};


/** The column names banks actually use, in the order we prefer them. */
export const STATEMENT_COLUMNS = {
  account: [
    'cash / bank account', 'cash/bank account', 'cash bank account', 'bank/cash account',
    'bank account', 'cash account', 'account', 'ledger name', 'ledger',
  ],
  date: ['date', 'txn date', 'transaction date', 'value date'],
  type: ['type', 'txn type', 'transaction type', 'dr/cr'],
  payment: ['payment', 'payments', 'paid', 'debit', 'withdrawal', 'dr'],
  receipt: ['receipts', 'receipt', 'received', 'credit', 'deposit', 'cr'],
  amount: ['amount', 'amt', 'transaction amount'],
  narration: ['narration', 'description', 'particulars', 'remarks', 'details'],
  balance: ['balance', 'closing balance', 'running balance'],
};

/**
 * A statement file as rows the reconciler can use.
 *
 * @returns { rows: [{ date, direction, amount, narration, balance }], headers, error }
 */
export function readStatement(text) {
  const { headers, rows } = parseCsv(text);
  if (!headers.length || !rows.length) return { rows: [], headers, error: 'No rows found in the file.' };

  const headerMap = new Map(headers.map((h, idx) => [normalizeHeader(h), idx]));
  const pick = (names) => {
    for (const n of names) {
      const idx = headerMap.get(n);
      if (idx !== undefined) return idx;
    }
    return -1;
  };

  const idx = {
    date: pick(STATEMENT_COLUMNS.date),
    type: pick(STATEMENT_COLUMNS.type),
    payment: pick(STATEMENT_COLUMNS.payment),
    receipt: pick(STATEMENT_COLUMNS.receipt),
    amount: pick(STATEMENT_COLUMNS.amount),
    narration: pick(STATEMENT_COLUMNS.narration),
    balance: pick(STATEMENT_COLUMNS.balance),
  };

  if (idx.date < 0 || (idx.amount < 0 && idx.payment < 0 && idx.receipt < 0)) {
    return {
      rows: [],
      headers,
      error: `The file needs a Date column and either Amount or Debit/Credit columns. Found: ${headers
        .map((h) => String(h || '').trim())
        .filter(Boolean)
        .join(', ')}`,
    };
  }

  const out = [];
  rows.forEach((r, i) => {
    const date = normalizeDate(r[idx.date]);
    const narration = idx.narration >= 0 ? String(r[idx.narration] || '').trim() : '';

    let direction = 'IN';
    let amount = 0;

    // Two-column banks first: debit and credit in their own columns is the
    // unambiguous form, and a signed Amount is the fallback.
    if (idx.payment >= 0 || idx.receipt >= 0) {
      const paid = idx.payment >= 0 ? Math.abs(parseAmount(r[idx.payment])) : 0;
      const got = idx.receipt >= 0 ? Math.abs(parseAmount(r[idx.receipt])) : 0;
      if (got > 0.0001) {
        direction = 'IN';
        amount = got;
      } else if (paid > 0.0001) {
        direction = 'OUT';
        amount = paid;
      }
    }

    if (!amount) {
      const signed = idx.amount >= 0 ? parseAmount(r[idx.amount]) : 0;
      direction = inferDirection(idx.type >= 0 ? r[idx.type] : '', signed);
      amount = Math.abs(signed);
    }

    if (!amount || amount <= 0) return;

    out.push({
      // A statement line has no id of its own, and the reconciler needs one to
      // hold a match against.
      id: `stmt-${i}`,
      date: date || '',
      direction,
      amount: Math.round(amount * 100) / 100,
      narration,
      balance: idx.balance >= 0 ? parseAmount(r[idx.balance]) : null,
    });
  });

  return { rows: out, headers, error: out.length ? '' : 'No usable rows found in the file.' };
}
