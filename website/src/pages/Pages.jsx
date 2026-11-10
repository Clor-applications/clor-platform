import React, { useEffect, useState } from 'react';
import { Link, useSearch } from '../router.jsx';
import { PRODUCTS, SITE, productBySlug } from '../site.js';
import { Mark, Status } from '../components/Brand.jsx';
import { Closing, Faq, SectionHead, Steps } from '../components/Blocks.jsx';
import { Head } from '../components/Sections.jsx';
import { DOCUMENTS } from '../../../packages/shell/legal/documents.jsx';

export function PageHead({ title, intro, children }) {
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

/* ------------------------------------------------------------- solutions
 * Businesses and accounting firms: a title, what is true today as plain
 * lists on the page ground, and the shared Setting up and data sections.
 * What is planned is marked planned.
 */
function SolutionHero({ title, intro, pic, children }) {
  const copy = (
    <div className="hero-copy">
      <h1 id="sol-title" className="h-hero">
        {title}
      </h1>
      <p className="lede">{intro}</p>
      <div className="actions">{children}</div>
    </div>
  );
  return (
    <section className="hero sol-hero" aria-labelledby="sol-title">
      {pic ? (
        <div className="wrap sol-hero-split">
          {copy}
          <figure className="sol-hero-photo">
            <img src={pic.src[1]} srcSet={`${pic.src[0]} ${pic.w[0]}w, ${pic.src[1]} ${pic.w[1]}w`} sizes="(max-width: 900px) 100vw, 640px" width={pic.w[1]} height={pic.h} fetchPriority="high" alt={pic.alt} />
          </figure>
        </div>
      ) : (
        <div className="wrap">{copy}</div>
      )}
    </section>
  );
}

export function Businesses() {
  const stages = [
    ['Just starting', 'Begin with Books for GST invoices and accounts. Add the rest as people join.', ['books']],
    ['A growing team', 'Add People and Attendance when you hire, and Payroll when salaries need to be right every month.', ['people', 'attendance', 'payroll']],
    ['Several companies or branches', 'One login holds all your companies; each branch keeps its own GSTIN, stock and books.', ['books', 'payroll']],
  ];
  const changes = [
    ['Added once', 'A new employee is added once, and appears on the readers, in payroll and in the employee app.'],
    ['Payroll in the books', 'Payroll posts its own journal, so the books show salary cost the day the run is locked.'],
    ['One sign-in', 'Everyone signs in once and sees only the companies, branches and products you gave them.'],
    ['One audit trail', 'Every change, from an edited invoice to a role given to someone, is written to one audit trail you can read.'],
  ];
  return (
    <>
      <SolutionHero
        title="CLOR for businesses"
        pic={{ src: ['/people/business-workspace-700.webp', '/people/business-workspace-1400.webp'], w: [700, 1400], h: 788, alt: 'A manager at her laptop on the CLOR home screen, with Books, People, Payroll and Attendance' }}
        intro="Growing Indian companies use CLOR to raise GST invoices, keep each employee’s record, take attendance from the reader at the gate and pay salaries, without copying figures from one tool into the next."
      >
        <Link className="btn btn--primary btn--lg" href={SITE.demoUrl}>
          Request a demo
        </Link>
        <Link className="btn btn--text" href="/contact">
          Write to us
        </Link>
      </SolutionHero>

      <section className="section" aria-labelledby="stages-title">
        <div className="wrap">
          <Head id="stages-title" title="Pick the product for today’s problem" intro="There is no bundle to buy. Each product works on its own; add the others when you need them." />
          <ul className="groups">
            {stages.map(([t, d, ps]) => (
              <li key={t}>
                <h3 className="h-3">{t}</h3>
                <p className="body">{d}</p>
                <p className="stage-products">
                  {ps.map((sl) => (
                    <Link key={sl} href={`/products/${sl}`}>
                      <Mark product={productBySlug(sl)} size={22} /> {productBySlug(sl).name}
                    </Link>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="change-title">
        <div className="wrap split">
          <Head id="change-title" title="What changes when the products share records" />
          <dl className="steps">
            {changes.map(([t, d]) => (
              <div key={t}>
                <dt className="h-3">{t}</dt>
                <dd className="body">{d}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <Closing />
    </>
  );
}

export function Firms() {
  const today = [
    ['Your client invites you', 'The client invites your email address from their Workspace (Access, then Invitations). You join with your own login, never theirs.'],
    ['Every client, one login', 'Accept invitations from as many clients as you work for, and switch between their companies from the company menu without signing out.'],
    ['Access the client controls', 'The client chooses your role, for example posting entries but not approving payments, and can change it or end it at any time.'],
    ['Time-limited if they prefer', 'A client can give you outside access that ends on a date they choose (Access, then Outside access), for an audit or a filing season.'],
    ['Everything recorded', 'Every change you make is in the client’s own audit trail, in plain words, with your name on it.'],
    ['GST and TDS where the work is', 'Returns come from the client’s own invoices and bills, so the month’s work is review, not re-entry.'],
  ];
  const steps = [
    ['Your client invites you', 'From their Workspace, under Access and then Invitations, with your email and the role you need.'],
    ['You accept with your login', 'One CLOR login for you, however many clients you have.'],
    ['Work in their books', 'Switch between clients from the company menu; each keeps its own records.'],
    ['They stay in control', 'The client sees what you changed, and can change your role or end your access.'],
  ];
  return (
    <>
      <SolutionHero
        title="CLOR for accounting firms"
        intro="Each client invites you into their CLOR company with your own login. You work in their books; they decide what you can see and change, and can end it at any time."
      >
        <Link className="btn btn--primary btn--lg" href="/contact?about=firm">
          Request a demo
        </Link>
        <Link className="btn btn--text" href="/contact?about=firm">
          Write to us
        </Link>
      </SolutionHero>

      <section className="section" aria-labelledby="firm-today-title">
        <div className="wrap">
          <Head id="firm-today-title" title="How firms work with clients on CLOR today" />
          <ul className="groups">
            {today.map(([t, d]) => (
              <li key={t}>
                <h3 className="h-3">{t}</h3>
                <p className="body">{d}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="firm-steps-title">
        <div className="wrap split">
          <Head id="firm-steps-title" title="From invitation to the month’s work" />
          <Steps steps={steps} />
        </div>
      </section>

      <section className="section" aria-labelledby="firm-planned-title">
        <div className="wrap split">
          <Head id="firm-planned-title" title="Planned: a workspace for the firm itself" intro="In development, not yet available. What we are building:" />
          <div className="stack">
            <ul className="facts-list">
              <li>Your firm’s own account, with your staff and their roles.</li>
              <li>Client engagements the client approves, with which products you may use and until when.</li>
              <li>Assigning staff to clients, and one view of who can reach which client.</li>
            </ul>
            <p className="small">The direction may change before release.</p>
          </div>
        </div>
      </section>

      <Closing demoHref="/contact?about=firm" title="Working with clients on CLOR already?" text="Ask your client to invite you from their Workspace, under Access and then Invitations. Or ask us for a demo of how firms work in CLOR." />
    </>
  );
}

/* ----------------------------------------------------------------- pricing */
export function Pricing() {
  return (
    <>
      <PageHead title="Pay for the products you use." intro="Every CLOR product has its own subscription. A company that needs only payroll pays only for payroll, and adding a product later never means changing plans." />
      <section className="section">
        <div className="wrap">
          <table className="price-table">
            <caption className="sr-only">Products and pricing</caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Status</th>
                <th scope="col">Price</th>
              </tr>
            </thead>
            <tbody>
              {PRODUCTS.map((p) => (
                <tr key={p.slug}>
                  <th scope="row">
                    <span className="price-name">
                      <Mark product={p} size={28} /> CLOR&nbsp;{p.name}
                    </span>
                  </th>
                  <td>
                    <Status product={p} />
                  </td>
                  <td className="small">{p.status === 'available' ? 'Being finalised' : 'At launch'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small price-note">Prices are being set now. Until they are published, talk to us and we will tell you what your company would pay.</p>
          <div className="actions price-actions">
            <Link className="btn btn--primary" href="/contact?about=pricing">
              Ask about pricing
            </Link>
          </div>
        </div>
      </section>
      <section className="section">
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
  ['API and webhooks', 'Read employees and attendance, send punches, and get told when things happen, with keys you create and can revoke.', 'attendance'],
  ['UPI payment links', 'A link on each invoice that your customer pays by UPI; the payment is recorded against the invoice.', 'books'],
  ['GST e-invoice and e-way bill', 'Generate the IRN and e-way bill from the invoice itself.', 'books'],
];

export function Integrations() {
  return (
    <>
      <PageHead title="What connects to CLOR" intro="Only what works today is listed here. If you need something that isn’t, tell us." />
      <section className="section">
        <div className="wrap">
          <ul className="integrations">
            {INTEGRATIONS.map(([name, text, product]) => (
              <li key={name}>
                <h2 className="h-3">{name}</h2>
                <p className="body">{text}</p>
                {product ? (
                  <Link className="small int-product" href={`/products/${product}`}>
                    <Mark product={productBySlug(product)} size={20} /> CLOR&nbsp;{productBySlug(product).name}
                  </Link>
                ) : (
                  <span className="small int-product">Every CLOR product</span>
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
      <PageHead title="Guides" intro="Help with setting up CLOR. More guides follow as the products grow." />
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
      <PageHead
        title="About CLOR"
        intro={`${SITE.company} makes CLOR: accounting, HR, payroll and attendance that read the same records, so an employee added in People is the same person on the attendance reader, in the salary run and in the books.`}
      >
        <p className="body">
          We work from our office in {SITE.city}: {SITE.address}. You are welcome to visit; write to {SITE.contactEmail} first so someone is there to meet you.
        </p>
      </PageHead>
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
              <p className="body">If a product or a feature isn’t ready, we say so, on this site and in the app.</p>
            </li>
          </ul>
        </div>
      </section>
      <Closing title="Want to know more?" text="Tell us about your business and what you’d like CLOR to do for it." />
    </>
  );
}

/* ----------------------------------------------------------------- contact */
/* Questions about buying go to sales; everything else to the general inbox. A demo has its own form (/demo). */
const SALES_TOPICS = new Set(['pricing', 'projects', 'timesheet', 'firm']);
const TOPICS = { general: 'A question about CLOR', pricing: 'Pricing for my company', projects: 'CLOR Projects, when it’s ready', timesheet: 'CLOR Timesheet, when it’s ready', firm: 'CLOR for my accounting firm' };

export function Contact() {
  const [about, setAbout] = useState('general');
  const [form, setForm] = useState({ name: '', company: '', email: '', message: '' });
  /* The query comes from the router, so an in-page link to another ?about= is heard too. */
  const search = useSearch();
  useEffect(() => {
    /* The address is read after hydration (the server has none); on the next frame, not inside the effect. ?about= picks the topic. */
    const q = new URLSearchParams(search);
    const topic = TOPICS[q.get('about')] ? q.get('about') : null;
    if (!topic) return undefined;
    const frame = requestAnimationFrame(() => setAbout(topic));
    return () => cancelAnimationFrame(frame);
  }, [search]);
  /* No form backend yet: the message opens in the visitor's own email app, addressed to us. */
  const mailto = () => {
    const body = `${form.message}\n\nName: ${form.name}\nCompany: ${form.company}\nEmail: ${form.email}`;
    const to = SALES_TOPICS.has(about) ? SITE.salesEmail : SITE.contactEmail;
    return `mailto:${to}?subject=${encodeURIComponent(TOPICS[about])}&body=${encodeURIComponent(body)}`;
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
            <dl className="contact-mail">
              <dt>General questions</dt>
              <dd>
                <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
              </dd>
              <dt>Buying CLOR</dt>
              <dd>
                <a href={`mailto:${SITE.salesEmail}`}>{SITE.salesEmail}</a>
              </dd>
              <dt>Help with the app</dt>
              <dd>
                <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>
              </dd>
            </dl>
            <h2 className="h-3">Visit</h2>
            <p className="body">
              {SITE.company}
              <br />
              {SITE.address}
            </p>
            <h2 className="h-3">Already a customer?</h2>
            <p className="body">Sign in and use Help in the app, or write to support.</p>
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
      <PageHead title="How CLOR keeps your data safe" intro="What we do today, described plainly. Nothing on this page is a plan." />
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
      <section className="section">
        <div className="wrap split">
          <SectionHead title="Found a problem?" intro="If you believe you have found a security issue in CLOR, write to us. We read every report." />
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
/*
 * Refund and cancellation: published on clor.in before this site (11 October
 * 2026) and kept word for word, because payment providers check for it. It is
 * the website's own page, not one of the app's shared legal documents.
 */
const REFUND = {
  title: 'Refund & cancellation',
  summary: 'How billing, cancellation and refunds work for CLOR. Last updated 11 October 2026.',
  Body: () => (
    <>
      <h2>Cloud subscriptions</h2>
      <p>
        Cloud plans are billed monthly or annually in advance. You can cancel any time from your account or by emailing us; cancellation stops
        the next renewal. Your access continues until the end of the period already paid for.
      </p>
      <h2>Refunds</h2>
      <p>
        Monthly fees already charged are generally non-refundable. For annual plans cancelled within 7 days of the first payment, we refund the
        amount in full. After 7 days, annual plans are non-refundable but remain active until the term ends. If we materially fail to provide the
        service and cannot fix it, contact us — we will refund the affected period.
      </p>
      <h2>On-premise licenses</h2>
      <p>
        On-premise license fees and annual support (AMC) are non-refundable once a license key has been issued, because the software has been
        delivered. A trial or pilot period, where offered, lets you evaluate before paying.
      </p>
      <h2>How refunds are paid</h2>
      <p>
        Approved refunds are made to the original payment method, normally within 5–10 business days of approval. Taxes already remitted (GST)
        are adjusted as the law requires.
      </p>
      <h2>Free tier and trials</h2>
      <p>Free plans and trial periods carry no charge and nothing to refund.</p>
      <h2>Contact</h2>
      <p>
        Billing questions and cancellation requests: <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>.
      </p>
    </>
  ),
};
/*
 * Delivery (shipping) policy. CLOR ships nothing physical; payment providers
 * still ask how and when a buyer receives what they paid for. Like the refund
 * page, the website's own, not one of the app's shared legal documents.
 */
const DELIVERY = {
  title: 'Delivery policy',
  summary: 'How you receive CLOR after you sign up or pay. Last updated 9 November 2026.',
  Body: () => (
    <>
      <h2>Nothing is shipped</h2>
      <p>
        CLOR is software used in a web browser and in our phone apps. We do not send any physical goods, so there are no shipping charges and
        no delivery address is needed.
      </p>
      <h2>Cloud plans</h2>
      <p>
        Access is delivered by email to the address you sign up with. When you create an account yourself, you can use it as soon as you have
        confirmed your email. When our team creates the account for you after a demo, we email the owner a link to set a password, and the
        apps you chose are ready when you sign in.
      </p>
      <p>
        A paid plan or an added app starts as soon as the payment is confirmed. Nothing changes in how you sign in: the new apps appear in the
        same account.
      </p>
      <h2>On-premise licenses</h2>
      <p>The license key and the installation guide are emailed to the address on the order once the payment is confirmed.</p>
      <h2>Invoices</h2>
      <p>The invoice for each payment is emailed to the account owner.</p>
      <h2>If something has not arrived</h2>
      <p>
        Check your spam folder first. If the email is still missing, write to{' '}
        <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a> from the address you signed up with, and we will send it again.
      </p>
      <h2>Who delivers it</h2>
      <p>
        {SITE.company}, {SITE.address}.
      </p>
    </>
  ),
};
const LEGAL = { ...DOCUMENTS, refund: REFUND, delivery: DELIVERY };

export function Legal({ doc }) {
  const d = LEGAL[doc];
  const Body = d.Body;
  return (
    <>
      <PageHead title={d.title} intro={d.summary} />
      <section className="section section--flush">
        <div className="wrap">
          <nav className="legal-nav" aria-label="Legal documents">
            {['privacy', 'terms', 'cookies', 'refund', 'delivery'].map((k) => (
              <Link key={k} href={`/legal/${k}`} aria-current={k === doc ? 'page' : undefined}>
                {LEGAL[k].title}
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

