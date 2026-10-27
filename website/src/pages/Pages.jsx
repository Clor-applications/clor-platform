import React, { useEffect, useState } from 'react';
import { Link } from '../router.jsx';
import { PRODUCTS, SITE, productBySlug } from '../site.js';
import { Mark, Status } from '../components/Brand.jsx';
import { Closing, Faq, Reveal, RevealGroup, SectionHead, Steps } from '../components/Blocks.jsx';
import { Head, HowItWorks, TrustBand } from '../components/Sections.jsx';
import { ArrowRight, Building2, Clock, FileText, History, KeyRound, Mail, ShieldCheck, Users, Wallet } from 'lucide-react';
import Illustration from '../components/Illustration.jsx';
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

/* ------------------------------------------------------------- solutions
 * Businesses and accounting firms, in the home page's language: an orange
 * label, a title, the product artwork, cards that arrive in turn, and the
 * shared How it works and Trust sections. Everything said here is true of
 * the product today; what is planned is marked planned.
 */
function SolutionHero({ eyebrow, title, accent, intro, art, children }) {
  return (
    <section className="hero sol-hero" aria-labelledby="sol-title">
      <div className="wrap sol-hero-grid">
        <div className="sol-hero-copy">
          <p className="eyebrow hero-in" style={{ '--d': 0 }}>
            {eyebrow}
          </p>
          <h1 id="sol-title" className="h-hero sol-title hero-in" style={{ '--d': 0 }}>
            {title} {accent ? <span className="accent-word">{accent}</span> : null}
          </h1>
          <p className="lede hero-in" style={{ '--d': 1 }}>
            {intro}
          </p>
          <div className="actions hero-in" style={{ '--d': 2 }}>
            {children}
          </div>
        </div>
        <div className="sol-hero-art">{art}</div>
      </div>
    </section>
  );
}

export function Businesses() {
  const stages = [
    ['Just starting', 'Begin with Books for GST invoices and accounts. Add the rest as people join.', ['books']],
    ['A growing team', 'Add People and Attendance when you hire, and Payroll when salaries need to be right every month.', ['people', 'attendance', 'payroll']],
    ['Several companies or branches', 'One workspace holds all your companies; each branch keeps its own GSTIN, stock and books.', ['books', 'payroll']],
  ];
  const changes = [
    [Users, 'Added once', 'A new employee is added once, and appears on the readers, in payroll and in the employee app.'],
    [Wallet, 'Payroll in the books', 'Payroll posts its own journal, so the books show salary cost the day the run is locked.'],
    [KeyRound, 'One sign-in', 'Everyone signs in once and sees only the companies, branches and apps you gave them.'],
    [History, 'One audit trail', 'Every change — an invoice edited, a role granted — is in one audit trail you can read.'],
  ];
  return (
    <>
      <SolutionHero
        eyebrow="For businesses"
        title="Run the whole business from"
        accent="one workspace."
        intro="Small and mid-sized Indian companies use Clor to keep accounts, people, payroll and attendance in one place, without stitching tools together."
        art={<Illustration className="sol-art" src="/illustrations/team.webp" width={1000} height={772} priority alt="A business owner at a laptop, with team productivity, tasks and monthly revenue beside him." />}
      >
        <a className="btn btn--primary btn--lg" href={SITE.signUpUrl}>
          Get started <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
        </a>
        <Link className="btn btn--quiet btn--lg" href="/contact">
          Talk to us
        </Link>
      </SolutionHero>

      <section className="section" aria-labelledby="stages-title">
        <div className="wrap">
          <Head center id="stages-title" eyebrow="Start where you are" title="Pick the app for today’s problem" intro="There is no bundle to buy. Each app works on its own; add the others when you need them." />
          <RevealGroup as="ul" className="p-cards sol-stages">
            {stages.map(([t, d, ps], n) => (
              <li key={t} className="p-card" style={{ '--i': n }}>
                <span className="sol-step">{n + 1}</span>
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
          </RevealGroup>
        </div>
      </section>

      <section className="section section--tint" aria-labelledby="change-title">
        <div className="wrap">
          <Head center id="change-title" eyebrow="Better together" title="What changes when it’s all in one place" />
          <Reveal className="connect-stage">
            <Illustration className="connect-art" src="/illustrations/connected-apps.webp" width={1400} height={933} alt="People, Attendance, Payroll and Books joined at Clor." />
          </Reveal>
          <RevealGroup as="ul" className="trust-cards sol-changes">
            {changes.map(([Icon, t, d], n) => (
              <li key={t} className="trust-card" style={{ '--i': n }}>
                <span className="trust-icon tone-orange" aria-hidden="true">
                  <Icon size={24} strokeWidth={1.75} />
                </span>
                <h3 className="h-3">{t}</h3>
                <p className="body">{d}</p>
              </li>
            ))}
          </RevealGroup>
        </div>
      </section>

      <section className="section" aria-labelledby="sol-devices-title">
        <div className="wrap split devices">
          <Head id="sol-devices-title" eyebrow="Anywhere you work" title="In the office, on the floor, on the road" intro="In the browser on any computer, and in the Clor apps on your phone: employees punch in, see payslips and ask for leave from theirs." />
          <Reveal className="devices-art-wrap">
            <Illustration className="devices-art" src="/illustrations/devices.webp" width={1300} height={815} alt="A laptop, a phone and a tablet, each showing Clor, connected to the same workspace." />
          </Reveal>
        </div>
      </section>

      <HowItWorks />
      <TrustBand />
      <Closing />
    </>
  );
}

export function Firms() {
  const today = [
    [Mail, 'Your client invites you', 'The client invites your email address from their Workspace (Access › Invitations). You join with your own login — never theirs.'],
    [Building2, 'Every client, one login', 'Accept invitations from as many clients as you work for, and switch between their companies from the company menu without signing out.'],
    [ShieldCheck, 'Access the client controls', 'The client chooses your role — for example, post entries but not approve payments — and can change it or end it at any time.'],
    [Clock, 'Time-limited if they prefer', 'A client can give you outside access that ends on a date they choose (Access › Outside access), for an audit or a filing season.'],
    [History, 'Everything recorded', 'Every change you make is in the client’s own audit trail, in plain words, with your name on it.'],
    [FileText, 'GST and TDS where the work is', 'Returns come from the client’s own invoices and bills, so the month’s work is review, not re-entry.'],
  ];
  const steps = [
    ['Your client invites you', 'From their Workspace: Access › Invitations, with your email and the role you need.'],
    ['You accept with your login', 'One Clor login for you, whatever number of clients.'],
    ['Work in their books', 'Switch between clients from the company menu; each keeps its own records.'],
    ['They stay in control', 'The client sees what you changed, and can change your role or end your access.'],
  ];
  return (
    <>
      <SolutionHero
        eyebrow="For accounting firms"
        title="Your clients’ books, with their"
        accent="permission."
        intro="Each client invites you into their Clor workspace with your own login. You work in their books; they decide what you can see and change, and can end it at any time."
        art={<Illustration className="sol-art" src="/illustrations/hero-workspace.webp" width={1400} height={787} priority alt="The Clor workspace on a laptop and a phone, with every app connected to it." />}
      >
        <a className="btn btn--primary btn--lg" href={SITE.signUpUrl}>
          Get started <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
        </a>
        <Link className="btn btn--quiet btn--lg" href="/contact?about=firms">
          Talk to us
        </Link>
      </SolutionHero>

      <section className="section" aria-labelledby="firm-today-title">
        <div className="wrap">
          <Head center id="firm-today-title" eyebrow="Available today" title="How firms work with clients on Clor" />
          <RevealGroup as="ul" className="trust-cards sol-cards-3">
            {today.map(([Icon, t, d], n) => (
              <li key={t} className="trust-card" style={{ '--i': n }}>
                <span className="trust-icon tone-orange" aria-hidden="true">
                  <Icon size={24} strokeWidth={1.75} />
                </span>
                <h3 className="h-3">{t}</h3>
                <p className="body">{d}</p>
              </li>
            ))}
          </RevealGroup>
        </div>
      </section>

      <section className="section section--tint" aria-labelledby="firm-steps-title">
        <div className="wrap split">
          <Head id="firm-steps-title" eyebrow="How it works" title="From invitation to the month’s work" />
          <Steps steps={steps} />
        </div>
      </section>

      <section className="section" aria-labelledby="firm-planned-title">
        <div className="wrap split firms-planned">
          <div className="stack">
            <Head id="firm-planned-title" eyebrow="Planned" title="A workspace for the firm itself" intro="In development, not yet available. What we are building:" />
            <ul className="ticks ticks--lg">
              <li>Your firm’s own account, with your staff and their roles.</li>
              <li>Client engagements the client approves, with which apps you may use and until when.</li>
              <li>Assigning staff to clients, and one view of who can reach which client.</li>
            </ul>
            <p className="small">Plans, not promises: the direction may change before release.</p>
          </div>
          <Reveal className="firms-art-wrap">
            <Illustration className="firms-art" src="/illustrations/ca-firm.webp" width={1200} height={848} alt="Planned: a CA firm’s own account, with its client companies under it and the firm’s people on each." />
          </Reveal>
        </div>
      </section>

      <TrustBand />
      <Closing title="Working with clients on Clor already?" text="Ask your client to invite you from their Workspace: Access › Invitations. Or talk to us about the firm workspace." />
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
/* Questions about buying go to sales; everything else to the general inbox. */
const SALES_TOPICS = new Set(['pricing', 'projects', 'timesheet', 'firm']);
const TOPICS = { general: 'A question about Clor', pricing: 'Pricing for my company', projects: 'Clor Projects, when it’s ready', timesheet: 'Clor Timesheet, when it’s ready', firm: 'Clor for my accounting firm' };

export function Contact() {
  const [about, setAbout] = useState('general');
  const [form, setForm] = useState({ name: '', company: '', email: '', message: '' });
  useEffect(() => {
    /* The address is read after hydration (the server has none); on the next frame, not inside the effect. */
    const q = new URLSearchParams(window.location.search).get('about');
    if (!q || !TOPICS[q]) return undefined;
    const frame = requestAnimationFrame(() => setAbout(q));
    return () => cancelAnimationFrame(frame);
  }, []);
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
              <dt>Buying Clor</dt>
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
/*
 * Refund and cancellation: published on clor.in before this site (11 October
 * 2026) and kept word for word, because payment providers check for it. It is
 * the website's own page, not one of the app's shared legal documents.
 */
const REFUND = {
  title: 'Refund & cancellation',
  summary: 'How billing, cancellation and refunds work for Clor. Last updated 11 October 2026.',
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
const LEGAL = { ...DOCUMENTS, refund: REFUND };

export function Legal({ doc }) {
  const d = LEGAL[doc];
  const Body = d.Body;
  return (
    <>
      <PageHead title={d.title} intro={d.summary} />
      <section className="section section--flush">
        <div className="wrap">
          <nav className="legal-nav" aria-label="Legal documents">
            {['privacy', 'terms', 'cookies', 'refund'].map((k) => (
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

