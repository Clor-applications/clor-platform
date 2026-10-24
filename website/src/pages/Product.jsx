import React from 'react';
import { Link } from '../router.jsx';
import {
  ArrowRight,
  BarChart3,
  Bell,
  CalendarDays,
  Clock,
  Database,
  FileText,
  Fingerprint,
  MapPin,
  Receipt,
  ShieldCheck,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import { CONNECTIONS, PRODUCTS, SITE, productBySlug } from '../site.js';
import { PRODUCT_CONTENT } from '../content.js';
import { Mark, Status } from '../components/Brand.jsx';
import { Closing, Faq, Reveal, RevealGroup, SectionHead, Steps } from '../components/Blocks.jsx';
import Illustration from '../components/Illustration.jsx';
import { Head, HowItWorks, TrustBand } from '../components/Sections.jsx';

/*
 * Each app's page: its own illustration (the icon tile and its screen, from
 * the product artwork), what it covers, what it fixes, what is in it, a
 * working day in it, and how it joins the other apps. "Start with …" carries
 * the app into sign-up (?app=), so a new workspace opens straight into it.
 */

/** The app id inside app.clor.in, where it differs from the site's slug. */
const APP_ID = { books: 'accounting' };
const signUpFor = (slug) => `${SITE.signUpUrl}?app=${APP_ID[slug] || slug}`;

/** What each app covers, as the connected-apps artwork names it. */
const COVERS = {
  books: [
    [FileText, 'Invoices'],
    [Receipt, 'Bills'],
    [Database, 'GST'],
    [BarChart3, 'Reports'],
  ],
  people: [
    [UserRound, 'Employee records'],
    [CalendarDays, 'Leave & attendance'],
    [Users, 'Recruitment'],
    [BarChart3, 'Performance'],
  ],
  payroll: [
    [Wallet, 'Salaries'],
    [ShieldCheck, 'Statutory compliance'],
    [FileText, 'Payslips'],
    [BarChart3, 'TDS & reports'],
  ],
  attendance: [
    [Fingerprint, 'Biometric devices'],
    [Clock, 'Shifts & leave'],
    [MapPin, 'Real-time tracking'],
    [BarChart3, 'Reports'],
  ],
  projects: [
    [CalendarDays, 'Plans and milestones'],
    [FileText, 'Tasks'],
    [Clock, 'Time against work'],
    [BarChart3, 'Project costs'],
  ],
};

/** The app's artwork: its icon tile over its screen, on the app's own tint. Timesheet has none yet. */
function ProductArt({ slug, name }) {
  if (!COVERS[slug]) {
    return (
      <div className={`p-art p-art--plain p-art--${slug}`} aria-hidden="true">
        <Clock size={72} strokeWidth={1.25} />
      </div>
    );
  }
  return (
    <div className={`p-art p-art--${slug}`}>
      <img className="p-art-icon" src={`/illustrations/app-${slug}-icon.webp`} width={344} height={180} alt="" decoding="async" fetchPriority="high" />
      <img className="p-art-ui" src={`/illustrations/app-${slug}-ui.webp`} width={310} height={385} alt={`A screen from Clor ${name}.`} decoding="async" fetchPriority="high" />
    </div>
  );
}

function Hero({ p, c, soon }) {
  return (
    <section className={`hero p-hero p-hero--${p.slug}`} aria-labelledby="p-title">
      <div className="wrap p-hero-grid">
        <div className="p-hero-copy">
          <p className="eyebrow hero-in" style={{ '--d': 0 }}>
            Clor {p.name} {soon ? <Status product={p} /> : null}
          </p>
          <h1 id="p-title" className="h-hero p-title hero-in" style={{ '--d': 0 }}>
            {c.title}
          </h1>
          <p className="lede hero-in" style={{ '--d': 1 }}>
            {c.intro}
          </p>
          <div className="actions hero-in" style={{ '--d': 2 }}>
            {soon ? (
              <Link className="btn btn--primary btn--lg" href={`/contact?about=${p.slug}`}>
                Notify me <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
              </Link>
            ) : (
              <a className="btn btn--primary btn--lg" href={signUpFor(p.slug)}>
                Start with {p.name} <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
              </a>
            )}
            <Link className="btn btn--quiet btn--lg" href={soon ? '/products' : '/contact'}>
              {soon ? 'See what’s available now' : 'Talk to us'}
            </Link>
          </div>
          {COVERS[p.slug] ? (
            <ul className="p-covers hero-in" style={{ '--d': 3 }} aria-label={`What ${p.name} covers`}>
              {COVERS[p.slug].map(([Icon, label]) => (
                <li key={label}>
                  <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="p-hero-art">
          <ProductArt slug={p.slug} name={p.name} />
        </div>
      </div>
    </section>
  );
}

function SoonPage({ p, c }) {
  return (
    <>
      <Hero p={p} c={c} soon />
      <section className="section">
        <div className="wrap">
          <Head eyebrow="On the way" title="What we are building" intro="Plans, not promises: this is the direction, and it may change before release." />
          <RevealGroup as="ul" className="p-cards p-cards--plain">
            {c.planned.map((x, i) => (
              <li key={x} className="p-card" style={{ '--i': i }}>
                <span className="p-card-dot" aria-hidden="true" />
                <h3 className="h-3">{x}</h3>
              </li>
            ))}
          </RevealGroup>
        </div>
      </section>
      <Closing title="Use the apps that are ready today." text="Books, People, Payroll and Attendance share one workspace; Projects joins them when it is ready.">
        <Link href="/products">See every product</Link>
      </Closing>
    </>
  );
}

export default function Product({ slug }) {
  const p = productBySlug(slug);
  const c = PRODUCT_CONTENT[slug];
  if (p.status !== 'available') return <SoonPage p={p} c={c} />;
  const links = CONNECTIONS.filter((x) => x.from === slug || x.to === slug);
  return (
    <>
      <Hero p={p} c={c} />

      <section className="section" aria-labelledby="fixes-title">
        <div className="wrap">
          <Head id="fixes-title" eyebrow={`Why ${p.name}`} title="What it fixes" />
          <RevealGroup as="ul" className="p-cards">
            {c.problems.map(([prob, fix], i) => (
              <li key={prob} className="p-card" style={{ '--i': i }}>
                <h3 className="h-3">{prob}</h3>
                <p className="body">{fix}</p>
              </li>
            ))}
          </RevealGroup>
        </div>
      </section>

      <section className="section section--tint" aria-labelledby="inside-title">
        <div className="wrap">
          <Head center id="inside-title" eyebrow="Inside the app" title={`What’s in ${p.name}`} />
          <RevealGroup as="dl" className={`p-features p-features--${slug}`}>
            {c.features.map(([k, v], i) => (
              <div key={k} className="p-feature" style={{ '--i': i }}>
                <dt className="h-3">{k}</dt>
                <dd className="body">{v}</dd>
              </div>
            ))}
          </RevealGroup>
        </div>
      </section>

      <section className="section" aria-labelledby="flow-title">
        <div className="wrap split">
          <Head id="flow-title" eyebrow="A day in it" title={c.workflow.title} />
          <Steps steps={c.workflow.steps} />
        </div>
      </section>

      {links.length ? (
        <section className="section section--tint" aria-labelledby="links-title">
          <div className="wrap">
            <Head
              center
              id="links-title"
              eyebrow="Better together"
              title={`${p.name} and the other Clor apps`}
              intro={`${p.name} works on its own. When you use the others too, these links work for you.`}
            />
            <Reveal className="connect-stage">
              <Illustration className="connect-art" src="/illustrations/connected-apps.webp" width={1400} height={933} alt="People, Attendance, Payroll and Books joined at Clor." />
            </Reveal>
            <RevealGroup as="ul" className="p-links">
              {links.map((x, i) => {
                const other = productBySlug(x.from === slug ? x.to : x.from);
                return (
                  <li key={x.from + x.to} className="p-link" style={{ '--i': i }}>
                    <span className="links-pair">
                      <Mark product={productBySlug(x.from)} size={26} />
                      <span className="links-wire" aria-hidden="true" />
                      <Mark product={productBySlug(x.to)} size={26} />
                    </span>
                    <p className="body">{x.text}</p>
                    <Link className="btn btn--text" href={`/products/${other.slug}`}>
                      Clor {other.name} <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </RevealGroup>
          </div>
        </section>
      ) : null}

      <HowItWorks />

      <section className="section section--tint" aria-labelledby="roles-title">
        <div className="wrap split">
          <Head id="roles-title" eyebrow="Access" title="Who sees what" />
          <div className="p-roles">
            <Bell size={22} strokeWidth={1.75} aria-hidden="true" />
            <p className="lede">{c.roles}</p>
          </div>
        </div>
      </section>

      <TrustBand />

      <section className="section section--tint">
        <div className="wrap">
          <Faq items={c.faq} />
        </div>
      </section>

      <Closing title={`Try ${p.name} with your own data.`} text="Create a workspace, switch on the app and invite the people who will use it.">
        <a href={signUpFor(slug)}>Start with {p.name}</a>
      </Closing>
    </>
  );
}

export function Products() {
  return (
    <>
      <section className="hero hero--product">
        <div className="wrap products-hero">
          <div className="stack" style={{ '--stack': '1.25rem' }}>
            <h1 className="h-1">The Clor products</h1>
            <p className="lede">Each one does a job on its own. Together they share one workspace, one sign-in, one list of people and one set of books.</p>
          </div>
          <Illustration className="products-hero-art" src="/illustrations/products-hero.webp" width={1240} height={668} priority alt="A Clor dashboard on a laptop and the Clor app on a phone." />
        </div>
      </section>
      <section className="section section--flush">
        <div className="wrap">
          {['Finance', 'HR', 'Operations'].map((cat) => (
            <div key={cat} className="cat">
              <h2 className="h-2">{cat}</h2>
              <div className="cat-list">
                {PRODUCTS.filter((p) => p.category === cat).map((p) => (
                  <Link key={p.slug} href={`/products/${p.slug}`} className="cat-item">
                    <Mark product={p} size={44} />
                    <span className="stack" style={{ '--stack': '0.4rem' }}>
                      <span className="cat-name">
                        Clor {p.name} <Status product={p} />
                      </span>
                      <span className="body">{p.line}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="section section--tint">
        <div className="wrap split">
          <SectionHead title="Better together, never required" intro="Links between products appear only when you have both. Nothing in one product stops working without another." />
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
      <Closing />
    </>
  );
}

