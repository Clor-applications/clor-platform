import React, { useEffect, useRef, useState } from 'react';
import { Art3D } from '../components/Art3D.jsx';
import { Bank, Calculator, ChartLineUp, Fingerprint, MapPin, Receipt, Storefront, UsersThree } from '@phosphor-icons/react';
import { Link } from '../router.jsx';
import { CONNECTIONS, SITE, productBySlug } from '../site.js';
import { GstrWindow, WINDOWS } from '../components/Windows.jsx';
import { Head, SettingUp, TrustBand } from '../components/Sections.jsx';
import { Faq } from '../components/Blocks.jsx';
import { Mark, Status } from '../components/Brand.jsx';

/*
 * The hero window (owner, 13 Nov 2026: the angled video card was "not good").
 * A flat, straight CLOR window with the month-end chain on sample data:
 * Attendance closes the month, Payroll pays from those days, Books gets the
 * journal. Each pane lights in turn (CSS only; still under reduced motion).
 * Every step is a CONNECTIONS line in site.js, so nothing here is invented.
 */
/*
 * The hero card (owner, 13 Nov 2026, after tensordata.com's terminal card):
 * one company's month end as an activity log, each line a real hand-off
 * between CLOR products (CONNECTIONS in site.js). Sample data; lines appear
 * one by one, all at once under reduced motion.
 */
const LOG = [
  ['09:02', 'attendance', 'Meera Iyer punched in at Gate 2 (ZKTeco reader)'],
  ['18:00', 'attendance', 'November closed: paid days, overtime and leave sent to Payroll'],
  ['18:03', 'payroll', 'Pay run for 48 employees calculated with PF, ESI, PT and TDS'],
  ['18:10', 'payroll', 'Run locked. Payslips on every employee’s phone'],
  ['18:10', 'books', 'Salary journal posted to Books'],
];

function HeroLog() {
  return (
    <div className="hl" role="img" aria-label="Sample activity: Attendance closes November, Payroll runs and locks salaries, Books receives the salary journal.">
      <div className="hl-bar">
        <span className="hl-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>Kaveri Components · month end</span>
      </div>
      <ol className="hl-lines">
        {LOG.map(([t, slug, text], i) => {
          const p = productBySlug(slug);
          return (
            <li key={i} style={{ '--i': i }}>
              <time>{t}</time>
              <b data-app={slug}>{p.name}</b>
              <span>{text}</span>
            </li>
          );
        })}
        <li className="hl-done" style={{ '--i': LOG.length }}>
          <time>18:10</time>
          <b>Done</b>
          <span>No spreadsheet in between</span>
        </li>
      </ol>
    </div>
  );
}

const FACTS = [
  [Receipt, 'GST e-invoice', 'E-way bills, GSTR-1 and 3B'],
  [Bank, 'PF, ESI, PT, TDS', 'On every payslip'],
  [Fingerprint, 'Gate readers', 'ZKTeco, eSSL, Hikvision, Matrix'],
  [MapPin, 'Mumbai region', 'Data kept in India'],
];

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

/*
 * The four products as stacked cards beside a list that stays in view
 * (owner, 13 Nov 2026: Keka's cards). The list marks the card on screen and
 * jumps to a card when clicked; each card holds its product's own screen.
 */
function ProductCards() {
  const [on, setOn] = useState(APPS[0].slug);
  const refs = useRef({});
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) if (e.isIntersecting) setOn(e.target.dataset.slug);
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    Object.values(refs.current).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);
  return (
    <section className="section pc" aria-labelledby="pc-title">
      <div className="wrap">
        <h2 className="h-1 pc-title" id="pc-title">
          One back office, four products
        </h2>
        <div className="pc-grid">
          <nav className="pc-nav" aria-label="Products">
            {APPS.map((a) => {
              const p = productBySlug(a.slug);
              return (
                <a
                  key={a.slug}
                  href={`#pc-${a.slug}`}
                  className={on === a.slug ? 'is-on' : ''}
                  aria-current={on === a.slug ? 'true' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    refs.current[a.slug]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <Mark product={p} size={28} />
                  CLOR {p.name}
                </a>
              );
            })}
          </nav>
          <div className="pc-stack">
            {APPS.map((a, i) => {
              const p = productBySlug(a.slug);
              const Win = a.slug === 'books' ? GstrWindow : WINDOWS[a.slug];
              return (
                <article
                  key={a.slug}
                  id={`pc-${a.slug}`}
                  data-slug={a.slug}
                  ref={(el) => (refs.current[a.slug] = el)}
                  className="pc-card"
                  style={{ '--app': p.accent, '--n': i }}
                  aria-labelledby={`${a.slug}-title`}
                >
                  <p className="pc-kicker">CLOR {p.name}</p>
                  <h3 className="pc-h" id={`${a.slug}-title`}>
                    {a.title}
                  </h3>
                  <p className="pc-text">{a.lines[0]}</p>
                  <div className="pc-win">
                    <Win />
                  </div>
                  <Link className="btn btn--trial pc-btn" href={`/products/${a.slug}`}>
                    Learn more
                  </Link>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

const SUITE = ['books', 'people', 'payroll', 'attendance'];
const NEXT = ['projects', 'timesheet'];

/** Each card's picture: a person cut out on the page ground, or a scene that fades into the card. */
const PICS = {
  books: { kind: 'cut' },
  people: { kind: 'cut' },
  payroll: { kind: 'cut' },
  attendance: { kind: 'scene' },
};

export default function Home() {
  return (
    <>
      <section className="hero hero--home hero--split2" aria-labelledby="hero-title">
        <div className="wrap hero2">
          <div className="hero2-copy">
            <h1 id="hero-title" className="h-hero">
              Accounts, payroll and HR for growing Indian companies.
            </h1>
            <p className="lede">GST books, payroll with PF, ESI, PT and TDS, employee records and gate attendance. One login, one list of employees.</p>
            <div className="actions">
              <Link className="btn btn--primary btn--lg" href={SITE.demoUrl}>
                Request a demo
              </Link>
              <a className="btn btn--trial btn--lg" href={SITE.startUrl}>
                Start free trial
              </a>
            </div>
          </div>
          <HeroLog />
        </div>
      </section>

      <section className="trust" aria-label="What CLOR handles">
        <ul className="wrap trust-row">
          {FACTS.map(([Icon, t, d]) => (
            <li key={t}>
              <span className="trust-ico" aria-hidden="true">
                <Icon size={20} weight="duotone" />
              </span>
              <span>
                <b>{t}</b>
                <small>{d}</small>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="section section--tint" aria-labelledby="suite-title">
        <div className="wrap">
          <div className="head">
            <h2 className="h-1" id="suite-title">
              Connected business applications
            </h2>
            <p className="lede">One back office for accounts, people, attendance and payroll, sharing one login and one list of employees.</p>
          </div>
          <ul className="apps">
            {SUITE.map((slug) => {
              const p = productBySlug(slug);
              const pic = PICS[slug];
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
                      {`Explore ${p.name}`}
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
          <div className="apps-next">
            <p className="apps-next-title">Coming next</p>
            <ul>
              {NEXT.map((slug) => {
                const p = productBySlug(slug);
                return (
                  <li key={slug}>
                    <Link href={`/products/${slug}`} className="apps-next-item">
                      <Mark product={p} size={32} />
                      <span>
                        <span className="apps-next-name">CLOR {p.name}</span>
                        <span className="body">{p.line}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>

      <ProductCards />

      <section className="section section--tint" aria-labelledby="connected-title">
        <div className="wrap split">
          <Head
            id="connected-title"
            title="Attendance feeds payroll. Payroll posts to Books."
            intro="Bought together, the four products read the same employees and post to the same books, so nobody exports a spreadsheet in between. Projects and Timesheet are next."
            art={<Art3D kind="flow" />}
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
          <Head id="team-title" title="Who uses CLOR" art={<Art3D kind="team" />} />
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
            <a className="btn btn--onphoto" href={SITE.startUrl}>
              Start free trial
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
