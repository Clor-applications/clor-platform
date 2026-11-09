import React from 'react';
import { Link } from '../router.jsx';
import { AVAILABLE, SITE, productBySlug } from '../site.js';
import { HERO_FIGS } from '../components/Figures.jsx';
import { Head } from '../components/Sections.jsx';
import { Closing, Faq } from '../components/Blocks.jsx';
import { Mark } from '../components/Brand.jsx';
import { Flow } from '../components/Flow.jsx';

/*
 * The home page: the headline beside Books' invoice, one line about the five
 * products, then one numbered figure per product in the owner's order (Books,
 * People, Attendance, Payroll, Workspace), each one moment from the product
 * with three short lines beside it. Then how the products join, what Indian
 * law they cover, how pricing works, who uses CLOR, the questions people ask
 * and the demo. Every claim here is in CONTENT_CHECKLIST.md.
 */
const APPS = [
  {
    slug: 'books',
    title: 'Accounting that already knows GST.',
    lines: ['Every invoice, bill and receipt posts its own journal as it is saved.', 'e-Invoices and e-way bills from the invoice itself; GSTR-1 and GSTR-3B from the month.', 'Masters and opening balances come in from Tally.'],
    caption: 'A tax invoice, posted to Sales and Output GST as it is saved.',
  },
  {
    slug: 'people',
    title: 'One record for every employee.',
    lines: ['The full HR app for growing, medium and big companies.', 'Attendance, leave and shifts are inside it, so there is no second app for time.', 'Joining and leaving run from checklists for HR, IT and the manager.'],
    caption: 'An employee’s record, with her joining checklist four of six done.',
  },
  {
    slug: 'attendance',
    title: 'Time and leave for a small company.',
    lines: ['Punches arrive from ZKTeco, eSSL, Hikvision and Matrix readers as they happen.', 'Field staff punch from a phone inside your site’s geofence.', 'Closing the month hands paid days and overtime to Payroll.'],
    caption: 'Today, as the punches come in from the gate reader and the field.',
  },
  {
    slug: 'payroll',
    title: 'Salaries with PF, ESI, PT and TDS worked out.',
    lines: ['Each payslip reaches the employee’s phone when the run is locked.', 'The PF ECR file, the ESI return and Form 16 come out of the same payslips.', 'Locking the run posts its journal to Books.'],
    caption: 'October’s pay run, locked, with the net pay to forty-eight bank accounts.',
  },
  {
    slug: 'workspace',
    title: 'One sign-in, and who may see what.',
    lines: ['Comes with every product: all your companies and branches under one sign-in.', 'Invite your accountant with their own login and the role you choose.', 'Every change is written to the audit trail with a name on it.'],
    caption: 'Users and roles, with an accountant’s access that ends on a date.',
  },
];

const COMPLIANCE = [
  ['GST', 'CGST, SGST and IGST from the place of supply', 'Books'],
  ['e-Invoice', 'IRN generated from the invoice', 'Books'],
  ['e-Way bill', 'Raised from the invoice or challan', 'Books'],
  ['GSTR-1 and GSTR-3B', 'Built from the month’s documents', 'Books'],
  ['TDS', 'On purchases and on salary, with 24Q', 'Books, Payroll'],
  ['PF', 'Employee and employer shares, the ECR file', 'Payroll'],
  ['ESI', 'Contributions and the return', 'Payroll'],
  ['Professional tax', 'By the state each person works in', 'Payroll'],
  ['Form 16', 'For every employee at year end', 'Payroll'],
];

const TEAMS = [
  {
    title: 'Owners of small companies',
    text: 'File GSTR-1 and GSTR-3B from the invoices you already raised. Bring masters and opening balances from Tally. Take attendance from the reader at the gate and pay salaries from it.',
    link: ['/solutions/businesses', 'CLOR for businesses'],
  },
  {
    title: 'HR in a growing company',
    text: 'One record per person from offer letter to final settlement. Checklists that HR, IT and the manager each tick off. Documents that remind you before they expire.',
    link: ['/products/people', 'CLOR People'],
  },
  {
    title: 'Finance teams',
    text: 'Invoices, bills and the salary run post their own journals. Invoices above an amount wait for approval; a change to bank details needs a second person.',
    link: ['/products/books', 'CLOR Books'],
  },
  {
    title: 'Accountants and CA firms',
    text: 'Your client invites you with your own login and decides what you may see and change. Switch between clients from the company menu.',
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

/** One product: its number, name, a headline and three lines beside its figure; the side alternates down the page. */
function AppSection({ slug, title, lines, caption, flip, n }) {
  const p = productBySlug(slug);
  const Figure = HERO_FIGS[slug];
  return (
    <section className="section" aria-labelledby={`${slug}-title`}>
      <div className={`wrap app-sec${flip ? ' app-sec--flip' : ''}`}>
        <div className="app-sec-copy">
          <p className="app-sec-n num" aria-hidden="true">
            {n}
          </p>
          <p className="app-sec-name">
            <Mark product={p} size={26} /> CLOR&nbsp;{p.name}
          </p>
          <h2 className="h-1" id={`${slug}-title`}>
            {title}
          </h2>
          <ul className="lines">
            {lines.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <Link className="text-link" href={`/products/${slug}`}>
            More about CLOR&nbsp;{p.name}
          </Link>
        </div>
        <div className="app-sec-pic">
          <Figure n={n} caption={caption} />
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const Invoice = HERO_FIGS.books;
  return (
    <>
      <section className="hero hero--home" aria-labelledby="hero-title">
        <div className="wrap home-hero">
          <div className="hero-copy">
            <h1 id="hero-title" className="h-hero">
              Accounts, GST, staff and salaries for companies in India.
            </h1>
            <p className="lede">Five products that share one sign-in and one list of employees. Start with the one you need.</p>
            <div className="actions">
              <Link className="btn btn--primary btn--lg" href={SITE.demoUrl}>
                Request a demo
              </Link>
              <Link className="btn btn--quiet btn--lg" href="/products">
                See the five products
              </Link>
            </div>
          </div>
          <div className="home-shot">
            <Invoice reveal={false} caption={false} className="fig--hero" />
          </div>
        </div>
      </section>

      <section className="section promise" aria-label="The five products">
        <div className="wrap promise-inner">
          <p className="promise-line">Books, People, Attendance, Payroll and Workspace. Five products, one sign-in, one list of employees. Each works on its own; together they read the same records.</p>
          <ul className="promise-marks" aria-hidden="true">
            {AVAILABLE.map((p) => (
              <li key={p.slug}>
                <Mark product={p} size={40} />
                <span>{p.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {APPS.map((a, i) => (
        <AppSection key={a.slug} {...a} n={`0${i + 1}`} flip={i % 2 === 1} />
      ))}

      <section className="section" aria-labelledby="flow-title">
        <div className="wrap">
          <Head id="flow-title" title="How it fits together" intro="Attendance closes the month and hands it to Payroll. Payroll locks the run and posts it to Books. All three read the one employee record in People." />
          <Flow />
        </div>
      </section>

      <section className="section" aria-labelledby="law-title">
        <div className="wrap split">
          <Head id="law-title" title="Indian law, built in" intro="Not add-ons. Each of these is part of the product it belongs to." />
          <ul className="ruled">
            {COMPLIANCE.map(([k, v, where]) => (
              <li key={k}>
                <span className="ruled-k">{k}</span>
                <span className="ruled-v">{v}</span>
                <span className="ruled-where">{where}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="price-title">
        <div className="wrap split">
          <Head id="price-title" title="Pay for the products you use" />
          <div className="stack">
            <p className="lede">Each product has its own subscription, and Workspace comes with any of them. Prices are being finalised; until they are published, we will tell you what your company would pay.</p>
            <div className="actions">
              <Link className="btn btn--quiet" href="/pricing">
                How pricing works
              </Link>
              <Link className="text-link" href="/contact?about=pricing">
                Ask about pricing
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="team-title">
        <div className="wrap">
          <Head id="team-title" title="Who uses CLOR" />
          <ul className="teams">
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

      <section className="section">
        <div className="wrap">
          <Faq items={FAQ} />
        </div>
      </section>

      <Closing title="See it with your own company’s figures." text="Tell us what you use today for accounts, attendance and salaries, and we will show you the same month’s work in CLOR." />
    </>
  );
}
