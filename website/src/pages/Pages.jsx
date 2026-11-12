import React, { useEffect, useState } from 'react';
import { Link, useSearch } from '../router.jsx';
import { SITE, productBySlug } from '../site.js';
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

/* ------------------------------------------------------------------ status */
/*
 * Is CLOR working (clor.in/status). The page is static, so it loads even when the API does not; the browser then asks
 * the API (GET /api/public/status) and asks again every minute. An answer that never comes is itself the answer.
 */
const STATUS_PARTS = ['Sign-in and Workspace', 'Books', 'People and Attendance', 'Payroll'];
const clock = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

export function ServiceStatus() {
  /* null: not asked yet. { down: true }: the API did not answer. Otherwise what it said. */
  const [state, setState] = useState(null);
  useEffect(() => {
    let live = true;
    const ask = () =>
      fetch(`${SITE.apiUrl}/public/status`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not ok'))))
        .then((body) => live && setState(body))
        .catch(() => live && setState({ down: true, checkedAt: new Date().toISOString() }));
    ask();
    const timer = setInterval(ask, 60000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const parts = state?.parts || STATUS_PARTS.map((name) => ({ key: name, name, ok: state ? false : null }));
  const headline = !state ? 'Checking…' : state.down ? 'CLOR is not answering' : state.ok ? 'Everything is working' : 'Some parts are not working';
  const intro = !state
    ? 'Asking CLOR now.'
    : state.down
      ? 'We could not reach CLOR from your browser. Check your own internet first. If it is working, CLOR is down: please write to us.'
      : state.ok
        ? 'Every part of CLOR answered just now.'
        : 'The parts marked below did not answer just now. The others are working.';
  return (
    <>
      <PageHead title={headline} intro={intro} />
      <section className="section section--flush">
        <div className="wrap">
          <ul className="status-list" aria-live="polite">
            {parts.map((p) => (
              <li key={p.key}>
                <span>{p.name}</span>
                <span className={`status-mark${p.ok === false ? ' status-mark--bad' : p.ok === null ? ' status-mark--wait' : ''}`}>
                  {p.ok === null ? 'Checking' : p.ok ? 'Working' : 'Not working'}
                </span>
              </li>
            ))}
          </ul>
          <p className="body status-note">
            {state ? `Checked at ${clock(state.checkedAt)}. This page checks again every minute. ` : null}
            Something wrong that this page does not show? Write to <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>.
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
/*
 * Data processing agreement (DPDP Act 2023): what larger customers ask for before they buy. The website's own page,
 * like refund and delivery. It states only what the product does today; a lawyer reviews the wording before it is
 * relied on (docs/compliance/OWNER_INPUT_REQUIRED.md).
 */
const DPA = {
  title: 'Data processing agreement',
  summary: 'How CLOR handles the personal data your company keeps in it, as your processor. Last updated 11 November 2026.',
  Body: () => (
    <>
      <h2>Who this is between</h2>
      <p>
        Your company (the customer) and {SITE.company}, {SITE.address} (CLOR, we). It applies whenever your company keeps personal data in
        CLOR, and is part of the <Link href="/legal/terms">terms of service</Link>.
      </p>
      <h2>Whose data it is</h2>
      <p>
        Your company decides what personal data goes into CLOR and why: your employees, your customers and suppliers, and the people you give
        a login. Under India’s Digital Personal Data Protection Act, 2023, your company is the Data Fiduciary for that data and we are its
        Data Processor. For the details of your own account with us (your name, email and sign-in history) we are the Data Fiduciary, and
        the <Link href="/legal/privacy">privacy notice</Link> applies.
      </p>
      <h2>What we do with it</h2>
      <ul>
        <li>We store and process the data only to provide CLOR to your company, and as your company instructs through the product.</li>
        <li>We do not sell it, use it for advertising, or use it to train AI models.</li>
        <li>Our staff do not open your business records. Support works from account details, settings and error logs.</li>
        <li>Everyone at CLOR who can reach production systems is bound to keep what they see confidential.</li>
      </ul>
      <h2>How we protect it</h2>
      <ul>
        <li>Each company’s records are kept apart, and the database itself refuses a query that does not name the company it is for.</li>
        <li>Data is encrypted in transit. Passwords are stored only as hashes; stored credentials for email servers and e-invoice portals are encrypted.</li>
        <li>Sign-in supports authenticator apps and single sign-on, and locks after repeated failures. CLOR staff must use an authenticator.</li>
        <li>Changes to records, roles and access are written to an audit trail your administrators can read.</li>
        <li>The database is backed up every day, with recovery to a point in time for the last 7 days.</li>
      </ul>
      <p>
        More on <Link href="/security">the security page</Link>.
      </p>
      <h2>Where it is kept</h2>
      <p>Servers and the database run in Google Cloud’s Mumbai region, in India.</p>
      <h2>Others who process it for us</h2>
      <ul>
        <li>
          <strong>Google Cloud</strong> (India): servers, database and backups.
        </li>
        <li>
          <strong>Cloudflare</strong>: delivers the app and protects it from attacks. Traffic passes through its network.
        </li>
        <li>
          <strong>An email service</strong>: delivers account and notification emails, unless your company sets up its own mail server in CLOR.
        </li>
      </ul>
      <p>
        Only if your company switches the feature on: a GST Suvidha Provider or the Invoice Registration Portal (GSTIN lookup and
        e-invoices), and an AI service that suggests a role for a new user from a job title. Each of these is bound to protect the data at
        least as this agreement does. We will tell account owners by email before we add or replace one.
      </p>
      <h2>If something goes wrong</h2>
      <p>
        If we learn of a breach that affects personal data your company keeps in CLOR, we will tell your account owner without undue delay,
        with what happened, what data was affected and what we are doing about it, so your company can meet its own duty to tell the people
        affected and the Data Protection Board of India.
      </p>
      <h2>When a person asks about their data</h2>
      <p>
        Your company answers requests from its own employees and contacts to see, correct or erase their data. CLOR gives your administrators
        the tools to do it (export, correction, and erasure with what the law requires you to keep). If such a person writes to us, we pass
        the request to your company.
      </p>
      <h2>Getting your data out, and deletion</h2>
      <ul>
        <li>Your company can export its data at any time.</li>
        <li>When your company closes a company in CLOR, it is deleted after a 30-day notice period, and backups that hold it expire after that.</li>
        <li>Tax and company law can require your company to keep some records for several years. Keeping your own copy is your company’s duty.</li>
      </ul>
      <h2>Showing that we do this</h2>
      <p>
        On a written request, at most once a year, we answer reasonable questions about how we meet this agreement. CLOR does not yet hold an
        ISO 27001 or SOC 2 certificate.
      </p>
      <h2>Changes</h2>
      <p>If we change this agreement in a way that matters, we email account owners before the change takes effect.</p>
      <h2>Contact</h2>
      <p>
        Questions about this agreement, or a signed copy for your records: <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
      </p>
    </>
  ),
};
const LEGAL = { ...DOCUMENTS, refund: REFUND, delivery: DELIVERY, dpa: DPA };

export function Legal({ doc }) {
  const d = LEGAL[doc];
  const Body = d.Body;
  return (
    <>
      <PageHead title={d.title} intro={d.summary} />
      <section className="section section--flush">
        <div className="wrap">
          <nav className="legal-nav" aria-label="Legal documents">
            {['privacy', 'terms', 'dpa', 'cookies', 'refund', 'delivery'].map((k) => (
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

