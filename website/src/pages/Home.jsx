import React from 'react';
import { Link } from '../router.jsx';
import { CONNECTIONS, SITE, productBySlug } from '../site.js';
import { GstrWindow, WINDOWS } from '../components/Windows.jsx';
import { Head, SettingUp, TrustBand } from '../components/Sections.jsx';
import { Closing, Faq } from '../components/Blocks.jsx';
import { Mark } from '../components/Brand.jsx';

/*
 * The home page leads with Books, the main product, then gives each of the
 * others its own section in the owner's order (Payroll, People, Attendance),
 * each with its screen drawn with sample data. How they join comes after.
 * Every claim here is in CONTENT_CHECKLIST.md.
 */
const APPS = [
  {
    slug: 'payroll',
    title: 'Salaries with PF, ESI, PT and TDS worked out.',
    lines: [
      'Each payslip shows earnings, PF, ESI, professional tax and TDS, and reaches the employee’s phone when the run is locked.',
      'The PF ECR file and Form 16 come out of the same payslips.',
      'Locking the run posts its journal to Books; paying salaries posts the payment.',
    ],
  },
  {
    slug: 'people',
    title: 'One record for every employee.',
    lines: [
      'Personal, job and statutory details with a dated history of every change, and documents that remind you before they expire.',
      'Leave balances and requests from the employee app, approved by the manager.',
      'Joining and leaving checklists for HR, IT and the manager, ending in the final settlement for Payroll.',
    ],
  },
  {
    slug: 'attendance',
    title: 'Punches from the reader at the gate, or a phone on site.',
    lines: [
      'ZKTeco, eSSL, Hikvision and Matrix readers send punches as they happen; field staff punch from a phone inside your site’s geofence.',
      'Shifts, late marks and overtime are worked out as the punches arrive.',
      'Closing the month hands paid days, overtime and leave to Payroll.',
    ],
  },
];

const TEAMS = [
  {
    title: 'Owners of small companies',
    text: 'File GSTR-1 and GSTR-3B from the invoices you already raised. Import masters and opening balances from Tally. Reconcile the bank statement against Books.',
    link: ['/solutions/businesses', 'CLOR for businesses'],
  },
  {
    title: 'Accountants and CA firms',
    text: 'Your client invites you with your own login and decides what you may see and change. You switch between clients from the company menu without signing out.',
    link: ['/solutions/accounting-firms', 'CLOR for accounting firms'],
  },
  {
    title: 'Finance teams',
    text: 'Invoices, bills and the salary run post their own journals. Invoices above an amount wait for approval, and a change to bank details needs a second person.',
    link: ['/products/books', 'CLOR Books'],
  },
  {
    title: 'HR teams',
    text: 'Joining and exit checklists that HR, IT and the manager each tick off. Documents remind you before they expire. One record per person, from offer letter to final settlement.',
    link: ['/products/people', 'CLOR People'],
  },
];

const FAQ = [
  ['Do I have to buy every product?', 'No. Each CLOR product works on its own. Start with the one you need and add others later; they share one login and one list of employees.'],
  ['Is CLOR made for Indian companies?', 'Yes. GST, e-invoices and e-way bills, TDS, PF, ESI, professional tax and Form 16 are part of the products, not add-ons.'],
  ['Where is my data kept?', `In ${SITE.hosting}. Each company’s records are kept apart inside the database itself, not only by the application.`],
  ['Can my accountant or CA work with me?', 'Yes. Invite them from your Workspace (Access, then Invitations) with their own login, choose what they can see and change, and end it whenever you like. A workspace for the firm’s own staff is planned.'],
  ['Can I leave with my data?', 'Yes. You can export your company’s data at any time, and closing a company comes with a notice period.'],
];

const BooksWindow = WINDOWS.books;

/** One product's section: what it does in a few plain lines, and its screen beside them. */
function AppSection({ slug, title, lines, flip }) {
  const p = productBySlug(slug);
  const Win = WINDOWS[slug];
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
          <Link className="text-link" href={`/products/${slug}`}>
            More about CLOR&nbsp;{p.name}
          </Link>
        </div>
        <figure className="app-sec-shot">
          <Win />
        </figure>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <>
      <section className="hero hero--home" aria-labelledby="hero-title">
        <div className="wrap home-hero">
          <div className="hero-copy">
            <h1 id="hero-title" className="h-hero">
              GST accounting for Indian companies.
            </h1>
            <p className="lede">
              Raise GST invoices and e-way bills in CLOR Books, and file GSTR-1 and GSTR-3B from what you raised. Import masters and opening balances from Tally, and reconcile the bank
              statement against your books. Payroll, People and Attendance join the same records when you need them.
            </p>
            <div className="actions">
              <Link className="btn btn--primary btn--lg" href={SITE.demoUrl}>
                Request a demo
              </Link>
              <Link className="btn btn--text" href="/products/books">
                More about CLOR Books
              </Link>
            </div>
          </div>
          <figure className="home-shots">
            <BooksWindow />
            <GstrWindow />
            <figcaption className="caption">CLOR screens on this page are drawn with sample data.</figcaption>
          </figure>
        </div>
      </section>

      {APPS.map((a, i) => (
        <AppSection key={a.slug} {...a} flip={i % 2 === 0} />
      ))}

      <section className="section" aria-labelledby="connected-title">
        <div className="wrap split">
          <Head
            id="connected-title"
            title="Attendance feeds payroll. Payroll posts to Books."
            intro="Bought together, the four products read the same employees and post to the same books, so nobody exports a spreadsheet in between. Projects and Timesheet are next."
          />
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

      <SettingUp />

      <section className="section" aria-labelledby="team-title">
        <div className="wrap">
          <Head id="team-title" title="Who uses CLOR" />
          <ul className="groups">
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

      <TrustBand />

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
