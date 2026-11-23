import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowSquareIn, ArrowsSplit, BookOpenText, CalendarX, CaretDown, CaretRight, CloudCheck, Fingerprint, Headset, MagnifyingGlass, Receipt, WarningCircle } from '@phosphor-icons/react';
import { Link } from '../router.jsx';
import { CONNECTIONS, NAV, PRODUCTS, SITE, productBySlug } from '../site.js';
import { useProducts } from '../catalogue.js';
import { GstrWindow, WINDOWS } from '../components/Windows.jsx';
import { SettingUp } from '../components/Sections.jsx';
import { Faq } from '../components/Blocks.jsx';
import { Mark, ProductName, Status } from '../components/Brand.jsx';

/*
 * The home page is a run of full-width bands (owner, 13 Nov 2026): a navy hero,
 * a bar of in-page links that stays at the top, a search band, then each
 * subject under a small capital label and a large quiet heading, with pill
 * tabs choosing what a band shows. Cards are white on a pale ground.
 * Every claim here is in CONTENT_CHECKLIST.md; the sentences are the ones the
 * page carried before, rearranged.
 */

const SECTIONS = [
  ['problem', 'Why CLOR'],
  ['highlights', 'Highlights'],
  ['solutions', 'Solutions'],
  ['products', 'Products'],
  ['apps', 'Inside each product'],
  ['connected', 'How they connect'],
];

const HIGHLIGHTS = [
  {
    img: 'attendance-reader',
    slug: 'attendance',
    w: 1400,
    h: 1050,
    alt: 'An employee punching in on a fingerprint reader at the office door',
    title: 'Punches from the reader at the gate',
    text: 'ZKTeco, eSSL, Hikvision and Matrix readers send punches as they happen.',
    href: '/products/attendance',
    go: 'See CLOR Attendance',
  },
  {
    img: 'payroll-payslip',
    slug: 'payroll',
    w: 1120,
    h: 1400,
    alt: 'An employee reading her October payslip on her phone',
    title: 'Payslips on the employee’s phone',
    text: 'Each payslip shows earnings, PF, ESI, professional tax and TDS, and arrives when the run is locked.',
    href: '/products/payroll',
    go: 'See CLOR Payroll',
  },
  {
    img: 'people-hr',
    slug: 'people',
    w: 1400,
    h: 788,
    alt: 'An HR manager with an employee’s record open in CLOR People',
    title: 'One record for every employee',
    text: 'Personal, job and statutory details with a dated history of every change.',
    href: '/products/people',
    go: 'See CLOR People',
  },
];

const SOLUTIONS = [
  {
    key: 'owners',
    tab: 'Business owners',
    img: ['business-workspace', 1400, 788, 'A business owner with her CLOR workspace open on a laptop'],
    link: ['/solutions/businesses', 'CLOR for businesses'],
    items: [
      ['Prepare GST returns', 'GSTR-1 and GSTR-3B are prepared from the invoices you already raised.'],
      ['Move from Tally', 'Bring your masters and opening balances across.'],
      ['Reconcile the bank', 'Match the bank statement against your books.'],
    ],
  },
  {
    key: 'firms',
    tab: 'Accountants and CA firms',
    img: ['hero-books-soft', 1400, 835, 'An accountant at his desk with the CLOR Books dashboard open'],
    link: ['/solutions/accounting-firms', 'CLOR for accounting firms'],
    items: [
      ['Your own sign-in', 'Your client invites you by email; you never use their password.'],
      ['Many clients, one sign-in', 'Switch between clients from the company menu without signing out.'],
      ['The client controls your access', 'They choose what you can see and change, and can end it at any time.'],
    ],
  },
  {
    key: 'finance',
    tab: 'Finance teams',
    img: ['books-invoice', 980, 620, 'A GST invoice open in CLOR Books on a laptop'],
    link: ['/products/books', 'CLOR Books'],
    items: [
      ['Journals post themselves', 'Invoices, bills and the pay run post their own journals.'],
      ['Approval above an amount', 'Invoices over a limit you set wait for approval before they go out.'],
      ['A second person for bank details', 'Changing salary bank details can need a second person’s approval.'],
    ],
  },
  {
    key: 'hr',
    tab: 'HR teams',
    img: ['demo-team-3d', 1120, 747, 'A team gathered around a laptop'],
    link: ['/products/people', 'CLOR People'],
    items: [
      ['Joining and leaving checklists', 'HR, IT and the manager each tick off their own tasks.'],
      ['Documents that remind you', 'You get a reminder before an ID or certificate expires.'],
      ['One record per person', 'From the offer letter to the final settlement.'],
    ],
  },
];

const APPS = [
  {
    slug: 'books',
    title: 'GST invoices, returns and books in one place.',
    lines: [
      'Raise GST invoices, e-invoices and e-way bills, and prepare GSTR-1 and GSTR-3B from what you raised.',
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
      'Leave requests from the employee app, approved by the manager, with CLOR Attendance.',
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
  ['Do I have to buy every product?', 'No. Each CLOR product works on its own. Start with the one you need and add others later; they share one sign-in and one list of employees.'],
  ['Is CLOR made for Indian companies?', 'Yes. GST, e-invoices and e-way bills, TDS, PF, ESI, professional tax and Form 16 are part of the products, not add-ons.'],
  ['Where is my data kept?', `In ${SITE.hosting}. Each company’s records are kept apart inside the database itself, not only by the application.`],
  ['Can my accountant or CA work with me?', 'Yes. Invite them from your Admin center (Access, then Invitations) with their own sign-in, choose what they can see and change, and end it at any time. An account for the firm’s own staff is planned.'],
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

/*
 * A tab panel never shrinks while the reader moves between its tabs: before a
 * switch it keeps at least the height it has, so the page below (and, for the
 * connections band, the tabs themselves) stays put under the pointer.
 */
function holdHeight(panelId) {
  const el = document.getElementById(panelId);
  if (!el) return;
  const held = parseFloat(el.style.minHeight) || 0;
  el.style.minHeight = `${Math.max(held, el.offsetHeight)}px`;
}

/** Left and right move between tabs, Home and End go to the first and last; the chosen one is the only tab stop. */
function tabKeys(keys, current, pick) {
  return (e) => {
    const at = keys.indexOf(current);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: keys.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = keys[(to + keys.length) % keys.length];
    pick(next);
    e.currentTarget.querySelector(`[data-tab="${next}"]`)?.focus();
  };
}

function Tabs({ label, tabs, current, pick: choose, id, kind = 'pills' }) {
  const keys = tabs.map((t) => t[0]);
  const pick = (k) => {
    if (k !== current) holdHeight(`${id}-panel`);
    choose(k);
  };
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

function Photo({ name, w, h, alt, lazy = true }) {
  /* Each picture has a half-size file; the invoice's is 560 wide. */
  const half = name === 'books-invoice' ? 560 : w / 2;
  return (
    <img
      src={`/people/${name}-${w}.webp`}
      srcSet={`/people/${name}-${half}.webp ${half}w, /people/${name}-${w}.webp ${w}w`}
      sizes="(max-width: 900px) 100vw, 600px"
      width={w}
      height={h}
      alt={alt}
      loading={lazy ? 'lazy' : undefined}
      decoding="async"
    />
  );
}

/*
 * The search box: results drop below it while it has words and focus. Escape,
 * a click outside or Tab past it closes them; Down moves into the results and
 * Up and Down move between them. The count is read out once typing pauses.
 */
function Finder() {
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(false);
  const [said, setSaid] = useState('');
  const hits = useMemo(() => find(q), [q]);
  const id = useId();
  const box = useRef(null);
  const input = useRef(null);
  const open = shown && Boolean(q.trim());
  useEffect(() => {
    const words = q.trim() ? (hits.length ? `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}` : 'No matches') : '';
    const t = setTimeout(() => setSaid(words), 500);
    return () => clearTimeout(t);
  }, [q, hits]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => box.current && !box.current.contains(e.target) && setShown(false);
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const links = () => [...(box.current?.querySelectorAll('.fx-find-hits a') || [])];
  const onKey = (e) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      setShown(false);
      input.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const list = links();
    if (!open || !list.length) return;
    e.preventDefault();
    const at = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') list[Math.min(at + 1, list.length - 1)].focus();
    else if (at <= 0) input.current?.focus();
    else list[at - 1].focus();
  };
  return (
    <section className="fx-find" aria-label="Search CLOR">
      <div className="wrap fx-find-in">
        <form
          ref={box}
          className="fx-find-box"
          role="search"
          onKeyDown={onKey}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setShown(false);
          }}
          onSubmit={(e) => {
            e.preventDefault();
            if (hits[0]) window.dispatchEvent(new CustomEvent('clor:navigate', { detail: hits[0].href }));
          }}
        >
          <label className="sr-only" htmlFor={id}>
            Search CLOR
          </label>
          <input
            ref={input}
            id={id}
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setShown(true);
            }}
            onFocus={() => setShown(true)}
            placeholder="Search CLOR: try GSTR-1, payslip or biometric…"
            autoComplete="off"
            aria-controls={`${id}-hits`}
            aria-expanded={open}
          />
          <button type="submit" aria-label="Search">
            <MagnifyingGlass size={20} aria-hidden="true" />
          </button>
          <p className="sr-only" aria-live="polite">
            {said}
          </p>
          {open ? (
            <ul className="fx-find-hits" id={`${id}-hits`}>
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
                  Nothing by that name. <Link href="/contact">Write to us</Link>
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
                  <button type="button" id={`sol-acc-${tab}-${i}`} aria-expanded={open === i} aria-controls={`sol-acc-${tab}-${i}-body`} onClick={() => setOpen(open === i ? -1 : i)}>
                    {title}
                    <CaretDown size={14} weight="bold" aria-hidden="true" />
                  </button>
                </h3>
                {open === i ? (
                  <div className="fx-acc-body" id={`sol-acc-${tab}-${i}-body`} role="region" aria-labelledby={`sol-acc-${tab}-${i}`}>
                    <p>{text}</p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <figure className="fx-frame" key={s.key}>
            <Photo name={s.img[0]} w={s.img[1]} h={s.img[2]} alt={s.img[3]} />
          </figure>
        </div>
        <Go href={s.link[0]}>{s.link[1]}</Go>
      </div>
    </section>
  );
}

const CATS = [
  ['all', 'All'],
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

/*
 * A product as a tall pale-blue card (owner, 24 Nov 2026): name, one line, the
 * product's own screen rising from the bottom, and an arrow in a notched corner.
 * The name is the link and its hit area covers the whole card.
 */
function ProductCard({ p }) {
  const Win = WINDOWS[p.slug];
  return (
    <li className="dx-card" data-p={p.slug}>
      <h3>
        <Link href={`/products/${p.slug}`}>
          <ProductName name={p.name} />
        </Link>
      </h3>
      <p>{p.line}</p>
      {p.status === 'available' ? null : <Status product={p} />}
      <div className={`dx-card-art${Win ? '' : ' dx-card-art--words'}`} aria-hidden={Win ? 'true' : undefined}>
        {Win ? (
          <Win bare />
        ) : (
          <ul className="dx-chips">
            {(DOES[p.slug] || []).map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </div>
      <span className="dx-card-go" aria-hidden="true">
        <ArrowRight size={24} weight="bold" />
      </span>
    </li>
  );
}

function ProductsBand() {
  const products = useProducts();
  const [cat, setCat] = useState('all');
  const list = cat === 'all' ? products : products.filter((p) => p.category === cat);
  return (
    <section className="fx-band dx-suite" id="products" aria-labelledby="products-title">
      <div className="wrap">
        <div className="dx-suite-head">
          <h2 className="dx-suite-h" id="products-title">
            Choose the products your company needs
          </h2>
          <p className="dx-suite-sub">One sign-in for every product. Add products as you need them.</p>
          <Tabs label="Product group" id="prod" tabs={CATS} current={cat} pick={setCat} />
        </div>
        <div role="tabpanel" id="prod-panel" aria-labelledby={`prod-tab-${cat}`}>
          <ul className="dx-grid">
            {list.map((p) => (
              <ProductCard key={p.slug} p={p} />
            ))}
          </ul>
        </div>
        <div className="dx-suite-foot">
          <Go href="/products">See all products</Go>
          <Go href="/pricing">See pricing</Go>
        </div>
      </div>
    </section>
  );
}

/* The hero's one field: the email goes with the visitor to the demo form, kept in this tab only, never in the address. */
function HeroLead() {
  const [email, setEmail] = useState('');
  const go = (e) => {
    e.preventDefault();
    try {
      if (email.trim()) sessionStorage.setItem('clor.demo.email', email.trim());
    } catch {
      /* Private mode: the form simply opens empty. */
    }
    window.location.assign(SITE.demoUrl);
  };
  return (
    <form className="dx-lead" onSubmit={go}>
      <label className="sr-only" htmlFor="hero-email">
        Work email
      </label>
      <input id="hero-email" type="email" name="email" autoComplete="email" spellCheck={false} placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="btn btn--primary btn--lg" type="submit">
        Request a demo
      </button>
    </form>
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
          <p className="fx-eyebrow">Inside each product</p>
          <h2 className="fx-h" id="apps-title">
            See the work each product does
          </h2>
        </div>
        <Tabs kind="line" label="Product" id="app" tabs={APPS.map((x) => [x.slug, productBySlug(x.slug).name])} current={slug} pick={setSlug} />
        <div className="fx-app" role="tabpanel" id="app-panel" aria-labelledby={`app-tab-${slug}`} data-p={slug}>
          <div className="fx-app-copy">
            <p className="fx-app-name">
              <Mark product={p} size={28} /> <ProductName name={p.name} />
            </p>
            <h3>{a.title}</h3>
            <ul className="facts-list">
              {a.lines.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <Go href={`/products/${slug}`}>See <ProductName name={p.name} /></Go>
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
  const pickAt = (i) => {
    if (i !== at) holdHeight('con-panel');
    setAt(i);
  };
  return (
    <section className="fx-band" id="connected" aria-labelledby="connected-title">
      <div className="wrap">
        <div className="fx-headrow">
          <div>
            <p className="fx-eyebrow">How they connect</p>
            <h2 className="fx-h" id="connected-title">
              Attendance feeds Payroll. Payroll posts to Books.
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
              See <ProductName name={to.name} />
            </Link>
          </div>
          <div className="fx-story-art" key={at} aria-hidden="true">
            <Win />
          </div>
        </div>
        <div className="fx-story-tabs" role="tablist" aria-label="Connection" onKeyDown={tabKeys(keys, String(at), (k) => pickAt(Number(k)))}>
          {CONNECTIONS.map((x, i) => (
            <button key={x.from + x.to} type="button" role="tab" data-tab={i} id={`con-tab-${i}`} aria-selected={at === i} aria-controls="con-panel" tabIndex={at === i ? 0 : -1} onClick={() => pickAt(i)}>
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
/* --------------------------------------------- proof and the problem (20 Nov 2026)
 * The homepage review asked for proof after the hero and a problem section before the
 * solution. CLOR has no customers to quote yet, so the proof is facts that are true today
 * (CONTENT_CHECKLIST.md: hosting, Indian rules, Tally import, readers) and no counts or
 * testimonials. The owner writes the final words; these are drafts. */
const PROOF = [
  { Icon: CloudCheck, title: 'Google Cloud, Mumbai', text: 'Each company walled off from every other, in the database itself.' },
  { Icon: Receipt, title: 'Built for Indian rules', text: 'GST, PF, ESI, professional tax and TDS, with the returns and challans.' },
  { Icon: ArrowSquareIn, title: 'Moves from Tally', text: 'Bring masters and opening balances across instead of typing them again.' },
  { Icon: Fingerprint, title: 'Works with the reader at the gate', text: 'ZKTeco, eSSL, Hikvision and Matrix readers send punches straight in.' },
];

function Proof() {
  return (
    <section className="fx-proof" aria-label="Why companies can rely on CLOR">
      <ul className="wrap fx-proof-in">
        {PROOF.map(({ Icon, title, text }) => (
          <li key={title}>
            <Icon size={26} weight="duotone" aria-hidden="true" />
            <div>
              <p className="fx-proof-t">{title}</p>
              <p className="fx-proof-d">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const PROBLEMS = [
  { Icon: CalendarX, title: 'Month end takes days', text: 'Attendance is exported from the reader, cleaned in Excel and typed into the salary sheet. Then the salaries are typed into the books.' },
  { Icon: WarningCircle, title: 'Mistakes reach the payslip', text: 'A missed punch or a wrong loss-of-pay day is found after salaries are paid, and put right by hand next month.' },
  { Icon: ArrowsSplit, title: 'Nobody has one picture', text: 'HR, accounts and the owner each keep their own list of employees, and the numbers do not agree.' },
];

function Problem() {
  return (
    <section className="fx-band fx-band--plain" id="problem" aria-labelledby="problem-title">
      <div className="wrap">
        <p className="fx-eyebrow">The problem</p>
        <h2 className="fx-h" id="problem-title">
          One employee, typed in four places
        </h2>
        <p className="fx-problem-lede">
          Most growing companies keep accounts in Tally, attendance in the reader’s software or Excel, salaries in a spreadsheet and staff files in folders. The same person and the same month
          are entered again at every step.
        </p>
        <ul className="fx-problems">
          {PROBLEMS.map(({ Icon, title, text }) => (
            <li key={title}>
              <span className="fx-problem-icon" aria-hidden="true">
                <Icon size={24} weight="duotone" />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ul>
        <p className="fx-problem-go">
          <Go href="#connected" external>See how CLOR joins them up</Go>
        </p>
      </div>
    </section>
  );
}

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
            <h1 id="hero-title">
              <strong>Accounts, payroll and HR</strong> for growing Indian companies.
            </h1>
            <p className="fx-hero-lede">
              GST accounting in CLOR Books, salaries with PF, ESI, PT and TDS in Payroll, every employee’s record in People, and punches from the gate in Attendance. One sign-in, one list of
              employees, one set of books.
            </p>
            <HeroLead />
            <p className="fx-hero-note">
              No card needed. <a href={SITE.startUrl}>Start free trial</a> <span aria-hidden="true">·</span> <Link href="/pricing">See pricing</Link>
            </p>
          </div>
          <div className="dx-hero-art" aria-hidden="true">
            <span className="dx-hero-disc" />
            <div className="dx-hero-photo">
              <Photo name="hero-3d" w={1400} h={1167} alt="" lazy={false} />
            </div>
            <p className="dx-hero-stat">
              <strong className="num">4</strong>
              <span>products on one sign-in and one list of employees</span>
            </p>
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
          <a className="btn btn--trial fx-btn-line" href={SITE.startUrl}>
            Start free trial
          </a>
        </div>
      </nav>

      <Proof />

      <Finder />

      <Problem />

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
                  <Photo name={h.img} w={h.w} h={h.h} alt={h.alt} />
                  <span className="fx-card-tag">
                    <Mark product={productBySlug(h.slug)} size={24} /> <ProductName name={productBySlug(h.slug).name} />
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

      <section className="fx-band fx-next" aria-labelledby="next-title">
        <div className="wrap">
          <h2 className="fx-h fx-center" id="next-title">
            Start with CLOR
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
                <img src="/people/projects-720.webp" srcSet="/people/projects-360.webp 454w, /people/projects-720.webp 909w" sizes="(max-width: 900px) 100vw, 560px" width="909" height="720" alt="Three colleagues planning work around a table" loading="lazy" decoding="async" />
              </div>
            </div>
            <div className="fx-next-card">
              <span className="fx-next-icon" aria-hidden="true">
                <Headset size={28} weight="duotone" />
              </span>
              <h3>See it doing work like yours</h3>
              <p>Tell us what you use today for accounts, attendance and salaries, and we will show you the same month’s work in CLOR.</p>
              <Go href={SITE.demoUrl}>Request a demo</Go>
            </div>
            <div className="fx-next-card">
              <span className="fx-next-icon" aria-hidden="true">
                <BookOpenText size={28} weight="duotone" />
              </span>
              <h3>Read the setup guides</h3>
              <p>Guides for setting up readers, the on-site connector, Tally, HR tools and sign-in.</p>
              <Go href="/resources">Read the guides</Go>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
