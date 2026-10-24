import React, { useEffect, useState } from 'react';
import { Link } from '../router.jsx';
import { PRODUCTS, SITE, productBySlug } from '../site.js';
import { Mark, Status } from '../components/Brand.jsx';
import { Closing, Faq, SectionHead } from '../components/Blocks.jsx';
import { DOCUMENTS } from '../../../packages/shell/legal/documents.jsx';

function PageHead({ title, intro, children }) {
  return (
    <section className="hero hero--product">
      <div className="wrap stack" style={{ '--stack': '1.25rem' }}>
        <h1 className="h-1">{title}</h1>
        {intro ? <p className="lede">{intro}</p> : null}
        {children}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- businesses */
export function Businesses() {
  const stages = [
    ['Just starting', 'Begin with Books for GST invoices and accounts. Add the rest as people join.', ['books']],
    ['A growing team', 'Add People and Attendance when you hire, and Payroll when salaries need to be right every month.', ['people', 'attendance', 'payroll']],
    ['Several companies or branches', 'One workspace holds all your companies; each branch keeps its own GSTIN, stock and books.', ['books', 'payroll']],
  ];
  return (
    <>
      <PageHead title="For businesses that would rather run the business." intro="Small and mid-sized Indian companies use Clor to keep accounts, people and payroll in one place, without stitching tools together.">
        <div className="actions">
          <a className="btn btn--primary" href={SITE.signUpUrl}>
            Get started
          </a>
          <Link className="btn btn--quiet" href="/contact">
            Talk to us
          </Link>
        </div>
      </PageHead>
      <section className="section">
        <div className="wrap split">
          <SectionHead title="Start where you are" intro="There is no bundle to buy. Pick the product for today’s problem." />
          <ul className="problems">
            {stages.map(([t, d, ps]) => (
              <li key={t}>
                <h3 className="h-3">{t}</h3>
                <p className="body">{d}</p>
                <p className="stage-products">
                  {ps.map((s) => (
                    <Link key={s} href={`/products/${s}`}>
                      <Mark product={productBySlug(s)} size={22} /> {productBySlug(s).name}
                    </Link>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="section section--tint">
        <div className="wrap split">
          <SectionHead title="What changes when it’s all in one place" />
          <ul className="ticks ticks--lg">
            <li>A new employee is added once, and appears on the readers, in payroll and in the employee app.</li>
            <li>Payroll posts its own journal, so the books show salary cost the day the run is locked.</li>
            <li>Everyone signs in once and sees only the companies, branches and apps you gave them.</li>
            <li>Every change — an invoice edited, a role granted — is in one audit trail.</li>
          </ul>
        </div>
      </section>
      <Closing />
    </>
  );
}

/* --------------------------------------------------------- accounting firms */
export function Firms() {
  return (
    <>
      <PageHead title="For accounting firms: your clients’ books, with their permission." intro="Your client invites you into their Clor workspace with your own login. You work in their books; they decide what you can see and change, and can end it at any time." />
      <section className="section">
        <div className="wrap split">
          <SectionHead title="Today" />
          <ul className="problems">
            <li>
              <h3 className="h-3">One login for every client</h3>
              <p className="body">Each client invites the same email address. Switch between their companies from the company menu, without signing out.</p>
            </li>
            <li>
              <h3 className="h-3">Their records stay theirs</h3>
              <p className="body">Every client’s data stays in their own workspace. Nothing of one client is visible from another.</p>
            </li>
            <li>
              <h3 className="h-3">Access the client controls</h3>
              <p className="body">The client chooses your role — for example, post entries but not approve payments — and every change you make is in their audit trail.</p>
            </li>
            <li>
              <h3 className="h-3">GST and TDS where the work is</h3>
              <p className="body">Returns come from the client’s own invoices and bills, so the month’s work is review, not re-entry.</p>
            </li>
          </ul>
        </div>
      </section>
      <section className="section section--tint">
        <div className="wrap split">
          <SectionHead title="Coming next for firms" intro="A workspace for the firm itself is in development. Planned, not yet available:" />
          <ul className="ticks ticks--lg">
            <li>Your firm’s own account, with your staff and their roles.</li>
            <li>Client engagements the client approves, with which apps you may use and until when.</li>
            <li>Assigning staff to clients, and one view of who can reach which client.</li>
          </ul>
        </div>
      </section>
      <Closing title="Working with clients on Clor already?" text="Ask your client to invite you from Company admin, Users. Or talk to us about the firm workspace." />
    </>
  );
}

/* ----------------------------------------------------------------- pricing */
export function Pricing() {
  return (
    <>
      <PageHead title="Pay for the products you use." intro="Every Clor product has its own subscription. A company that needs only payroll pays only for payroll, and adding a product later never means changing plans." />
      <section className="section">
        <div className="wrap">
          <div className="price-table" role="table" aria-label="Products and pricing">
            <div className="price-row price-row--head" role="row">
              <span role="columnheader">Product</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Price</span>
            </div>
            {PRODUCTS.map((p) => (
              <div key={p.slug} className="price-row" role="row">
                <span role="cell" className="price-name">
                  <Mark product={p} size={28} /> Clor {p.name}
                </span>
                <span role="cell">
                  <Status product={p} />
                </span>
                <span role="cell" className="small">
                  {p.status === 'available' ? 'Being finalised' : 'At launch'}
                </span>
              </div>
            ))}
          </div>
          <p className="small price-note">Prices are being set now. Until they are published, talk to us and we will tell you what your company would pay.</p>
          <div className="actions price-actions">
            <Link className="btn btn--primary" href="/contact?about=pricing">
              Ask about pricing
            </Link>
          </div>
        </div>
      </section>
      <section className="section section--tint">
        <div className="wrap">
          <Faq
            title="How subscriptions work"
            items={[
              ['Is there one plan for everything?', 'No. Each product is subscribed to on its own, for the companies in your workspace that use it.'],
              ['What happens to my data if I stop a product?', 'The data stays in your workspace and can be exported. Switching the product back on brings it back.'],
              ['Do accountants and employees count as users?', 'Employees using only the employee app are not workspace users. How outside accountants are counted will be set out with the prices.'],
            ]}
          />
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------ integrations */
const INTEGRATIONS = [
  ['Biometric and face readers', 'ZKTeco and eSSL over their cloud push protocol, Hikvision and Matrix readers, and others through the on-site connector.', 'attendance'],
  ['Tally', 'Keep Tally in step while you move, through the on-site connector, and import masters and opening balances.', 'books'],
  ['HR tools', 'Send punches to greytHR, Keka or Zoho People, and bring employees across from them.', 'attendance'],
  ['Single sign-on', 'Sign in with your company’s identity provider over SAML or OpenID Connect.', null],
  ['Directory sync (SCIM)', 'Add, change and remove users from your identity provider automatically.', null],
  ['API and webhooks', 'Read employees and attendance, send punches, and get told when things happen — with keys you create and can revoke.', 'attendance'],
  ['UPI payment links', 'A link on each invoice that your customer pays by UPI; the payment is recorded against the invoice.', 'books'],
  ['GST e-invoice and e-way bill', 'Generate the IRN and e-way bill from the invoice itself.', 'books'],
];

export function Integrations() {
  return (
    <>
      <PageHead title="What connects to Clor" intro="Only what works today is listed here. If you need something that isn’t, tell us." />
      <section className="section">
        <div className="wrap">
          <ul className="integrations">
            {INTEGRATIONS.map(([name, text, product]) => (
              <li key={name}>
                <h2 className="h-3">{name}</h2>
                <p className="body">{text}</p>
                {product ? (
                  <Link className="small int-product" href={`/products/${product}`}>
                    <Mark product={productBySlug(product)} size={20} /> Clor {productBySlug(product).name}
                  </Link>
                ) : (
                  <span className="small int-product">Every Clor product</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <Closing title="Need something that isn’t here?" text="Tell us what you use today. The on-site connector and the API cover more than this list." />
    </>
  );
}

/* --------------------------------------------------------------- resources */
const GUIDES = [
  ['readers', 'Connecting readers', 'Set up biometric and face readers, and enrol employees on them.'],
  ['connector', 'The on-site connector', 'Install the connector for readers on your network and for Tally.'],
  ['tally', 'Tally', 'Move from Tally, or keep it in step while you do.'],
  ['hr-tools', 'HR tools', 'Connect greytHR, Keka or Zoho People.'],
  ['sso', 'Single sign-on', 'Sign in through Google Workspace, Microsoft Entra ID or another identity provider.'],
  ['scim', 'Directory sync (SCIM)', 'Keep users in step with your identity provider.'],
];

export function Resources() {
  return (
    <>
      <PageHead title="Guides" intro="Step-by-step help for setting up Clor. More guides follow as the products grow." />
      <section className="section">
        <div className="wrap">
          <ul className="guides">
            {GUIDES.map(([slug, t, d]) => (
              <li key={slug}>
                <a href={`${SITE.appUrl}/docs/${slug}.html`} className="guide">
                  <h2 className="h-3">{t}</h2>
                  <p className="body">{d}</p>
                  <span className="small">Read the guide</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------- about */
export function About() {
  return (
    <>
      <PageHead title="We build the software Indian businesses run on." intro={`${SITE.company} makes Clor: accounting, HR, payroll and attendance that share one set of records, so a business keeps its books and its people in one place.`} />
      <section className="section">
        <div className="wrap split">
          <SectionHead title="What we hold to" />
          <ul className="problems">
            <li>
              <h3 className="h-3">One set of records</h3>
              <p className="body">A person is entered once, a sale is recorded once. Everything else reads from that.</p>
            </li>
            <li>
              <h3 className="h-3">Built for Indian law, not adapted to it</h3>
              <p className="body">GST, TDS, PF, ESI and professional tax are designed in from the start.</p>
            </li>
            <li>
              <h3 className="h-3">Your data, kept apart and portable</h3>
              <p className="body">Each company’s records are separated in the database itself, and can be exported whenever you want.</p>
            </li>
            <li>
              <h3 className="h-3">Say what is true</h3>
              <p className="body">If a product or a feature isn’t ready, we say so — on this site and in the app.</p>
            </li>
          </ul>
        </div>
      </section>
      <Closing title="Want to know more?" text="Tell us about your business and what you’d like Clor to do for it." />
    </>
  );
}

/* ----------------------------------------------------------------- contact */
const TOPICS = { general: 'A question about Clor', pricing: 'Pricing for my company', projects: 'Clor Projects, when it’s ready', timesheet: 'Clor Timesheet, when it’s ready', firm: 'Clor for my accounting firm' };

export function Contact() {
  const [about, setAbout] = useState('general');
  const [form, setForm] = useState({ name: '', company: '', email: '', message: '' });
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('about');
    if (q && TOPICS[q]) setAbout(q);
  }, []);
  /* No form backend yet: the message opens in the visitor's own email app, addressed to us. */
  const mailto = () => {
    const body = `${form.message}\n\nName: ${form.name}\nCompany: ${form.company}\nEmail: ${form.email}`;
    return `mailto:${SITE.contactEmail}?subject=${encodeURIComponent(TOPICS[about])}&body=${encodeURIComponent(body)}`;
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <>
      <PageHead title="Talk to us" intro="Tell us about your business and what you need." />
      <section className="section">
        <div className="wrap contact">
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              window.location.href = mailto();
            }}
          >
            <label className="field">
              <span>What it’s about</span>
              <select value={about} onChange={(e) => setAbout(e.target.value)}>
                {Object.entries(TOPICS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <div className="field-row">
              <label className="field">
                <span>Your name</span>
                <input name="name" autoComplete="name" value={form.name} onChange={set('name')} required />
              </label>
              <label className="field">
                <span>Company</span>
                <input name="organization" autoComplete="organization" value={form.company} onChange={set('company')} />
              </label>
            </div>
            <label className="field">
              <span>Email</span>
              <input name="email" type="email" autoComplete="email" spellCheck={false} value={form.email} onChange={set('email')} required />
            </label>
            <label className="field">
              <span>Message</span>
              <textarea name="message" rows={5} value={form.message} onChange={set('message')} />
            </label>
            <div className="actions">
              <button type="submit" className="btn btn--primary">
                Write the email
              </button>
              <p className="small">Opens your email app with this filled in.</p>
            </div>
          </form>
          <aside className="contact-aside stack">
            <h2 className="h-3">Or write to us directly</h2>
            <p>
              <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
            </p>
            <h2 className="h-3">Already a customer?</h2>
            <p className="body">Sign in and use Help in the app; it reaches the team that looks after your workspace.</p>
            <a className="btn btn--text" href={SITE.signInUrl}>
              Sign in
            </a>
          </aside>
        </div>
      </section>
    </>
  );
}

/* ---------------------------------------------------------------- security */
const SECURITY = [
  ['Each company kept apart', 'Every company’s records carry its identity, and the database itself refuses a query that does not name the company it is for. A mistake in one screen cannot show one company another’s data.'],
  ['Sign-in', 'Passwords stored only as strong hashes, lockout after repeated failures, authenticator apps, and single sign-on with your own identity provider.'],
  ['A second check for what matters most', 'Closing a company, opening payroll figures and changing bank details can need a fresh authenticator code or a second person’s approval.'],
  ['Who did what', 'Changes to records, roles and access are written to an audit trail in plain words, with who made them and when.'],
  ['Keys and tokens', 'API keys and connector tokens are stored only as hashes, can be paused, rotated or revoked, and expire.'],
  ['Where it runs', `${SITE.hosting}, served through Cloudflare.`],
  ['Your data is yours', 'Export a company’s data at any time. Closing a company gives a notice period before anything is deleted.'],
];

export function Security() {
  return (
    <>
      <PageHead title="How Clor keeps your data safe" intro="What we do today, described plainly. Nothing on this page is a plan." />
      <section className="section">
        <div className="wrap">
          <dl className="features">
            {SECURITY.map(([k, v]) => (
              <div key={k}>
                <dt className="h-3">{k}</dt>
                <dd className="body">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
      <section className="section section--tint">
        <div className="wrap split">
          <SectionHead title="Found a problem?" intro="If you believe you have found a security issue in Clor, write to us. We read every report." />
          <p>
            <a className="btn btn--quiet" href={`mailto:${SITE.contactEmail}?subject=${encodeURIComponent('Security report')}`}>
              Report a security issue
            </a>
          </p>
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------- legal */
export function Legal({ doc }) {
  const d = DOCUMENTS[doc];
  const Body = d.Body;
  return (
    <>
      <PageHead title={d.title} intro={d.summary} />
      <section className="section section--flush">
        <div className="wrap">
          <nav className="legal-nav" aria-label="Legal documents">
            {['privacy', 'terms', 'cookies'].map((k) => (
              <Link key={k} href={`/legal/${k}`} aria-current={k === doc ? 'page' : undefined}>
                {DOCUMENTS[k].title}
              </Link>
            ))}
          </nav>
          <article className="legal">
            <Body />
          </article>
        </div>
      </section>
    </>
  );
}

export function NotFound() {
  return (
    <PageHead title="This page isn’t here." intro="It may have moved, or the address may be mistyped.">
      <div className="actions">
        <Link className="btn btn--primary" href="/">
          Go to the home page
        </Link>
        <Link className="btn btn--quiet" href="/products">
          See the products
        </Link>
      </div>
    </PageHead>
  );
}

