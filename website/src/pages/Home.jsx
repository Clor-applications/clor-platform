import React, { useEffect, useId, useMemo, useState } from 'react';
import { BookOpenText, CaretDown, CaretRight, Headset, MagnifyingGlass } from '@phosphor-icons/react';
import { Link } from '../router.jsx';
import { CONNECTIONS, NAV, PRODUCTS, SITE, productBySlug } from '../site.js';
import { useProducts } from '../catalogue.js';
import { BooksWindow, GstrWindow, WINDOWS } from '../components/Windows.jsx';
import { SettingUp } from '../components/Sections.jsx';
import { Faq } from '../components/Blocks.jsx';
import { Mark, Status } from '../components/Brand.jsx';
import QuoteBand from '../components/Quotes.jsx';

/*
 * The home page is a run of full-width bands (owner, 13 Nov 2026): a navy hero,
 * a bar of in-page links that stays at the top, a search band, then each
 * subject under a small capital label and a large quiet heading, with pill
 * tabs choosing what a band shows. Cards are white on a pale ground.
 * Every claim here is in CONTENT_CHECKLIST.md; the sentences are the ones the
 * page carried before, rearranged.
 */

const SECTIONS = [
  ['highlights', 'Highlights'],
  ['solutions', 'Solutions'],
  ['products', 'Products'],
  ['apps', 'Inside each app'],
  ['connected', 'How they connect'],
];

const HIGHLIGHTS = [
  {
    img: 'attendance-reader',
    slug: 'attendance',
    w: 1400,
    alt: 'An employee punching in on a fingerprint reader at the office door',
    title: 'Punches from the reader at the gate',
    text: 'ZKTeco, eSSL, Hikvision and Matrix readers send punches as they happen.',
    href: '/products/attendance',
    go: 'See Attendance',
  },
  {
    img: 'payroll-payslip',
    slug: 'payroll',
    w: 1120,
    alt: 'An employee reading her October payslip on her phone',
    title: 'Payslips on the employee’s phone',
    text: 'Each payslip shows earnings, PF, ESI, professional tax and TDS, and arrives when the run is locked.',
    href: '/products/payroll',
    go: 'See Payroll',
  },
  {
    img: 'people-hr',
    slug: 'people',
    w: 1400,
    alt: 'An HR manager with an employee’s record open in CLOR People',
    title: 'One record for every employee',
    text: 'Personal, job and statutory details with a dated history of every change.',
    href: '/products/people',
    go: 'See People',
  },
];

const SOLUTIONS = [
  {
    key: 'owners',
    tab: 'Business owners',
    img: ['business-workspace', 1400, 'A business owner with her CLOR workspace open on a laptop'],
    link: ['/solutions/businesses', 'CLOR for businesses'],
    items: [
      ['File GST returns', 'File GSTR-1 and GSTR-3B from the invoices you already raised.'],
      ['Move from Tally', 'Import masters and opening balances from Tally.'],
      ['Reconcile the bank', 'Reconcile the bank statement against Books.'],
    ],
  },
  {
    key: 'firms',
    tab: 'Accountants and CA firms',
    img: ['hero-books-soft', 1400, 'An accountant at his desk with the CLOR Books dashboard open'],
    link: ['/solutions/accounting-firms', 'CLOR for accounting firms'],
    items: [
      ['Your own login', 'Your client invites you with your own login and decides what you may see and change.'],
      ['Many clients, one sign-in', 'You switch between clients from the company menu without signing out.'],
      ['Access the client controls', 'The client chooses what you can see and change, and can end it whenever they like.'],
    ],
  },
  {
    key: 'finance',
    tab: 'Finance teams',
    img: ['books-invoice', 980, 'A GST invoice open in CLOR Books on a laptop'],
    link: ['/products/books', 'CLOR Books'],
    items: [
      ['Journals post themselves', 'Invoices, bills and the salary run post their own journals.'],
      ['Approval above an amount', 'Invoices above an amount wait for approval before they go out.'],
      ['A second person for bank details', 'A change to bank details needs a second person.'],
    ],
  },
  {
    key: 'hr',
    tab: 'HR teams',
    img: ['demo-team-3d', 1120, 'A team gathered around a laptop'],
    link: ['/products/people', 'CLOR People'],
    items: [
      ['Joining and exit checklists', 'Joining and exit checklists that HR, IT and the manager each tick off.'],
      ['Documents that remind you', 'Documents remind you before they expire.'],
      ['One record per person', 'One record per person, from offer letter to final settlement.'],
    ],
  },
];

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

const FAQ = [
  ['Do I have to buy every product?', 'No. Each CLOR product works on its own. Start with the one you need and add others later; they share one login and one list of employees.'],
  ['Is CLOR made for Indian companies?', 'Yes. GST, e-invoices and e-way bills, TDS, PF, ESI, professional tax and Form 16 are part of the products, not add-ons.'],
  ['Where is my data kept?', `In ${SITE.hosting}. Each company’s records are kept apart inside the database itself, not only by the application.`],
  ['Can my accountant or CA work with me?', 'Yes. Invite them from your Workspace (Access, then Invitations) with their own login, choose what they can see and change, and end it whenever you like. A workspace for the firm’s own staff is planned.'],
  ['Can I leave with my data?', 'Yes. You can export your company’s data at any time, and closing a company comes with a notice period.'],
];

/* What the search box knows: every product and page, with the words people type for it. */
const WORDS = {
  books: 'gst invoice e-invoice e-way bill gstr-1 gstr-3b tally accounting accounts bank reconciliation inventory billing',
  payroll: 'salary salaries payslip pf esi pt tds form 16 ecr wages',
  people: 'hr employee record documents onboarding leave letters org chart exit',
  attendance: 'biometric reader punch zkteco essl hikvision matrix shift overtime geofence fingerprint',
  projects: 'tasks project cost planning',
  timesheet: 'time hours billing clients',
  '/pricing': 'price cost plan subscription trial free how much',
  '/integrations': 'biometric tally greythr keka zoho sso saml scim api webhook upi connect',
  '/security': 'data safe mumbai hosting audit export privacy',
  '/resources': 'help guide setup how to',
  '/solutions/businesses': 'business owner company',
  '/solutions/accounting-firms': 'ca accountant firm clients',
  '/company/about': 'who company bengaluru',
  '/company/team': 'founders directors',
  '/contact': 'sales support email phone talk',
  '/demo': 'demo show call',
};
const INDEX = [
  ...PRODUCTS.map((p) => ({ href: `/products/${p.slug}`, name: `CLOR ${p.name}`, line: p.line, words: WORDS[p.slug] || '' })),
  ...[...NAV.solutions, ...NAV.resources, ...NAV.company].map((i) => ({ ...i, words: WORDS[i.href] || '' })),
  { href: '/pricing', name: 'Pricing', line: 'Plans and prices, product by product.', words: WORDS['/pricing'] },
  { href: '/demo', name: 'Request a demo', line: 'We call within one working day.', words: WORDS['/demo'] },
];
const ASKS = [
  ['What does CLOR cost?', '/pricing'],
  ['Which biometric readers connect?', '/integrations'],
  ['Can I import from Tally?', '/products/books'],
];

function find(q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return INDEX.map((i) => {
    const hay = `${i.name} ${i.line} ${i.words}`.toLowerCase();
    return { i, score: terms.filter((t) => hay.includes(t)).length + (terms.some((t) => i.name.toLowerCase().includes(t)) ? 1 : 0) };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.i);
}

/** Left and right move between tabs; the chosen one is the only tab stop. */
function tabKeys(keys, current, pick) {
  return (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = keys[(keys.indexOf(current) + step + keys.length) % keys.length];
    pick(next);
    e.currentTarget.querySelector(`[data-tab="${next}"]`)?.focus();
  };
}

function Tabs({ label, tabs, current, pick, id, kind = 'pills' }) {
  const keys = tabs.map((t) => t[0]);
  return (
    <div className={`fx-tabs fx-tabs--${kind}`} role="tablist" aria-label={label} onKeyDown={tabKeys(keys, current, pick)}>
      {tabs.map(([key, name]) => (
        <button
          key={key}
          type="button"
          role="tab"
          data-tab={key}
          id={`${id}-tab-${key}`}
          aria-selected={current === key}
          aria-controls={`${id}-panel`}
          tabIndex={current === key ? 0 : -1}
          onClick={() => pick(key)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

/** A link with a small square arrow before its words. */
function Go({ href, children, external }) {
  const inner = (
    <>
      <span className="fx-go-chip" aria-hidden="true">
        <CaretRight size={14} weight="bold" />
      </span>
      {children}
    </>
  );
  return external ? (
    <a className="fx-go" href={href}>
      {inner}
    </a>
  ) : (
    <Link className="fx-go" href={href}>
      {inner}
    </Link>
  );
}

function Photo({ name, w, alt, lazy = true }) {
  /* Each picture has a half-size file; the invoice's is 560 wide. */
  const half = name === 'books-invoice' ? 560 : w / 2;
  return (
    <img
      src={`/people/${name}-${w}.webp`}
      srcSet={`/people/${name}-${half}.webp ${half}w, /people/${name}-${w}.webp ${w}w`}
      sizes="(max-width: 900px) 100vw, 600px"
      alt={alt}
      loading={lazy ? 'lazy' : undefined}
      decoding="async"
    />
  );
}

function Finder() {
  const [q, setQ] = useState('');
  const hits = useMemo(() => find(q), [q]);
  const id = useId();
  return (
    <section className="fx-find" aria-label="Search CLOR">
      <div className="wrap fx-find-in">
        <form
          className="fx-find-box"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (hits[0]) window.location.assign(hits[0].href);
          }}
        >
          <label className="sr-only" htmlFor={id}>
            Search CLOR
          </label>
          <input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search CLOR: try GSTR-1, payslip or biometric" autoComplete="off" />
          <button type="submit" aria-label="Search">
            <MagnifyingGlass size={20} />
          </button>
          {q.trim() ? (
            <ul className="fx-find-hits">
              {hits.length ? (
                hits.map((h) => (
                  <li key={h.href}>
                    <Link href={h.href}>
                      <span className="fx-find-name">{h.name}</span>
                      <span className="fx-find-line">{h.line}</span>
                    </Link>
                  </li>
                ))
              ) : (
                <li className="fx-find-none">
                  Nothing by that name. <Link href="/contact">Ask us</Link>
                </li>
              )}
            </ul>
          ) : null}
        </form>
        <ul className="fx-asks">
          {ASKS.map(([text, href]) => (
            <li key={href}>
              <Link href={href}>{text}</Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Solutions() {
  const [tab, setTab] = useState(SOLUTIONS[0].key);
  const [open, setOpen] = useState(0);
  const s = SOLUTIONS.find((x) => x.key === tab);
  const pick = (k) => {
    setTab(k);
    setOpen(0);
  };
  return (
    <section className="fx-band" id="solutions" aria-labelledby="solutions-title">
      <div className="wrap">
        <p className="fx-eyebrow">Solutions</p>
        <h2 className="fx-h" id="solutions-title">
          Find the way CLOR fits your work
        </h2>
        <Tabs label="Who you are" id="sol" tabs={SOLUTIONS.map((x) => [x.key, x.tab])} current={tab} pick={pick} />
        <div className="fx-sol" role="tabpanel" id="sol-panel" aria-labelledby={`sol-tab-${tab}`}>
          <div className="fx-acc">
            {s.items.map(([title, text], i) => (
              <div key={title} className={`fx-acc-item${open === i ? ' is-open' : ''}`}>
                <h3>
                  <button type="button" aria-expanded={open === i} onClick={() => setOpen(i)}>
                    {title}
                    <CaretDown size={14} weight="bold" aria-hidden="true" />
                  </button>
                </h3>
                {open === i ? (
                  <div className="fx-acc-body">
                    <p>{text}</p>
                    <Link className="fx-under" href={s.link[0]}>
                      {s.link[1]}
                    </Link>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <figure className="fx-frame" key={s.key}>
            <Photo name={s.img[0]} w={s.img[1]} alt={s.img[2]} />
          </figure>
        </div>
        <Go href="/solutions/businesses">See all solutions</Go>
      </div>
    </section>
  );
}

const CATS = [
  ['all', 'Featured'],
  ['Finance', 'Finance'],
  ['HR', 'HR'],
  ['Operations', 'Operations'],
];

/* What each product is asked for most, in two or three words each: every one is in its line or on its page. */
const DOES = {
  books: ['GST invoices', 'GSTR-1 and 3B', 'Tally import'],
  payroll: ['PF, ESI, PT, TDS', 'Payslips', 'Form 16'],
  people: ['Employee records', 'Documents', 'Onboarding'],
  attendance: ['Biometric readers', 'Phone punch', 'Shifts'],
  projects: ['Tasks', 'Project cost'],
  timesheet: ['Time by project', 'Approved and billed'],
};

function ProductCard({ p, feature }) {
  return (
    <li className={`fx-pcard${feature ? ' fx-pcard--feature' : ''}`} data-p={p.slug}>
      {feature ? (
        <div className="fx-pcard-shot" aria-hidden="true">
          <BooksWindow bare />
        </div>
      ) : null}
      <div className="fx-pcard-top">
        <Mark product={p} size={44} />
        <Status product={p} />
      </div>
      <h3>CLOR {p.name}</h3>
      <p>{p.line}</p>
      <ul className="fx-does">
        {(DOES[p.slug] || []).map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      <Link className={feature ? 'btn fx-btn-light' : 'fx-under'} href={`/products/${p.slug}`}>
        Explore the product
      </Link>
    </li>
  );
}

function ProductsBand() {
  const products = useProducts();
  const [cat, setCat] = useState('all');
  const list = cat === 'all' ? products : products.filter((p) => p.category === cat);
  return (
    <section className="fx-band fx-band--cool fx-deco fx-deco--br" id="products" aria-labelledby="products-title">
      <div className="wrap">
        <p className="fx-eyebrow">Products</p>
        <h2 className="fx-h" id="products-title">
          Choose the apps your company needs
        </h2>
        <Tabs label="Product group" id="prod" tabs={CATS} current={cat} pick={setCat} />
        <ul className={`fx-pgrid${cat === 'all' ? ' fx-pgrid--featured' : ''}`} role="tabpanel" id="prod-panel" aria-labelledby={`prod-tab-${cat}`}>
          {list.map((p, i) => (
            <ProductCard key={p.slug} p={p} feature={cat === 'all' && i === 0} />
          ))}
          {cat === 'all' ? (
            <li className="fx-pcard fx-pcard--brand">
              <h3>One login for every app</h3>
              <p>Books, People, Payroll and Attendance share one list of employees and one set of books.</p>
              <ul className="fx-brand-marks" aria-hidden="true">
                {['books', 'people', 'payroll', 'attendance'].map((sl) => (
                  <li key={sl}>
                    <Mark product={productBySlug(sl)} size={36} />
                  </li>
                ))}
              </ul>
              <Link className="btn fx-btn-white" href="/pricing">
                See pricing
              </Link>
            </li>
          ) : null}
        </ul>
        <Go href="/products">See all products</Go>
      </div>
    </section>
  );
}

function AppsBand() {
  const [slug, setSlug] = useState('books');
  const a = APPS.find((x) => x.slug === slug);
  const p = productBySlug(slug);
  /* The hero already shows Books' invoice, so here Books shows the GSTR-1 it feeds. */
  const Win = slug === 'books' ? GstrWindow : WINDOWS[slug];
  return (
    <section className="fx-band fx-band--mint" id="apps" aria-labelledby="apps-title">
      <div className="wrap">
        <div className="fx-center">
          <p className="fx-eyebrow">Inside each app</p>
          <h2 className="fx-h" id="apps-title">
            See the work each app does
          </h2>
        </div>
        <Tabs kind="line" label="App" id="app" tabs={APPS.map((x) => [x.slug, productBySlug(x.slug).name])} current={slug} pick={setSlug} />
        <div className="fx-app" role="tabpanel" id="app-panel" aria-labelledby={`app-tab-${slug}`} data-p={slug}>
          <div className="fx-app-copy">
            <p className="fx-app-name">
              <Mark product={p} size={28} /> CLOR&nbsp;{p.name}
            </p>
            <h3>{a.title}</h3>
            <ul className="facts-list">
              {a.lines.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <Go href={`/products/${slug}`}>More about CLOR&nbsp;{p.name}</Go>
          </div>
          <div className="fx-app-win" key={slug} aria-hidden="true">
            <Win />
          </div>
        </div>
      </div>
    </section>
  );
}

function Connected() {
  const [at, setAt] = useState(0);
  const c = CONNECTIONS[at];
  const from = productBySlug(c.from);
  const to = productBySlug(c.to);
  const Win = WINDOWS[c.to];
  const keys = CONNECTIONS.map((_, i) => String(i));
  return (
    <section className="fx-band" id="connected" aria-labelledby="connected-title">
      <div className="wrap">
        <div className="fx-headrow">
          <div>
            <p className="fx-eyebrow">How they connect</p>
            <h2 className="fx-h" id="connected-title">
              Attendance feeds payroll. Payroll posts to Books.
            </h2>
          </div>
          <Link className="btn fx-btn-line" href="/products">
            See all products
          </Link>
        </div>
        <div className="fx-story" role="tabpanel" id="con-panel" aria-labelledby={`con-tab-${at}`} data-p={c.to}>
          <div className="fx-story-copy">
            <p className="fx-story-pair">
              <Mark product={from} size={36} />
              <span className="fx-wire" aria-hidden="true" />
              <Mark product={to} size={36} />
            </p>
            <h3>
              {from.name} to {to.name}
            </h3>
            <p>{c.text}</p>
            <p className="fx-story-note">Bought together, the four products read the same employees and post to the same books, so nobody exports a spreadsheet in between.</p>
            <Link className="btn btn--primary" href={`/products/${c.to}`}>
              Explore {to.name}
            </Link>
          </div>
          <div className="fx-story-art" key={at} aria-hidden="true">
            <Win />
          </div>
        </div>
        <div className="fx-story-tabs" role="tablist" aria-label="Connection" onKeyDown={tabKeys(keys, String(at), (k) => setAt(Number(k)))}>
          {CONNECTIONS.map((x, i) => (
            <button key={x.from + x.to} type="button" role="tab" data-tab={i} id={`con-tab-${i}`} aria-selected={at === i} aria-controls="con-panel" tabIndex={at === i ? 0 : -1} onClick={() => setAt(i)}>
              <Mark product={productBySlug(x.from)} size={24} />
              <span>
                {productBySlug(x.from).name} to {productBySlug(x.to).name}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Which section of the page is on screen, for the bar of in-page links. */
function useSection(ids) {
  const [at, setAt] = useState(null);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) if (en.isIntersecting) setAt(en.target.id);
      },
      /* A section counts once it crosses a line a third of the way down the screen. */
      { rootMargin: '-34% 0px -65% 0px' },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [ids]);
  return at;
}

const SECTION_IDS = SECTIONS.map(([id]) => id);

export default function Home() {
  const here = useSection(SECTION_IDS);
  return (
    <div className="fx">
      <section className="fx-hero" aria-labelledby="hero-title">
        <div className="wrap fx-hero-in">
          <div className="fx-hero-copy">
            <p className="fx-eyebrow">CLOR. One back office.</p>
            <h1 id="hero-title">Accounts, payroll and HR for growing Indian companies.</h1>
            <p className="fx-hero-lede">
              GST accounting in CLOR Books, salaries with PF, ESI, PT and TDS in Payroll, every employee’s record in People, and punches from the gate in Attendance. One login, one list of
              employees, one set of books.
            </p>
            <div className="actions">
              <Link className="btn btn--primary btn--lg" href={SITE.demoUrl}>
                Request a demo
              </Link>
              <a className="btn fx-btn-ghost btn--lg" href={SITE.startUrl}>
                Start free trial
              </a>
            </div>
            <p className="fx-hero-note">
              No card needed. <Link href="/pricing">See pricing</Link>
            </p>
          </div>
          <div className="fx-hero-art" aria-hidden="true">
            <span className="fx-ring fx-ring--1" />
            <span className="fx-ring fx-ring--2" />
            <span className="fx-ring fx-ring--3" />
            <div className="fx-hero-win">
              <BooksWindow />
            </div>
            {/* A second thing in the picture: the payslip that the same month ends in, on a phone. */}
            <div className="fx-hero-phone" data-p="payroll">
              <p className="fx-phone-head">
                <Mark product={productBySlug('payroll')} size={22} /> Payslip, October
              </p>
              <p className="fx-phone-k">Net pay</p>
              <p className="fx-phone-v">₹26,680</p>
              <dl>
                <dt>Earnings</dt>
                <dd>₹29,400</dd>
                <dt>PF and PT</dt>
                <dd>− ₹2,720</dd>
              </dl>
              <span className="fx-phone-btn">Download PDF</span>
            </div>
          </div>
        </div>
      </section>

      <nav className="fx-secnav" aria-label="On this page">
        <div className="wrap fx-secnav-in">
          <ul>
            {SECTIONS.map(([id, name]) => (
              <li key={id}>
                <a href={`#${id}`} aria-current={here === id ? 'true' : undefined}>
                  {name}
                </a>
              </li>
            ))}
          </ul>
          <a className="btn btn--primary" href={SITE.startUrl}>
            Start free trial
          </a>
        </div>
      </nav>

      <Finder />

      <section className="fx-band fx-deco fx-deco--tr" id="highlights" aria-labelledby="highlights-title">
        <div className="wrap">
          <p className="fx-eyebrow">Highlights</p>
          <h2 className="fx-h" id="highlights-title">
            See what CLOR does in a working day
          </h2>
          <ul className="fx-cards">
            {HIGHLIGHTS.map((h) => (
              <li key={h.img} className="fx-card" data-p={h.slug}>
                <div className="fx-card-pic">
                  <Photo name={h.img} w={h.w} alt={h.alt} />
                  <span className="fx-card-tag">
                    <Mark product={productBySlug(h.slug)} size={24} /> CLOR&nbsp;{productBySlug(h.slug).name}
                  </span>
                </div>
                <div className="fx-card-body">
                  <h3>{h.title}</h3>
                  <p>{h.text}</p>
                  <Go href={h.href}>{h.go}</Go>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Solutions />
      <ProductsBand />
      <AppsBand />

      <section className="fx-night" id="data" aria-labelledby="data-title">
        <div className="wrap fx-center">
          <h2 className="fx-h" id="data-title">
            Your records stay in Google Cloud’s Mumbai region
          </h2>
          <p>
            Each company’s records are walled off from every other company on CLOR, in the database itself. Every change is written to an audit trail with a name on it, and you can export
            everything at any time.
          </p>
          <div className="actions">
            <Link className="btn fx-btn-light" href="/security">
              How CLOR keeps your data safe
            </Link>
            <Link className="btn fx-btn-ghost" href="/legal/dpa">
              Read the data processing agreement
            </Link>
          </div>
        </div>
      </section>

      <Connected />

      <SettingUp />

      <section className="fx-band fx-band--plain">
        <div className="wrap">
          <Faq items={FAQ} />
        </div>
      </section>

      <QuoteBand />

      <section className="fx-band fx-next" aria-labelledby="next-title">
        <div className="wrap">
          <h2 className="fx-h fx-center" id="next-title">
            Take the next step
          </h2>
          <div className="fx-next-grid">
            <div className="fx-next-main">
              <div className="fx-next-copy">
                <h3>Try CLOR with your own company</h3>
                <p>No card needed. Choose the products you need and add the rest later.</p>
                <a className="btn btn--primary" href={SITE.startUrl}>
                  Start free trial
                </a>
              </div>
              <div className="fx-next-pic">
                <img src="/people/projects-720.webp" srcSet="/people/projects-360.webp 360w, /people/projects-720.webp 720w" sizes="(max-width: 900px) 100vw, 560px" alt="Three colleagues planning work around a table" loading="lazy" decoding="async" />
              </div>
            </div>
            <div className="fx-next-card">
              <span className="fx-next-icon" aria-hidden="true">
                <Headset size={28} weight="duotone" />
              </span>
              <h3>See it with your own figures</h3>
              <p>Tell us what you use today for accounts, attendance and salaries, and we will show you the same month’s work in CLOR.</p>
              <Go href={SITE.demoUrl}>Request a demo</Go>
            </div>
            <div className="fx-next-card">
              <span className="fx-next-icon" aria-hidden="true">
                <BookOpenText size={28} weight="duotone" />
              </span>
              <h3>Learn at your own pace</h3>
              <p>Guides for setting up readers, the on-site connector, Tally, HR tools and sign-in.</p>
              <Go href="/resources">Read the guides</Go>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
