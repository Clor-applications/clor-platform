import React from 'react';
import { Link } from '../router.jsx';
import { ChevronRight, Building2, History, KeyRound, MapPin } from 'lucide-react';
import { SITE, AVAILABLE, PRODUCTS, productBySlug } from '../site.js';
import Connection from '../components/Connection.jsx';
import { Closing, Faq, Reveal, SectionHead, Steps, Tabs } from '../components/Blocks.jsx';
import { BooksWindow, PayrollWindow, PeopleWindow, AttendanceWindow } from '../components/Windows.jsx';
import { Mark, Status } from '../components/Brand.jsx';

const SHOWCASE = [
  { slug: 'books', W: BooksWindow, title: 'Invoices that post themselves', text: 'Every invoice, bill and receipt writes its own journal. GST returns come from the documents you already raised.' },
  { slug: 'people', W: PeopleWindow, title: 'One record for each person', text: 'Details, documents and history in one place — and the same record on the reader, in the pay run and in the employee app.' },
  { slug: 'attendance', W: AttendanceWindow, title: 'Punches turned into paid days', text: 'Readers and phones send punches as they happen; shifts and rules mark each day; the month closes into payroll.' },
  { slug: 'payroll', W: PayrollWindow, title: 'A pay run that reaches the ledger', text: 'Statutory deductions worked out, payslips on every phone, and the journal posted to Books when you lock the run.' },
];

const TEAMS = [
  {
    key: 'owners',
    label: 'Business owners',
    title: 'See the business, not the paperwork.',
    points: ['Sales, purchases and cash by branch, as they happen.', 'Payroll cost and headcount without asking HR for a sheet.', 'Decide who sees what — down to a customer or a branch.'],
    products: ['books', 'payroll'],
  },
  {
    key: 'hr',
    label: 'HR teams',
    title: 'From joining to final settlement, in one place.',
    points: ['Onboarding and exit checklists everyone can see.', 'Leave, corrections and approvals from the employee app.', 'Documents with expiry reminders and the right people able to open them.'],
    products: ['people', 'attendance'],
  },
  {
    key: 'finance',
    label: 'Finance',
    title: 'Books that close because the numbers already agree.',
    points: ['Invoices, bills and payroll post their own journals.', 'GST, TDS and bank reconciliation from the same records.', 'Approvals above an amount, and a second person for bank changes.'],
    products: ['books', 'payroll'],
  },
  {
    key: 'firms',
    label: 'Accounting firms',
    title: 'Work in your clients’ books, with their permission.',
    points: ['Each client invites you with your own login.', 'Switch between clients without signing out.', 'The client decides what you can see and change.'],
    products: ['books'],
    link: '/solutions/accounting-firms',
  },
];

const STEPS = [
  ['Create your workspace', 'Sign up with your email and add your company: name, state and GSTIN if you have one.'],
  ['Choose your apps', 'Switch on the products you need. Each one works on its own; together they share your people and your books.'],
  ['Invite your team', 'Add the people who will work in Clor and give each a role. Employees join through the employee app.'],
  ['Bring your data', 'Import customers, items, employees and opening balances from spreadsheets or Tally.'],
];

const FAQ = [
  ['Do I have to buy every product?', 'No. Each Clor product can be used on its own. Choose the ones you need and add others later; they share one workspace and one sign-in.'],
  ['Is Clor built for Indian businesses?', 'Yes. GST, e-invoices and e-way bills, TDS, PF, ESI, professional tax and Form 16 are part of the products, not add-ons.'],
  ['Where is my data kept?', `In ${SITE.hosting}. Each company’s records are kept apart inside the database itself, not only by the application.`],
  ['Can my accountant or CA work with me?', 'Yes. Invite them with their own login and choose what they can see and change.'],
  ['Can I leave with my data?', 'Yes. You can export your company’s data at any time, and closing a company comes with a notice period.'],
];

const VALUES = [
  { Icon: Building2, title: 'Each company apart', text: 'The database itself refuses to show one company’s records to another.' },
  { Icon: KeyRound, title: 'Sign-in you control', text: 'Authenticator apps, single sign-on and a code again before the most sensitive actions.' },
  { Icon: History, title: 'Everything recorded', text: 'Who changed what, and when, in an audit trail you can read in plain words.' },
  { Icon: MapPin, title: 'Hosted in India', text: `${SITE.hosting}.` },
];

/* Only counts that are true today; they come from the product list, not from marketing. */
const FIGURES = [
  [String(AVAILABLE.length), 'apps ready today'],
  [String(PRODUCTS.length - AVAILABLE.length), 'more on the way'],
  ['1', 'sign-in for every app'],
  ['Mumbai', 'where your data is kept'],
];

/** The catalogue beside the headline: every app, what it does, and whether it is ready. */
function AppsPanel() {
  return (
    <aside className="apps-panel" aria-labelledby="apps-panel-title">
      <p id="apps-panel-title" className="apps-panel-title">
        Clor apps
      </p>
      <ul className="apps-grid">
        {PRODUCTS.map((p) => (
          <li key={p.slug}>
            <Link href={`/products/${p.slug}`} className="app-tile">
              <Mark product={p} size={36} />
              <span className="app-tile-text">
                <span className="app-tile-name">{p.name}</span>
                <span className="app-tile-line">{p.line}</span>
                {p.status === 'soon' ? <Status product={p} /> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/products" className="apps-panel-all">
        See all products <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
      </Link>
    </aside>
  );
}

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            {/* Words arrive once, in turn, from the first paint (CSS only, so nothing flickers; reduced motion shows them at once). */}
            <h1 className="h-hero hero-title">
              {'Your books, people and payroll, on the same records.'.split(' ').map((w, n) => (
                <React.Fragment key={n}>
                  <span className="wm">
                    <span className="w" style={{ '--n': n }}>
                      {w}
                    </span>
                  </span>{' '}
                </React.Fragment>
              ))}
            </h1>
            <div className="hero-side">
              <span className="rule" aria-hidden="true" />
              <p className="lede">Business apps for Indian companies: accounting, HR, payroll and attendance. Use one, or use them together on one workspace and one sign-in.</p>
              <div className="actions">
                <a className="btn btn--primary" href={SITE.signUpUrl}>
                  Get started
                </a>
                <Link className="btn btn--quiet" href="/contact">
                  Talk to us
                </Link>
              </div>
            </div>
          </div>
          <AppsPanel />
        </div>
      </section>

      <section className="section section--tint">
        <div className="wrap">
          <SectionHead center title="One workspace. Every app on the same records." intro="People gives Attendance its people, the closed month goes to Payroll, and the pay run posts to Books. Nothing is typed twice." />
          <Connection />
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <SectionHead center title="What each one does" />
          <div className="showcase">
            {SHOWCASE.map(({ slug, W, title, text }, n) => {
              const p = productBySlug(slug);
              return (
                <article key={slug} className={`show-row${n % 2 ? ' show-row--flip' : ''}`}>
                  <div className="show-copy stack">
                    <p className="show-product">
                      <Mark product={p} size={28} /> Clor {p.name}
                    </p>
                    <h3 className="h-2">{title}</h3>
                    <p className="body">{text}</p>
                    <Link className="btn btn--text" href={`/products/${slug}`}>
                      More about {p.name}
                    </Link>
                  </div>
                  <Reveal className="show-shot">
                    <W />
                  </Reveal>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section section--tint">
        <div className="wrap">
          <SectionHead center title="Built for the people who run the business" />
          <Tabs
            label="Who Clor is for"
            tabs={TEAMS.map((t) => ({
              key: t.key,
              label: t.label,
              body: (
                <div className="team">
                  <div className="stack">
                    <h3 className="h-2">{t.title}</h3>
                    <ul className="ticks">
                      {t.points.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                    {t.link ? (
                      <Link className="btn btn--text" href={t.link}>
                        Clor for accounting firms
                      </Link>
                    ) : null}
                  </div>
                  <div className="team-products">
                    {t.products.map((s) => {
                      const p = productBySlug(s);
                      return (
                        <Link key={s} href={`/products/${s}`} className="team-product">
                          <Mark product={p} size={32} />
                          <span>
                            <strong>Clor {p.name}</strong>
                            <span className="small">{p.line}</span>
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ),
            }))}
          />
        </div>
      </section>

      <section className="section">
        <div className="wrap split">
          <SectionHead title="How you start" intro="Four steps, each done in the app yourself." />
          <Steps steps={STEPS} />
        </div>
      </section>

      <section className="section section--tint">
        <div className="wrap access">
          <SectionHead title="One place to decide who can do what" intro="Companies, branches, people and their roles live in the workspace, not in each app. Give someone access once; take it away once." />
          <div className="access-map" aria-label="How access is organised">
            <div className="access-level">
              <p className="access-k">Workspace</p>
              <p className="access-v">Anand Group</p>
            </div>
            <div className="access-children">
              {['Anand Traders, Pune', 'Anand Exports, Mumbai'].map((co, n) => (
                <div key={co} className="access-level access-level--co">
                  <p className="access-k">Company</p>
                  <p className="access-v">{co}</p>
                  <ul className="access-people">
                    {(n === 0
                      ? [['Rohit', 'Owner'], ['Kavya', 'Accounts, Pune branch'], ['Your CA', 'Books, read and post']]
                      : [['Rohit', 'Owner'], ['Meera', 'HR and payroll']]
                    ).map(([who, role]) => (
                      <li key={who}>
                        <span>{who}</span>
                        <span className="small">{role}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <SectionHead center title="Kept safe, kept apart" />
          <ul className="values">
            {VALUES.map(({ Icon, title, text }) => (
              <li key={title}>
                <Icon className="values-icon" size={28} strokeWidth={1.5} aria-hidden="true" />
                <div>
                  <h3 className="h-3">{title}</h3>
                  <p className="body">{text}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="center-link">
            <Link className="btn btn--quiet" href="/security">
              How Clor keeps your data safe
            </Link>
          </p>
        </div>
      </section>

      <section className="section figures-band">
        <div className="wrap">
          <SectionHead center title="Built in India, for Indian businesses." />
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
