import React from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  FileSpreadsheet,
  Landmark,
  Lock,
  Moon,
  Scale,
  Sun,
  Upload,
} from 'lucide-react';

import { APPS } from './registry';
import ClorMark from './ClorMark';

import { useTheme } from '@ui/components/ui/useTheme';
import { useTilt } from '@ui/components/ui/useTilt';

/**
 * The public front page — requirement: a landing page.
 *
 * Written around one claim rather than a feature list, because a bookkeeper
 * choosing accounting software is buying trust in the numbers, not a count of
 * modules. Everything below the hero exists to make that claim concrete.
 *
 * No stock imagery and no gradient-on-gradient: the visual interest comes from
 * the type, the ledger ruling and a single brand hue. The palette is warm ink,
 * pine and brass — deliberately not the blue every SaaS front page defaults to.
 */

const FEATURES = [
  {
    icon: Scale,
    title: 'Balanced, or not stored',
    body:
      'Every document posts to a real double-entry ledger as you save it. An entry whose debits and credits differ is rejected, not quietly corrected later.',
  },
  {
    icon: Landmark,
    title: 'GST that matches the return',
    body:
      'CGST, SGST and IGST land in their own control accounts by intent, not by name matching, so the return ties back to the books line for line.',
  },
  {
    icon: Lock,
    title: 'Access down to the field',
    body:
      'Roles, role profiles, field-level permissions and approval limits. A junior can raise an invoice without seeing the margin on it.',
  },
  {
    icon: Boxes,
    title: 'Batches and serials',
    body:
      'Lot numbers with expiry, issued soonest-first, and serial numbers that cannot be sold twice. Stock you can actually recall.',
  },
  {
    icon: Upload,
    title: 'Import before you commit',
    body:
      'Bring in invoices, bills, notes and journals from a spreadsheet. Every problem is listed against the file’s own line numbers before a single row is written.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Multi-currency, one ledger',
    body:
      'Invoice in any currency; the books stay in yours, translated at the rate in force on the document date. Gains and losses get their own account.',
  },
];

const STEPS = [
  ['Raise the document', 'Invoice, bill, receipt or journal — numbered from your own series.'],
  ['It posts itself', 'The ledger entry is written in the same transaction. Nothing to run at month end.'],
  ['Read the books', 'Trial balance, ledgers and returns come from posted lines, never from a cache.'],
];

export default function Home({ onSignIn, onGetStarted }) {
  // The app shell's own hook, not a second copy: it stores under `uiTheme` and
  // falls back to the system preference. A private hook here would have used a
  // different key, so a toggle on this page would not have followed the user
  // into the app.
  const { theme, toggle: toggleTheme } = useTheme();
  const { ref: specimenRef, onPointerMove: specimenMove, onPointerLeave: specimenLeave } = useTilt({ maxDeg: 4, scale: 1.01 });

  return (
    <div className="min-h-dvh" style={{ backgroundColor: 'rgb(var(--app-bg))' }}>
      {/* --- top bar --------------------------------------------------- */}
      <header
        className="sticky top-0 z-30 border-b backdrop-blur"
        style={{
          borderColor: 'rgb(var(--border))',
          backgroundColor: 'rgb(var(--app-bg) / 0.82)',
        }}
      >
        <div className="ui-container flex h-16 items-center justify-between gap-4">
          <a href="#top" className="flex items-center gap-2.5">
            <ClorMark size={26} />
            <span className="ui-display text-lg">Clor</span>
          </a>

          {/*
            The apps, not a tour of one of them.

            This header read "What it does / How it works / Why trust it" —
            three links about the accounting product, from when that was the
            whole of Clor. Clor is a platform now, and the first thing somebody
            arriving should learn is which applications it has. The ones not
            built yet are listed and marked, because a company choosing a
            platform is choosing where it is going as much as what it does
            today.
          */}
          <nav className="hidden md:flex items-center gap-6 text-sm" aria-label="Applications">
            {APPS.map((app) => (
              <a
                key={app.id}
                className="ui-link inline-flex items-center gap-1.5"
                href={`#app-${app.id}`}
                title={app.blurb}
              >
                <app.icon size={15} aria-hidden="true" />
                {app.name}
                {app.available ? null : <span className="ui-caption">soon</span>}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="ui-icon-btn"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button type="button" onClick={onSignIn} className="ui-btn ui-btn-ghost">
              Sign in
            </button>
            <button type="button" onClick={onGetStarted} className="ui-btn ui-btn-brand">
              Get started
            </button>
          </div>
        </div>
      </header>

      {/* --- hero ------------------------------------------------------- */}
      <section id="top" className="ui-hero-wash relative overflow-hidden">
        {/* Drifting brand light behind the hero. Decorative; base colour is
            still --app-bg underneath. */}
        <div className="ui-ambient" aria-hidden="true" />
        <div className="ui-container ui-section relative">
          <div className="max-w-3xl ui-stagger">
            {/*
              The platform, not one of its applications.

              This hero pitched double-entry bookkeeping, from when Accounting
              was the whole product. It is now one app of four, and somebody
              arriving should learn what Clor is before they learn what its
              ledger does. The specimen below still shows a real trial balance,
              because a claim about software is worth less than the thing
              itself.
            */}
            <p className="ui-eyebrow">Business software · India</p>

            <h1 className="ui-display mt-4 text-[clamp(2.5rem,6vw,4.25rem)]">
              One platform. One set of records.
            </h1>

            <p className="ui-lede mt-6">
              Clor runs your books, your payroll and your people on the same records. Salaries post
              themselves into the ledger, nobody exports a file to anybody, and the month closes
              because the numbers already agree — not because somebody reconciled them.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <button type="button" onClick={onGetStarted} className="ui-btn ui-btn-brand ui-btn-lg">
                Start a company
                <ArrowRight size={16} aria-hidden="true" />
              </button>
              <button type="button" onClick={onSignIn} className="ui-btn ui-btn-secondary ui-btn-lg">
                Sign in
              </button>
            </div>

            <p className="mt-5 text-sm ui-subtle">
              Runs on your own server. Your records never leave it.
            </p>
          </div>

          {/* A specimen of the thing itself, rather than a stock screenshot.
              It tilts a few degrees toward the cursor — a physical object on
              the desk, not a flat screenshot; the Balanced badge rides 36px
              above the surface so the parallax is visible. */}
          <div
            ref={specimenRef}
            onPointerMove={specimenMove}
            onPointerLeave={specimenLeave}
            className="ui-tilt3d mt-14 ui-card overflow-hidden ui-in"
            style={{ boxShadow: 'var(--shadow-lift)' }}
          >
            <div
              className="flex items-center justify-between gap-3 border-b px-4 py-3"
              style={{ borderColor: 'rgb(var(--border))', backgroundColor: 'rgb(var(--surface-sunken))' }}
            >
              <span className="text-sm font-semibold">Trial balance</span>
              <span className="ui-badge ui-badge-brand ui-depth-2">
                <BadgeCheck size={14} aria-hidden="true" /> Balanced
              </span>
            </div>

            <div className="overflow-x-auto">
              {/* min-width so the table scrolls inside its own container on a
                  phone instead of wrapping account names over three lines.
                  The page itself never scrolls sideways. */}
              <table className="ui-table w-full min-w-[34rem] text-sm">
                <thead>
                  <tr>
                    <th className="text-left">Account</th>
                    <th className="text-right">Debit</th>
                    <th className="text-right">Credit</th>
                  </tr>
                </thead>
                <tbody className="ui-rows">
                  {[
                    ['1100 · Accounts Receivable', '1,18,000.00', ''],
                    ['1300 · Bank Accounts', '2,45,000.00', ''],
                    ['2100 · Output CGST', '', '9,000.00'],
                    ['2110 · Output SGST', '', '9,000.00'],
                    ['4000 · Sales Accounts', '', '3,45,000.00'],
                  ].map(([account, debit, credit]) => (
                    <tr key={account}>
                      <td className="ui-mono text-[0.8125rem]">{account}</td>
                      <td className="ui-num text-right">{debit || '—'}</td>
                      <td className="ui-num text-right">{credit || '—'}</td>
                    </tr>
                  ))}
                  <tr style={{ backgroundColor: 'rgb(var(--surface-sunken))' }}>
                    <td className="font-semibold">Total</td>
                    <td className="ui-num text-right font-semibold">3,63,000.00</td>
                    <td className="ui-num text-right font-semibold">3,63,000.00</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* --- what it does ----------------------------------------------- */}
      {/* --- the applications --------------------------------------------
        Directly after the hero, because "what is Clor" is answered by the
        list of applications rather than by a tour of one of them. Each card
        carries the anchor its header link points at, so choosing an app from
        the nav lands on the app rather than somewhere near it.

        The ones not built yet are shown and marked rather than hidden: a
        company choosing a platform is choosing where it is going, and a
        roadmap stated plainly is worth more than a shorter list that looks
        complete.
      --------------------------------------------------------------------- */}
      <section id="apps" className="ui-section">
        <div className="ui-container">
          <p className="ui-eyebrow">One platform</p>
          <h2 className="ui-display mt-3 text-[clamp(1.875rem,3.5vw,2.75rem)] max-w-[22ch]">
            Four applications that already know each other.
          </h2>
          <p className="mt-4 max-w-[58ch] text-base leading-relaxed ui-muted">
            Each one runs on its own and keeps its own records. Payroll posts its journal into
            Accounting without anybody exporting a file, because they are parts of the same
            platform rather than two programs that happen to be sold together.
          </p>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ui-stagger">
            {APPS.map((app) => (
              <article key={app.id} id={`app-${app.id}`} className="ui-stat scroll-mt-24">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="grid place-items-center w-9 h-9 rounded-lg"
                    style={{ backgroundColor: 'rgb(var(--brand-soft))', color: 'rgb(var(--brand))' }}
                  >
                    <app.icon size={18} aria-hidden="true" />
                  </span>
                  {app.available ? null : (
                    <span className="ui-pill ui-pill-neutral">Coming</span>
                  )}
                </div>
                <h3 className="mt-4 font-medium">{app.name}</h3>
                <p className="mt-2 text-sm leading-relaxed ui-muted">{app.blurb}</p>
              </article>
            ))}
          </div>

          <p className="mt-8 text-sm ui-muted">
            Start with one. Add the others when you need them — nothing has to be migrated, because
            they were never separate products.
          </p>
        </div>
      </section>

      <section id="what" className="ui-section">
        <div className="ui-container">
          <p className="ui-eyebrow">Clor Accounting</p>
          <h2 className="ui-display mt-3 text-[clamp(1.875rem,3.5vw,2.75rem)] max-w-[20ch]">
            Six things most accounting software leaves to you.
          </h2>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ui-stagger">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <article key={title} className="ui-stat">
                <span
                  className="grid place-items-center w-9 h-9 rounded-lg"
                  style={{ backgroundColor: 'rgb(var(--brand-soft))', color: 'rgb(var(--brand))' }}
                >
                  <Icon size={18} aria-hidden="true" />
                </span>
                <h3 className="mt-4 font-medium">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed ui-muted">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* --- how it works ------------------------------------------------ */}
      <section id="how" style={{ backgroundColor: 'rgb(var(--surface-sunken))' }}>
        <div className="ui-container ui-section">
          <p className="ui-eyebrow">How it works</p>
          <h2 className="ui-display mt-3 text-[clamp(1.875rem,3.5vw,2.75rem)] max-w-[18ch]">
            Three steps, and none of them is “reconcile”.
          </h2>

          <ol className="mt-12 grid gap-8 md:grid-cols-3">
            {STEPS.map(([title, body], i) => (
              <li key={title}>
                <span
                  className="ui-display text-5xl"
                  style={{ color: 'rgb(var(--brand))' }}
                  aria-hidden="true"
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-3 font-medium">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed ui-muted max-w-[40ch]">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* --- trust -------------------------------------------------------- */}
      <section id="trust" className="ui-section">
        <div className="ui-container grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <p className="ui-eyebrow">Why trust it</p>
            <h2 className="ui-display mt-3 text-[clamp(1.875rem,3.5vw,2.75rem)] max-w-[18ch]">
              The boring guarantees, written down.
            </h2>
            <p className="ui-lede mt-5">
              Accounting software earns its keep on the days something goes wrong. These are the
              rules the server enforces, not aspirations for a later release.
            </p>
          </div>

          <ul className="grid gap-3">
            {[
              'Posted entries are immutable — corrections are contra entries, never edits.',
              'A hash chain runs over posted entries, so tampering is detectable.',
              'Period lock refuses anything dated into a closed period.',
              'Document numbers are allocated inside the document’s own transaction.',
              'Every amount is summed in integer paise, never in floating point.',
            ].map((line) => (
              <li key={line} className="ui-panel flex items-start gap-3 p-4">
                <BadgeCheck
                  size={18}
                  className="mt-0.5 flex-shrink-0"
                  style={{ color: 'rgb(var(--brand))' }}
                  aria-hidden="true"
                />
                <span className="text-sm leading-relaxed">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* --- closing call ------------------------------------------------- */}
      <section className="ui-container pb-24">
        <div
          className="relative overflow-hidden rounded-[var(--radius-xl)] px-8 py-14 text-center"
          style={{ backgroundColor: 'rgb(var(--brand-panel))', color: '#fff' }}
        >
          <div
            className="absolute inset-0 opacity-[0.07]"
            aria-hidden="true"
            style={{ backgroundImage: 'repeating-linear-gradient(180deg,#fff 0 1px,transparent 1px 2.25rem)' }}
          />
          <div className="relative">
            <h2 className="ui-display text-[clamp(1.75rem,3.5vw,2.5rem)]">Open your first set of books.</h2>
            <p className="mx-auto mt-4 max-w-[46ch] text-white/70 leading-relaxed">
              Create a company, add your chart of accounts, and raise an invoice. The ledger is
              already keeping score.
            </p>
            <button
              type="button"
              onClick={onGetStarted}
              className="ui-btn ui-btn-lg mt-8"
              style={{ backgroundColor: '#fff', color: 'rgb(var(--brand-panel))' }}
            >
              Get started
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      <footer className="border-t" style={{ borderColor: 'rgb(var(--border))' }}>
        <div className="ui-container flex flex-wrap items-center justify-between gap-3 py-7 text-sm ui-subtle">
          <span>© 2026 Clor</span>
          <span>Self-hosted GST accounting</span>
        </div>
      </footer>
    </div>
  );
}
