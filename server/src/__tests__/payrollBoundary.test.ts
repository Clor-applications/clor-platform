import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Payroll is its own application.
 *
 * The boundary between Payroll and Accounting is not visible from inside any
 * one file: both run in the same process against databases on the same disk,
 * so a payroll service can import the accounting Prisma client and read a
 * ledger, and nothing would fail. It would work, ship, and quietly make the two
 * applications one.
 *
 * These hold the boundary structurally. There is exactly one file in Payroll
 * allowed to know Accounting exists — the adapter — and everything else
 * depends on its interface. When Accounting becomes a service of its own, only
 * that file changes.
 *
 * A failure here is not a style complaint. It means an import has been added
 * that will have to be undone before either application can move.
 *
 * ## Why this still exists alongside the boundary linter
 *
 * `npm run lint:boundaries` (dependency-cruiser) enforces the same rule from
 * the module graph, which is strictly better at the mechanical part: it
 * resolves aliases, follows re-exports, and cannot be fooled by an import
 * written a different way. It is also a separate command that a person has to
 * remember to run.
 *
 * These stay because they assert things a dependency graph does not describe:
 * that the adapter's interface is the only shape Payroll knows Accounting by,
 * and that the two databases are reachable only through their own clients. The
 * overlap on imports is deliberate — the graph catches the spelling, this
 * catches the intent, and the cheap one runs on every `npm test`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = dirname(HERE);

/** The one file permitted to reach across. */
const ADAPTER = 'services/payroll/accounting/client.ts';

/** Anything Accounting owns that Payroll must not import directly. */
const ACCOUNTING_INTERNALS = [
  { pattern: /from '[^']*utils\/prisma\.js'/, what: "the accounting Prisma client" },
  { pattern: /from '[^']*services\/ledger\.js'/, what: 'the accounting ledger service' },
  { pattern: /from '[^']*services\/journal[^']*'/, what: 'the accounting journal service' },
];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

/** Every Payroll-owned server file. */
const payrollFiles = () => {
  const services = walk(join(SERVER_SRC, 'services', 'payroll'));
  const routes = readdirSync(join(SERVER_SRC, 'routes'))
    .filter((n) => n.startsWith('payroll') && n.endsWith('.ts'))
    .map((n) => join(SERVER_SRC, 'routes', n));
  const utils = ['payrollPrisma.ts', 'peoplePrisma.ts'].map((n) => join(SERVER_SRC, 'utils', n));
  return [...services, ...routes, ...utils].filter((f) => f.endsWith('.ts'));
};

describe('Payroll reaches Accounting through one door', () => {
  it('no payroll file but the adapter imports anything Accounting owns', () => {
    const offenders: string[] = [];

    for (const file of payrollFiles()) {
      const rel = relative(SERVER_SRC, file).replace(/\\/g, '/');
      if (rel === ADAPTER) continue;

      const src = readFileSync(file, 'utf8');
      for (const { pattern, what } of ACCOUNTING_INTERNALS) {
        if (pattern.test(src)) offenders.push(`${rel} imports ${what}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the adapter is the only place an accounting model is named', () => {
    /* `prisma.ledgerAccount`, `prisma.journalEntry` and the like. Payroll
       speaks about ledgers through the interface, in its own vocabulary. */
    const offenders: string[] = [];

    for (const file of payrollFiles()) {
      const rel = relative(SERVER_SRC, file).replace(/\\/g, '/');
      if (rel === ADAPTER) continue;

      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bprisma\.(ledgerAccount|journalEntry|journalLine|accountGroup|orgMaster)\b/g)) {
        offenders.push(`${rel}: ${m[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('payroll tables are not in the accounting schema', () => {
    const accounting = readFileSync(join(dirname(SERVER_SRC), 'prisma', 'schema.prisma'), 'utf8');
    const payrollModels = [
      'PayGroup', 'PayrollPeriod', 'SalaryComponent', 'SalaryStructure', 'SalaryAssignment',
      'SalaryRevision', 'PayrollAdjustment', 'PayrollRun', 'SalarySlip', 'PayrollLoan',
      'StatutoryRule', 'PayrollPayment', 'PayrollPosting',
    ];
    const found = payrollModels.filter((m) => new RegExp(`^model ${m} \\{`, 'm').test(accounting));
    expect(found).toEqual([]);
  });

  it('the payroll schema declares no relation into another app', () => {
    /* A cross-database foreign key cannot be enforced and cannot be migrated.
       Payroll holds employeeId, ledgerId and costCentreId as plain strings. */
    const payroll = readFileSync(join(dirname(SERVER_SRC), 'prisma', 'payroll', 'schema.prisma'), 'utf8');
    const foreign = ['Employee', 'LedgerAccount', 'JournalEntry', 'Org', 'Account', 'Branch', 'User'];
    const offenders: string[] = [];
    for (const m of payroll.matchAll(/@relation\([^)]*\)/g)) {
      for (const name of foreign) {
        /* A relation naming a model this schema does not define is one that
           points at another application. */
        if (m[0].includes(name) && !new RegExp(`^model ${name} \\{`, 'm').test(payroll)) {
          offenders.push(m[0]);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the adapter is shaped like a remote call', () => {
  const adapter = readFileSync(join(SERVER_SRC, ADAPTER), 'utf8');

  it('takes a companyId rather than assuming a tenant', () => {
    for (const method of ['getLedgers', 'getCostCentres', 'getJournalEntry', 'findEntryBySource']) {
      expect(adapter).toMatch(new RegExp(`${method}\\(companyId: string`));
    }
  });

  it('returns Payroll\'s own types, never a Prisma model', () => {
    /* If a Prisma type crossed this boundary, every caller would depend on
       Accounting's schema and the seam would not survive the split. */
    expect(adapter).toMatch(/export type LedgerAccount = \{/);
    expect(adapter).not.toMatch(/import type \{[^}]*\} from '@prisma/);
  });

  it('derives the idempotency key from the run, never generates one', () => {
    expect(adapter).toMatch(/postingIdempotencyKey/);
    expect(adapter).toMatch(/payroll-\$\{kind\}:\$\{id\}:accounting-posting/);
    expect(adapter).not.toMatch(/randomUUID|Math\.random/);
  });
});
