import React, { useEffect, useRef, useState } from 'react';
import { Bank, Calculator, CaretDown, CaretRight, Check, ChartLineUp, Fingerprint, MapPin, Pause, Play, Receipt, Storefront, UsersThree } from '@phosphor-icons/react';
import { Link } from '../router.jsx';
import { CONNECTIONS, SITE, productBySlug } from '../site.js';
import { GstrWindow, WINDOWS } from '../components/Windows.jsx';
import { Head, SettingUp, TrustBand } from '../components/Sections.jsx';
import { Faq } from '../components/Blocks.jsx';
import { Mark } from '../components/Brand.jsx';

/*
 * The hero window (owner, 13 Nov 2026: the angled video card was "not good").
 * A flat, straight CLOR window with the month-end chain on sample data:
 * Attendance closes the month, Payroll pays from those days, Books gets the
 * journal. Each pane lights in turn (CSS only; still under reduced motion).
 * Every step is a CONNECTIONS line in site.js, so nothing here is invented.
 */
/*
 * The hero clip (owner, 13 Nov 2026: "i want hero video clip", made with
 * HyperFrames and Three.js in video/hero-3d): the People, Attendance, Payroll
 * and Books screens floating in depth, an orange line lighting each in turn.
 * It sits behind the headline; the left of the frame is kept empty for it.
 * Under reduced motion only the still frame shows. A pause button is always
 * there because the clip loops.
 */
function HeroVideo() {
  const ref = useRef(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      v.pause();
      setPaused(true);
      return;
    }
    v.play?.().catch(() => setPaused(true));
  }, []);
  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
  };
  return (
    <div className="hv">
      <video ref={ref} className="hv-video" muted loop playsInline preload="auto" poster="/hero/clor-hero-3d-poster.webp" aria-hidden="true">
        <source src="/hero/clor-hero-3d.webm" type="video/webm" />
        <source src="/hero/clor-hero-3d.mp4" type="video/mp4" />
      </video>
      <button type="button" className="hv-toggle" onClick={toggle} aria-label={paused ? 'Play the background video' : 'Pause the background video'}>
        {paused ? <Play size={14} weight="fill" /> : <Pause size={14} weight="fill" />}
      </button>
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

/*
 * Products, after Azure's "Explore tools": filter pills, a photo tile, then a
 * card per product with its mark, one line and a link.
 */
const FILTERS = [
  ['all', 'All products', null],
  ['money', 'Accounts and payroll', ['books', 'payroll']],
  ['people', 'People and time', ['people', 'attendance']],
  ['soon', 'Coming next', ['projects', 'timesheet']],
];

function ProductGrid() {
  const [f, setF] = useState('all');
  const only = FILTERS.find((x) => x[0] === f)[2];
  const list = ['books', 'payroll', 'people', 'attendance', 'projects', 'timesheet'].filter((s) => !only || only.includes(s));
  return (
    <section className="section section--tint" aria-labelledby="suite-title">
      <div className="wrap">
        <p className="eyebrow">Products</p>
        <h2 className="h-1 az-h" id="suite-title">
          Connected business applications
        </h2>
        <div className="chips" role="tablist" aria-label="Show products">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={f === k} className={f === k ? 'is-on' : ''} onClick={() => setF(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="pg">
          <figure className="pg-photo">
            <img src="/people/attendance-reader-700.webp" srcSet="/people/attendance-reader-700.webp 1x, /people/attendance-reader-1400.webp 2x" alt="An employee punching in at a reader by the office door" loading="lazy" decoding="async" />
            <figcaption>One login and one list of employees across every product.</figcaption>
          </figure>
          <ul className="pg-cards">
            {list.map((slug) => {
              const p = productBySlug(slug);
              return (
                <li key={slug} className="az-card pg-card" data-app={slug} style={{ '--app': p.accent }}>
                  <Mark product={p} size={40} />
                  <h3 className="az-card-h">CLOR {p.name}</h3>
                  <p className="body">{p.line}</p>
                  {p.status === 'soon' ? <p className="pg-soon">Coming next</p> : null}
                  <Link className="az-link" href={`/products/${slug}`}>
                    Explore the product
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

/*
 * How the products connect, after Azure's "Find solutions": an accordion on
 * the left, the matching CLOR screen in a frame on the right.
 */
function Connections() {
  const [open, setOpen] = useState(0);
  const x = CONNECTIONS[open];
  const Win = x.to === 'books' ? WINDOWS.books : WINDOWS[x.to];
  return (
    <section className="section" aria-labelledby="connected-title">
      <div className="wrap">
        <p className="eyebrow">How they connect</p>
        <h2 className="h-1 az-h" id="connected-title">
          Attendance feeds payroll. Payroll posts to Books.
        </h2>
        <div className="acc-grid">
          <ul className="acc">
            {CONNECTIONS.map((c, i) => {
              const a = productBySlug(c.from);
              const b = productBySlug(c.to);
              const on = i === open;
              return (
                <li key={c.from + c.to} className={on ? 'is-on' : ''}>
                  <button type="button" aria-expanded={on} onClick={() => setOpen(i)}>
                    <span className="acc-pair">
                      <Mark product={a} size={26} />
                      <span aria-hidden="true">→</span>
                      <Mark product={b} size={26} />
                    </span>
                    {a.name} to {b.name}
                    <CaretDown size={16} weight="bold" aria-hidden="true" className="acc-caret" />
                  </button>
                  {on ? (
                    <div className="acc-body">
                      <p className="body">{c.text}</p>
                      <Link className="text-link" href={`/products/${c.to}`}>
                        More about CLOR {b.name}
                      </Link>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <figure className="acc-media" key={open}>
            <div className="acc-frame">
              <Win />
            </div>
          </figure>
        </div>
      </div>
    </section>
  );
}

/* Who uses CLOR, after Azure's news cards: a photo on top, words, an arrow link. */
const TEAM_PICS = {
  'Business owners': ['/people/business-workspace-700.webp', 'A woman at an office desk with CLOR open on her laptop'],
  'Accountants and CA firms': ['/people/books-invoice-560.webp', 'A GST invoice open in CLOR Books on a laptop'],
  'Finance teams': ['/people/payroll-payslip-560.webp', 'An employee reading her payslip in the CLOR app'],
  'HR teams': ['/people/people-hr-700.webp', 'An HR manager looking at an employee record in CLOR People'],
};

function TeamCards() {
  return (
    <section className="section section--tint" aria-labelledby="team-title">
      <div className="wrap">
        <p className="eyebrow">Who uses CLOR</p>
        <h2 className="h-1 az-h" id="team-title">
          Made for the people who run the back office
        </h2>
        <ul className="tc">
          {TEAMS.map((t) => {
            const [src, alt] = TEAM_PICS[t.title];
            return (
              <li key={t.title} className="az-card tc-card">
                <img className="tc-img" src={src} alt={alt} loading="lazy" decoding="async" />
                <h3 className="az-card-h">{t.title}</h3>
                <p className="body">{t.text}</p>
                <Link className="az-arrow" href={t.link[0]}>
                  <span className="az-arrow-box" aria-hidden="true">
                    <CaretRight size={14} weight="bold" />
                  </span>
                  {t.link[1]}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* In-page menu that sticks under the header (after azure.microsoft.com). */
const JUMPS = [
  ['suite-title', 'Products'],
  ['pc-title', 'What each does'],
  ['connected-title', 'How they connect'],
  ['setup-title', 'Setting up'],
  ['team-title', 'Who uses CLOR'],
  ['trust-title', 'Your data'],
];

function JumpBar() {
  const [on, setOn] = useState(JUMPS[0][0]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) if (e.isIntersecting) setOn(e.target.getAttribute('aria-labelledby'));
      },
      { rootMargin: '-30% 0px -60% 0px' },
    );
    JUMPS.forEach(([id]) => {
      const sec = document.querySelector(`section[aria-labelledby="${id}"]`);
      if (sec) io.observe(sec);
    });
    return () => io.disconnect();
  }, []);
  return (
    <nav className="jump" aria-label="On this page">
      <ul className="wrap">
        {JUMPS.map(([id, label]) => (
          <li key={id}>
            <a
              href={`#${id}`}
              className={on === id ? 'is-on' : ''}
              aria-current={on === id ? 'location' : undefined}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function Home() {
  return (
    <>
      <section className="hero hero--home hero--split2 hero--video" aria-labelledby="hero-title">
        <HeroVideo />
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

      <JumpBar />

      <ProductGrid />

      <ProductCards />

      <Connections />

      <SettingUp />

      <TeamCards />

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
