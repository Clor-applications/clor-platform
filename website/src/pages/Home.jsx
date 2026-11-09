import React from 'react';
import { Calculator, ChartLineUp, Storefront, UsersThree } from '@phosphor-icons/react';
import { Link } from '../router.jsx';
import { CONNECTIONS, SITE, productBySlug } from '../site.js';
import { GstrWindow, WINDOWS } from '../components/Windows.jsx';
import { Head, SettingUp, TrustBand } from '../components/Sections.jsx';
import { Faq } from '../components/Blocks.jsx';
import { Mark, Status } from '../components/Brand.jsx';

/*
 * The home page reads like the suite it is: one line for accounts, payroll and
 * HR, the three screens standing as one 3D stack, the four products as tiles,
 * then a section each with its screen standing in 3D (all drawn with sample
 * data). How they join comes after, and the page closes on a slate band.
 * Every claim here is in CONTENT_CHECKLIST.md.
 */
const APPS = [
  {
    slug: 'books',
    title: 'GST invoices, returns and books in one place.',
    lines: [
      'Raise GST invoices, e-invoices and e-way bills, and file GSTR-1 and GSTR-3B from what you raised.',
      'Import masters and opening balances from Tally, and reconcile the bank statement against your books.',
      'Invoices above an amount wait for approval before they go out.',
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
    icon: Storefront,
    title: 'Business owners',
    text: 'File GSTR-1 and GSTR-3B from the invoices you already raised. Import masters and opening balances from Tally. Reconcile the bank statement against Books.',
    link: ['/solutions/businesses', 'CLOR for businesses'],
  },
  {
    icon: Calculator,
    title: 'Accountants and CA firms',
    text: 'Your client invites you with your own login and decides what you may see and change. You switch between clients from the company menu without signing out.',
    link: ['/solutions/accounting-firms', 'CLOR for accounting firms'],
  },
  {
    icon: ChartLineUp,
    title: 'Finance teams',
    text: 'Invoices, bills and the salary run post their own journals. Invoices above an amount wait for approval, and a change to bank details needs a second person.',
    link: ['/products/books', 'CLOR Books'],
  },
  {
    icon: UsersThree,
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

/** A product's screen standing in 3D, with two blank sheets stacked behind it. */
function Stage({ children, flip }) {
  return (
    <figure className={`stage${flip ? ' stage--flip' : ''}`}>
      <div className="stage-obj">
        <span className="stage-sheet stage-sheet--2" aria-hidden="true" />
        <span className="stage-sheet stage-sheet--1" aria-hidden="true" />
        <div className="stage-win">{children}</div>
      </div>
    </figure>
  );
}

/** Each section's photo: a real CLOR screen (sample data) on the device in the picture. */
const SHOTS = {
  books: { src: ['/people/books-invoice-560.webp', '/people/books-invoice-980.webp'], w: [560, 980], h: 620, alt: 'A tax invoice in CLOR Books on a laptop, with sample data' },
  people: { src: ['/people/people-hr-700.webp', '/people/people-hr-1400.webp'], w: [700, 1400], h: 788, alt: 'An HR manager looking at an employee’s profile in CLOR People' },
  payroll: { src: ['/people/payroll-payslip-560.webp', '/people/payroll-payslip-1120.webp'], w: [560, 1120], h: 1400, alt: 'An employee reading her October payslip from CLOR Payroll on her phone' },
  attendance: { src: ['/people/attendance-reader-700.webp', '/people/attendance-reader-1400.webp'], w: [700, 1400], h: 1050, alt: 'An employee punching in on a biometric reader showing CLOR Attendance' },
};

/** One product's section: what it does in a few plain lines, beside a photo and its screen. */
function AppSection({ slug, title, lines, flip }) {
  const p = productBySlug(slug);
  // The hero already shows Books' invoice, so Books' own section shows the GSTR-1 it feeds.
  const Win = slug === 'books' ? GstrWindow : WINDOWS[slug];
  return (
    <section className="section app-sec-wrap" aria-labelledby={`${slug}-title`} style={{ '--app': p.accent }}>
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
        {SHOTS[slug] ? (
          <figure className={`app-sec-photo app-sec-photo--${slug}`}>
            <img
              src={SHOTS[slug].src[1]}
              srcSet={`${SHOTS[slug].src[0]} ${SHOTS[slug].w[0]}w, ${SHOTS[slug].src[1]} ${SHOTS[slug].w[1]}w`}
              sizes="(max-width: 900px) 100vw, 560px"
              width={SHOTS[slug].w[1]}
              height={SHOTS[slug].h}
              loading="lazy"
              alt={SHOTS[slug].alt}
            />
          </figure>
        ) : (
          <Stage flip={flip}>
            <Win />
          </Stage>
        )}
      </div>
    </section>
  );
}

const SUITE = ['books', 'people', 'payroll', 'attendance', 'projects', 'timesheet'];

/** Each card's picture: a person cut out on the page ground, or a scene that fades into the card. */
const PICS = {
  books: { kind: 'cut' },
  people: { kind: 'cut' },
  payroll: { kind: 'cut' },
  attendance: { kind: 'scene' },
  projects: { kind: 'scene' },
  timesheet: { kind: 'scene' },
};

export default function Home() {
  return (
    <>
      <section className="hero hero--home" aria-labelledby="hero-title">
        <div className="wrap home-hero home-hero--split">
          <div className="hero-copy">
            <h1 id="hero-title" className="h-hero">
              Accounts, payroll and HR for growing Indian companies.
            </h1>
            <p className="lede">
              GST accounting in CLOR Books, salaries with PF, ESI, PT and TDS in Payroll, every employee’s record in People, and punches from the gate in Attendance. One login, one list
              of employees, one set of books.
            </p>
            <div className="actions">
              <Link className="btn btn--primary btn--lg" href={SITE.demoUrl}>
                Request a demo
              </Link>
              <a className="btn btn--quiet btn--lg" href={SITE.startUrl}>
                Start free trial
              </a>
              <Link className="btn btn--text" href="/pricing">
                See pricing
              </Link>
            </div>
          </div>
          <figure className="hero-photo">
            <img
              src="/people/hero-books-1400.webp"
              srcSet="/people/hero-books-700.webp 700w, /people/hero-books-1400.webp 1400w"
              sizes="(max-width: 900px) 100vw, 640px"
              width="1400"
              height="835"
              fetchPriority="high"
              alt="An accountant at his desk with the CLOR Books dashboard open on his laptop"
            />
          </figure>
        </div>
      </section>

      <section className="section section--tint" aria-labelledby="suite-title">
        <div className="wrap">
          <div className="head head--center">
            <h2 className="h-1" id="suite-title">
              Connected business applications
            </h2>
            <p className="lede">One back office for accounts, people, attendance and payroll, sharing one login and one list of employees.</p>
          </div>
          <ul className="apps">
            {SUITE.map((slug) => {
              const p = productBySlug(slug);
              const pic = PICS[slug];
              const soon = p.status !== 'available';
              return (
                <li key={slug} className={`app-card app-card--${pic.kind} app-card--${slug}`} style={{ '--app': p.accent }}>
                  <div className="app-card-copy">
                    <div className="app-card-name">
                      <Mark product={p} size={44} />
                      <div>
                        <h3 className="h-3">CLOR {p.name}</h3>
                        <Status product={p} />
                      </div>
                    </div>
                    <p className="body">{p.line}</p>
                    <Link className="app-card-btn" href={`/products/${slug}`}>
                      {soon ? 'See what’s planned' : `Explore ${p.name}`}
                      <span aria-hidden="true">→</span>
                    </Link>
                  </div>
                  <img
                    className="app-card-pic"
                    src={`/people/${slug}-360.webp`}
                    srcSet={`/people/${slug}-360.webp 1x, /people/${slug}-720.webp 2x`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {APPS.map((a, i) => (
        <AppSection key={a.slug} {...a} flip={i % 2 === 1} />
      ))}

      <section className="section section--tint" aria-labelledby="connected-title">
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
                <span className="tile" aria-hidden="true">
                  <t.icon size={22} weight="duotone" />
                </span>
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

      <section className="closing-band" aria-labelledby="closing-title">
        <div className="wrap closing-band-inner">
          <h2 className="h-1" id="closing-title">
            See CLOR with your own company’s figures.
          </h2>
          <p className="lede">Tell us what you use today for accounts, attendance and salaries, and we will show you the same month’s work in CLOR.</p>
          <div className="actions">
            <Link className="btn btn--primary btn--lg" href={SITE.demoUrl}>
              Request a demo
            </Link>
            <Link className="btn btn--onphoto" href="/contact">
              Write to us
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
