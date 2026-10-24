import React from 'react';
import { Link } from '../router.jsx';
import { ArrowRight, BarChart3, Check, ChevronRight, PlayCircle, TrendingUp, Users, Zap } from 'lucide-react';
import { SITE, AVAILABLE, PRODUCTS, productBySlug } from '../site.js';
import Illustration from '../components/Illustration.jsx';
import { Head, HowItWorks, TrustBand } from '../components/Sections.jsx';
import { Closing, Faq, Reveal, RevealGroup, Tabs } from '../components/Blocks.jsx';
import { Status } from '../components/Brand.jsx';

/* -------------------------------------------------------------- the words
 * Taken from the product illustrations, so the page says what the pictures
 * show, as text people can read, search and translate.
 */
const HERO_POINTS = [
  { Icon: Users, text: 'Connect your teams' },
  { Icon: Zap, text: 'Streamline operations' },
  { Icon: BarChart3, text: 'Get real-time insights' },
  { Icon: TrendingUp, text: 'Scale as your business grows' },
];

const APPS = [
  { slug: 'books', line: 'Invoicing, bills, GST and a double-entry ledger.' },
  { slug: 'people', line: 'HR, employee records, leave and performance.' },
  { slug: 'payroll', line: 'Salaries, statutory deductions, payslips and compliance.' },
  { slug: 'attendance', line: 'Biometric machines, shifts, leave and payable days.' },
  { slug: 'projects', line: 'Plan work, track tasks and manage project costs.' },
];

const CONNECTED = [
  { slug: 'people', items: ['Employee records', 'Leave & attendance', 'Recruitment', 'Performance'] },
  { slug: 'attendance', items: ['Biometric devices', 'Shifts & leave', 'Real-time tracking', 'Reports'] },
  { slug: 'payroll', items: ['Salaries', 'Statutory compliance', 'Payslips', 'TDS & reports'] },
  { slug: 'books', items: ['Invoices', 'Bills', 'GST', 'Reports'] },
];

const TEAMS = [
  {
    key: 'business',
    label: 'Businesses',
    points: ['Manage your entire business in one place', 'Improve productivity and control', 'Stay compliant with ease', 'Scale as you grow'],
    link: '/solutions/businesses',
  },
  {
    key: 'firms',
    label: 'Accounting firms',
    points: ['Work in your clients’ books, with their permission', 'Switch between clients without signing out', 'The client decides what you can see and change', 'GST and TDS from the client’s own documents'],
    link: '/solutions/accounting-firms',
  },
  {
    key: 'hr',
    label: 'HR Teams',
    points: ['Onboarding and exit checklists everyone can see', 'Leave, corrections and approvals from the employee app', 'Documents with expiry reminders', 'One record per person, from joining to final settlement'],
    link: '/products/people',
  },
  {
    key: 'finance',
    label: 'Finance Teams',
    points: ['Invoices, bills and payroll post their own journals', 'GST, TDS and bank reconciliation from the same records', 'Approvals above an amount', 'A second person for bank changes'],
    link: '/products/books',
  },
];

const FAQ = [
  ['Do I have to buy every product?', 'No. Each Clor product can be used on its own. Choose the ones you need and add others later; they share one workspace and one sign-in.'],
  ['Is Clor built for Indian businesses?', 'Yes. GST, e-invoices and e-way bills, TDS, PF, ESI, professional tax and Form 16 are part of the products, not add-ons.'],
  ['Where is my data kept?', `In ${SITE.hosting}. Each company’s records are kept apart inside the database itself, not only by the application.`],
  ['Can my accountant or CA work with me?', 'Yes. Invite them with their own login and choose what they can see and change.'],
  ['Can I leave with my data?', 'Yes. You can export your company’s data at any time, and closing a company comes with a notice period.'],
];

/* Only counts that are true today; they come from the product list, not from marketing. */
const FIGURES = [
  [String(AVAILABLE.length), 'apps ready today'],
  [String(PRODUCTS.length - AVAILABLE.length), 'more on the way'],
  ['1', 'sign-in for every app'],
  ['Mumbai', 'where your data is kept'],
];

export default function Home() {
  return (
    <>
      {/* ------------------------------------------------------------ hero */}
      <section className="hero hero--home" aria-labelledby="hero-title">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <p className="eyebrow hero-in" style={{ '--d': 0 }}>
              Your business. One workspace.
            </p>
            {/* Words arrive once, in turn (CSS only; reduced motion shows them at once). */}
            <h1 id="hero-title" className="h-hero hero-title">
              {['Every', 'part', 'of', 'your', 'business,', 'working', 'in'].map((w, n) => (
                <React.Fragment key={n}>
                  <span className="wm">
                    <span className="w" style={{ '--n': n }}>
                      {w}
                    </span>
                  </span>{' '}
                </React.Fragment>
              ))}
              <span className="wm">
                <span className="w accent-word" style={{ '--n': 7 }}>
                  harmony.
                </span>
              </span>
            </h1>
            <p className="lede hero-in" style={{ '--d': 1 }}>
              Connect your teams, streamline operations and grow — all in one place. Built for modern businesses.
            </p>
            <div className="actions hero-in" style={{ '--d': 2 }}>
              <a className="btn btn--primary btn--lg" href={SITE.signUpUrl}>
                Get started <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
              </a>
              <a className="btn btn--play" href="#how-it-works">
                <PlayCircle size={22} strokeWidth={1.75} aria-hidden="true" /> See how it works
              </a>
            </div>
            <ul className="hero-points hero-in" style={{ '--d': 3 }}>
              {HERO_POINTS.map(({ Icon, text }) => (
                <li key={text}>
                  <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
          <Illustration
            className="hero-art"
            src="/illustrations/hero-workspace.webp"
            width={1400}
            height={787}
            priority
            alt="The Clor workspace on a laptop and a phone, with Books, People, Payroll, Attendance, Projects and Timesheet connected to it."
          />
        </div>
      </section>

      {/* ------------------------------------------------------------ apps */}
      <section className="section" aria-labelledby="apps-title">
        <div className="wrap">
          <Head center id="apps-title" eyebrow="One workspace. Many possibilities." title="An app for every part of your business" intro="Use one, or use them together. They share your people, your books and one sign-in." />
          <RevealGroup as="ul" className="app-cards">
            {APPS.map(({ slug, line }, i) => {
              const p = productBySlug(slug);
              return (
                <li key={slug} className={`app-card app-card--${slug}`} style={{ '--i': i }}>
                  <Link href={`/products/${slug}`} className="app-card-link">
                    <img className="app-card-icon" src={`/illustrations/app-${slug}-icon.webp`} width={344} height={180} alt="" loading="lazy" decoding="async" />
                    <span className="app-card-name">
                      {p.name} {p.status === 'soon' ? <Status product={p} /> : null}
                    </span>
                    <span className="app-card-line">{line}</span>
                    <img className="app-card-ui" src={`/illustrations/app-${slug}-ui.webp`} width={310} height={385} alt="" loading="lazy" decoding="async" />
                    <span className="app-card-go">
                      More about {p.name} <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </RevealGroup>
        </div>
      </section>

      {/* ------------------------------------------------------- connected */}
      <section className="section section--tint" aria-labelledby="connected-title">
        <div className="wrap">
          <Head
            center
            id="connected-title"
            eyebrow="Better together"
            title="Connected applications. Seamless workflows."
            intro="From attendance to payroll to accounting — information flows securely across your Clor workspace."
          />
          <Reveal className="connect-stage">
            <Illustration
              className="connect-art"
              src="/illustrations/connected-apps.webp"
              width={1400}
              height={933}
              alt="People, Attendance, Payroll and Books joined at Clor."
            />
          </Reveal>
          <RevealGroup as="ul" className="connect-lists">
            {CONNECTED.map(({ slug, items }, i) => {
              const p = productBySlug(slug);
              return (
                <li key={slug} className={`connect-list connect-list--${slug}`} style={{ '--i': i }}>
                  <h3 className="h-3">{p.name}</h3>
                  <ul>
                    {items.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </RevealGroup>
        </div>
      </section>

      <HowItWorks />

      {/* ------------------------------------------------ built for your team */}
      <section className="section section--tint" aria-labelledby="team-title">
        <div className="wrap teams-split">
          <div className="stack teams-copy">
            <Head id="team-title" eyebrow="Built for your team" title="A smarter way to manage businesses, teams and compliance." />
            <Tabs
              label="Who Clor is for"
              tabs={TEAMS.map((t) => ({
                key: t.key,
                label: t.label,
                body: (
                  <div className="stack team-panel">
                    <ul className="checks">
                      {t.points.map((x) => (
                        <li key={x}>
                          <span className="check" aria-hidden="true">
                            <Check size={14} strokeWidth={3} />
                          </span>
                          {x}
                        </li>
                      ))}
                    </ul>
                    <Link className="btn btn--primary btn--lg" href={t.link}>
                      Explore solutions <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
                    </Link>
                  </div>
                ),
              }))}
            />
          </div>
          <Reveal className="teams-art-wrap">
            <Illustration className="teams-art" src="/illustrations/team.webp" width={1000} height={772} alt="" />
          </Reveal>
        </div>
      </section>

      <TrustBand />

      {/* ------------------------------------------------------ every device */}
      <section className="section section--tint" aria-labelledby="devices-title">
        <div className="wrap split devices">
          <Head id="devices-title" eyebrow="Anywhere you work" title="On every device you work on" intro="In the browser on any computer, and in the Clor apps on your phone. Sign in once; your companies and apps follow you." />
          <Reveal className="devices-art-wrap">
            <Illustration className="devices-art" src="/illustrations/devices.webp" width={1300} height={815} alt="A laptop, a phone and a tablet, each showing Clor, connected to the same workspace." />
          </Reveal>
        </div>
      </section>

      {/* ----------------------------------------------------------- figures */}
      <section className="section figures-band">
        <div className="wrap">
          <Head center title="Built in India, for Indian businesses." />
          <dl className="figures">
            {FIGURES.map(([n, label]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{n}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="section section--tint">
        <div className="wrap">
          <Faq items={FAQ} />
        </div>
      </section>

      <Closing title="Start with one app. Add the rest when you need them." text="Create your workspace, choose the apps you need and invite your team.">
        Each app has its own subscription; prices are being finalised. <Link href="/pricing">How pricing works</Link>
      </Closing>
    </>
  );
}
