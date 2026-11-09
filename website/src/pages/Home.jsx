import React from 'react';
import {
  Bank,
  Buildings,
  CalendarBlank,
  CalendarCheck,
  ChartBar,
  ClipboardText,
  Clock,
  DeviceMobile,
  FileArrowDown,
  Files,
  Fingerprint,
  IdentificationCard,
  Key,
  LockSimple,
  MapPin,
  Package,
  PencilSimple,
  Percent,
  Receipt,
  ShieldCheck,
  Timer,
  ToggleLeft,
  TreeStructure,
  Truck,
  UsersThree,
  Wallet,
} from '@phosphor-icons/react';
import { Link } from '../router.jsx';
import { CONNECTIONS, SITE, productBySlug } from '../site.js';
import { GstrWindow, WINDOWS } from '../components/Windows.jsx';
import { Head } from '../components/Sections.jsx';
import { Closing, Faq } from '../components/Blocks.jsx';
import { Mark } from '../components/Brand.jsx';

/*
 * The home page: the headline beside Books' invoice, then one section per
 * product in the owner's order (Books, People, Attendance, Payroll,
 * Workspace), each with three plain lines, a grid of what is inside, and its
 * screen drawn with sample data on the other side (Books shows the month's
 * GSTR-1, since its invoice is already in the hero). Then how the products
 * join, who uses CLOR, the questions people ask and the demo. Every claim
 * here is in CONTENT_CHECKLIST.md; the "inside" lines name what the product
 * pages list in content.js.
 */
const APPS = [
  {
    slug: 'books',
    screen: GstrWindow,
    title: 'Accounting that already knows GST.',
    lines: [
      'Every invoice, bill, receipt and stock movement posts its own journal, so the books are never a month behind the business.',
      'e-Invoices and e-way bills from the invoice itself; GSTR-1 and GSTR-3B from the month’s documents.',
      'Import masters and opening balances from Tally; reconcile the bank statement against the books.',
    ],
    inside: [
      [Receipt, 'Quotations, invoices, credit notes'],
      [Package, 'Stock by warehouse, batch and serial'],
      [Bank, 'Bank and cash books, reconciliation'],
      [Percent, 'GSTR-1 and GSTR-3B'],
      [Truck, 'e-Invoices and e-way bills'],
      [ChartBar, 'P&L, balance sheet, day book'],
    ],
  },
  {
    slug: 'people',
    title: 'One record for every employee, and everything that follows from it.',
    lines: [
      'For growing, medium and big companies. Personal, job and statutory details with a dated history, and documents that remind you before they expire.',
      'Attendance, leave and shifts are inside People, so you do not need a second app for time.',
      'Joining and leaving run from checklists for HR, IT and the manager, and end in the final settlement for Payroll.',
    ],
    inside: [
      [IdentificationCard, 'Records with a dated history'],
      [Clock, 'Time, leave and shifts'],
      [Files, 'Documents with expiry reminders'],
      [ClipboardText, 'Joining and leaving checklists'],
      [TreeStructure, 'Org chart and reporting lines'],
      [DeviceMobile, 'An app for every employee'],
    ],
  },
  {
    slug: 'attendance',
    title: 'Time and leave for a small company.',
    lines: [
      'ZKTeco, eSSL, Hikvision and Matrix readers send punches as they happen; field staff punch from a phone inside your site’s geofence.',
      'Shifts, late marks and overtime are worked out as the punches arrive; leave is asked for and approved in the employee app.',
      'Closing the month hands paid days, overtime and leave to Payroll.',
    ],
    inside: [
      [Fingerprint, 'ZKTeco, eSSL, Hikvision, Matrix'],
      [MapPin, 'Phone punches inside a geofence'],
      [CalendarBlank, 'Shifts, rosters and weekly offs'],
      [Timer, 'Late marks and overtime'],
      [PencilSimple, 'Missed-punch corrections'],
      [LockSimple, 'Month close, handed to Payroll'],
    ],
  },
  {
    slug: 'payroll',
    title: 'Salaries with PF, ESI, PT and TDS worked out.',
    lines: [
      'Each payslip shows earnings, PF, ESI, professional tax and TDS, and reaches the employee’s phone when the run is locked.',
      'The PF ECR file and Form 16 come out of the same payslips.',
      'Locking the run posts its journal to Books; paying salaries posts the payment.',
    ],
    inside: [
      [Wallet, 'Salary structures and revisions'],
      [Percent, 'PF, ESI, professional tax, TDS'],
      [LockSimple, 'Validate, review and lock the run'],
      [DeviceMobile, 'Payslips in the employee app'],
      [FileArrowDown, 'PF ECR file and Form 16'],
      [Receipt, 'Journal and payment to Books'],
    ],
  },
  {
    slug: 'workspace',
    title: 'One sign-in, and who may see what.',
    lines: [
      'Comes with every product. All your companies and branches under one sign-in, switched from one menu.',
      'Invite your accountant with their own login and the role you choose; end it whenever you like.',
      'Every change anyone makes is written to the audit trail, in plain words, with their name on it.',
    ],
    inside: [
      [Buildings, 'Companies and branches'],
      [UsersThree, 'Users, with a role per company'],
      [CalendarCheck, 'Outside access that ends on a date'],
      [ShieldCheck, 'Audit trail in plain words'],
      [Key, 'Google, Microsoft, SAML sign-in'],
      [ToggleLeft, 'Products on or off per company'],
    ],
  },
];

const TEAMS = [
  {
    title: 'Owners of small companies',
    text: 'File GSTR-1 and GSTR-3B from the invoices you already raised. Import masters and opening balances from Tally. Take attendance from the reader at the gate.',
    link: ['/solutions/businesses', 'CLOR for businesses'],
  },
  {
    title: 'HR in a growing company',
    text: 'One record per person from offer letter to final settlement. Joining and exit checklists that HR, IT and the manager each tick off. Documents that remind you before they expire.',
    link: ['/products/people', 'CLOR People'],
  },
  {
    title: 'Finance teams',
    text: 'Invoices, bills and the salary run post their own journals. Invoices above an amount wait for approval, and a change to bank details needs a second person.',
    link: ['/products/books', 'CLOR Books'],
  },
  {
    title: 'Accountants and CA firms',
    text: 'Your client invites you with your own login and decides what you may see and change. You switch between clients from the company menu without signing out.',
    link: ['/solutions/accounting-firms', 'CLOR for accounting firms'],
  },
];

const FAQ = [
  ['Do I have to buy every product?', 'No. Each CLOR product works on its own. Start with the one you need and add others later; they share one sign-in and one list of employees.'],
  ['People or Attendance: which one?', 'Attendance is for a small company that wants time, leave and shifts and nothing more. People is the full HR app for a company that is growing, and it includes everything Attendance does.'],
  ['Is CLOR made for Indian companies?', 'Yes. GST, e-invoices and e-way bills, TDS, PF, ESI, professional tax and Form 16 are part of the products, not add-ons.'],
  ['Where is my data kept?', `In ${SITE.hosting}. Each company’s records are kept apart inside the database itself, not only by the application.`],
  ['Can my accountant or CA work with me?', 'Yes. Invite them from your Workspace (Access, then Invitations) with their own login, choose what they can see and change, and end it whenever you like.'],
  ['Can I leave with my data?', 'Yes. You can export your company’s data at any time, and closing a company comes with a notice period.'],
];

/** What is inside a product: six one-line items with a line icon, so the words stand as tall as the screen beside them. */
export function Inside({ items }) {
  return (
    <ul className="inside">
      {items.map(([Icon, text]) => (
        <li key={text}>
          <Icon size={20} weight="regular" aria-hidden="true" />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

/** One product's section: its name, what it does in a few plain lines, what is inside, and its screen on the other side. */
function AppSection({ slug, title, lines, inside, flip, screen }) {
  const p = productBySlug(slug);
  const Win = screen || WINDOWS[slug];
  return (
    <section className="section" aria-labelledby={`${slug}-title`}>
      <div className={`wrap app-sec${flip ? ' app-sec--flip' : ''}`}>
        <div className="app-sec-copy">
          <p className="app-sec-name">
            <Mark product={p} size={28} /> CLOR&nbsp;{p.name}
          </p>
          <h2 className="h-1" id={`${slug}-title`}>
            {title}
          </h2>
          <ul className="facts-list">
            {lines.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <Inside items={inside} />
          <Link className="text-link" href={`/products/${slug}`}>
            More about CLOR&nbsp;{p.name}
          </Link>
        </div>
        <div className="app-sec-pic">
          <Win />
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const Books = WINDOWS.books;
  return (
    <>
      <section className="hero hero--home" aria-labelledby="hero-title">
        <div className="wrap home-hero">
          <div className="hero-copy">
            <h1 id="hero-title" className="h-hero">
              Accounts, GST, staff and salaries for companies in India.
            </h1>
            <p className="lede">
              Start with CLOR Books: raise GST invoices and e-way bills, and file GSTR-1 and GSTR-3B from what you raised. Add People, Attendance and Payroll when you need them. They
              share one sign-in and one list of employees.
            </p>
            <div className="actions">
              <Link className="btn btn--primary btn--lg" href={SITE.demoUrl}>
                Request a demo
              </Link>
              <Link className="btn btn--text" href="/products">
                See the five products
              </Link>
            </div>
          </div>
          <div className="home-shot">
            <Books />
          </div>
        </div>
      </section>

      {APPS.map((a, i) => (
        <AppSection key={a.slug} {...a} flip={i % 2 === 1} />
      ))}

      <section className="section" aria-labelledby="connected-title">
        <div className="wrap split">
          <Head id="connected-title" title="Attendance feeds payroll. Payroll posts to Books." intro="Used together, the products read the same employees and post to the same books, so nobody exports a spreadsheet in between." />
          <ul className="links">
            {CONNECTIONS.map((x) => (
              <li key={x.from + x.to}>
                <span className="links-pair">
                  <Mark product={productBySlug(x.from)} size={26} />
                  <span className="links-wire" aria-hidden="true" />
                  <Mark product={productBySlug(x.to)} size={26} />
                </span>
                <p className="body">{x.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="team-title">
        <div className="wrap">
          <Head id="team-title" title="Who uses CLOR" />
          <ul className="groups groups--4">
            {TEAMS.map((t) => (
              <li key={t.title}>
                <h3 className="h-3">{t.title}</h3>
                <p className="body">{t.text}</p>
                <Link className="text-link" href={t.link[0]}>
                  {t.link[1]}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="trust-title">
        <div className="wrap split">
          <Head id="trust-title" title="Where your data lives" />
          <div className="stack">
            <p className="lede">Your records are kept in {SITE.hosting}. One company can never see another’s, and you can export everything at any time.</p>
            <Link className="text-link" href="/security">
              How CLOR keeps your data safe
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <Faq items={FAQ} />
        </div>
      </section>

      <Closing title="See it with your own company’s figures." text="Tell us what you use today for accounts, attendance and salaries, and we will show you the same month’s work in CLOR.">
        Each product has its own subscription; prices are being finalised. <Link href="/pricing">How pricing works</Link>
      </Closing>
    </>
  );
}
