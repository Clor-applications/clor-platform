import React from 'react';
import { Link } from '../router.jsx';
import { SITE, PRODUCTS } from '../site.js';
import Connection from '../components/Connection.jsx';
import { Head, SettingUp, TrustBand } from '../components/Sections.jsx';
import { Closing, Faq } from '../components/Blocks.jsx';
import { Status } from '../components/Brand.jsx';

/*
 * The home page says which jobs CLOR does, in the words an Indian accountant
 * or owner uses for them. Every claim here is in CONTENT_CHECKLIST.md.
 */
const LINES = {
  books: 'GST invoices, e-invoices and e-way bills, purchase bills with TDS, stock by warehouse and bank reconciliation. GSTR-1 and GSTR-3B are made from what you already raised.',
  people: 'One record per employee, with documents, joining and exit checklists and letters. Staff see their payslips and ask for leave on their own phone.',
  payroll: 'Salaries with PF, ESI, professional tax and TDS. The PF ECR file and Form 16 come out of the same run, and the run posts its journal to Books.',
  attendance: 'Punches from ZKTeco, eSSL, Hikvision and Matrix readers, or from a phone inside your site. Shifts, late marks and overtime, closed each month for payroll.',
  projects: 'Tasks, milestones and what each project costs. We are still building it.',
  timesheet: 'Hours logged against projects and clients, approved and billed. We are still building it.',
};

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
    title: 'HR teams',
    text: 'Joining and exit checklists that HR, IT and the manager each tick off. Documents remind you before they expire. One record per person, from offer letter to final settlement.',
    link: ['/products/people', 'CLOR People'],
  },
  {
    title: 'Finance teams',
    text: 'Invoices, bills and the salary run post their own journals. Invoices above an amount wait for approval, and a change to bank details needs a second person.',
    link: ['/products/books', 'CLOR Books'],
  },
];

const FAQ = [
  ['Do I have to buy every product?', 'No. Each CLOR product works on its own. Start with the one you need and add others later; they share one login and one list of employees.'],
  ['Is CLOR made for Indian companies?', 'Yes. GST, e-invoices and e-way bills, TDS, PF, ESI, professional tax and Form 16 are part of the products, not add-ons.'],
  ['Where is my data kept?', `In ${SITE.hosting}. Each company’s records are kept apart inside the database itself, not only by the application.`],
  ['Can my accountant or CA work with me?', 'Yes. Invite them from your Workspace (Access, then Invitations) with their own login, choose what they can see and change, and end it whenever you like. A workspace for the firm’s own staff is planned.'],
  ['Can I leave with my data?', 'Yes. You can export your company’s data at any time, and closing a company comes with a notice period.'],
];

export default function Home() {
  return (
    <>
      <section className="hero hero--home" aria-labelledby="hero-title">
        <div className="wrap hero-copy">
          <h1 id="hero-title" className="h-hero">
            Accounts and payroll for Indian companies, under one login.
          </h1>
          <p className="lede">
            Raise GST invoices and e-way bills in Books. Run salaries with PF, ESI and TDS in Payroll. The person you hire on Monday is already on the salary sheet, because both read the
            same employee record.
          </p>
          <div className="actions">
            <Link className="btn btn--primary btn--lg" href={SITE.demoUrl}>
              Request a demo
            </Link>
            <a className="btn btn--text" href="#screens">
              See the screens
            </a>
          </div>
        </div>
      </section>

      <section className="section" id="screens" aria-labelledby="connected-title">
        <div className="wrap">
          <Head
            id="connected-title"
            title="Attendance feeds payroll. Payroll posts to Books."
            intro="Payable days from the biometric reader become the month’s salary run, and the salary run lands in Books as a journal entry. Nobody exports a spreadsheet in between."
          />
          <Connection />
        </div>
      </section>

      <section className="section" aria-labelledby="apps-title">
        <div className="wrap">
          <Head id="apps-title" title="Four products today. Projects and Timesheet are next." intro="Buy only the one you need. Add another later and it picks up the employees and accounts you already have." />
          <ul className="plist">
            {PRODUCTS.map((p) => (
              <li key={p.slug} className={p.status === 'soon' ? 'is-soon' : undefined}>
                <h3 className="h-3">
                  <Link href={`/products/${p.slug}`}>CLOR {p.name}</Link>
                  {p.status === 'soon' ? <Status product={p} /> : null}
                </h3>
                <p className="body">{LINES[p.slug]}</p>
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
