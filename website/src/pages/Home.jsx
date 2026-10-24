import React from 'react';
import { Link } from '../router.jsx';
import { SITE, AVAILABLE, productBySlug } from '../site.js';
import Connection from '../components/Connection.jsx';
import { Closing, Faq, ProductIndex, Reveal, SectionHead, Tabs } from '../components/Blocks.jsx';
import { BooksWindow, PayrollWindow, PeopleWindow, AttendanceWindow } from '../components/Windows.jsx';
import { Mark } from '../components/Brand.jsx';

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

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <h1 className="h-hero">Your books, people and payroll, on the same records.</h1>
          <div className="hero-side">
            <p className="lede">
              Clor is a family of business apps for Indian companies: accounting, HR, payroll and attendance. Use one, or use them together. They share one workspace, one sign-in and one set of people.
            </p>
            <div className="actions">
              <a className="btn btn--primary" href={SITE.signUpUrl}>
                Get started
              </a>
              <Link className="btn btn--quiet" href="/products">
                See the products
              </Link>
            </div>
            <ul className="hero-apps" aria-label="Products available today">
              {AVAILABLE.map((p) => (
                <li key={p.slug}>
                  <Link href={`/products/${p.slug}`}>
                    <Mark product={p} size={26} />
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="wrap hero-stage">
          <Connection />
        </div>
      </section>

      <section className="section">
        <div className="wrap split">
          <SectionHead title="Six products. Choose the ones you need." intro="Four are ready today; two are on the way. Each has its own job, and each works with the others when you have them." />
          <ProductIndex />
        </div>
      </section>

      <section className="section section--tint">
        <div className="wrap">
          <SectionHead title="What each one does" />
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

      <section className="section">
        <div className="wrap">
          <SectionHead title="Built for the people who run the business" />
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

      <section className="section section--tint">
        <div className="wrap split">
          <SectionHead title="How you start" intro="Four steps, each done in the app yourself." />
          <ol className="steps">
            {STEPS.map(([t, d]) => (
              <li key={t}>
                <h3 className="h-3">{t}</h3>
                <p className="body">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section">
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

      <section className="section section--tint">
        <div className="wrap split">
          <SectionHead title="Kept safe, kept apart" />
          <ul className="facts">
            <li>
              <h3 className="h-3">Each company apart</h3>
              <p className="body">The database itself refuses to show one company’s records to another.</p>
            </li>
            <li>
              <h3 className="h-3">Sign-in you control</h3>
              <p className="body">Authenticator apps, single sign-on and a code again before the most sensitive actions.</p>
            </li>
            <li>
              <h3 className="h-3">Everything recorded</h3>
              <p className="body">Who changed what, and when, in an audit trail you can read in plain words.</p>
            </li>
            <li>
              <h3 className="h-3">Hosted in India</h3>
              <p className="body">{SITE.hosting}.</p>
            </li>
          </ul>
          <Link className="btn btn--text" href="/security">
            How Clor keeps your data safe
          </Link>
        </div>
      </section>

      <section className="section">
        <div className="wrap split">
          <SectionHead title="Pay for the products you use" intro="Each product has its own subscription, so a company that only needs payroll pays only for payroll. Prices are being finalised." />
          <div className="actions">
            <Link className="btn btn--quiet" href="/pricing">
              How pricing works
            </Link>
          </div>
        </div>
      </section>

      <section className="section section--tint">
        <div className="wrap">
          <Faq items={FAQ} />
        </div>
      </section>

      <Closing />
    </>
  );
}
