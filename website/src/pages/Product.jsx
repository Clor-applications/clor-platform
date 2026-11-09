import React from 'react';
import { Link } from '../router.jsx';
import { CONNECTIONS, PRODUCTS, SITE, demoFor, productBySlug } from '../site.js';
import { PRODUCT_CONTENT } from '../content.js';
import { Mark, Status } from '../components/Brand.jsx';
import { CAPABILITY_FIGS, HERO_FIGS } from '../components/Figures.jsx';
import { Closing, Faq, Steps } from '../components/Blocks.jsx';
import { Head, SettingUp, TrustBand } from '../components/Sections.jsx';

/*
 * Each product's page: who it is for and what it does beside its hero
 * figure; what it fixes; one figure per capability, alternating sides, with
 * the rest of what is inside in words; a working day in it; how it joins the
 * other products; the rules it keeps; who sees what; the questions people
 * ask. The demo request carries the product (?app=).
 */

/* What Indian law, or which of your own rules, each product carries. */
const STATUTORY = {
  books: [
    ['GST', 'CGST, SGST and IGST from the place of supply, on every document'],
    ['e-Invoice', 'IRN generated from the invoice'],
    ['e-Way bill', 'From the invoice or the delivery challan'],
    ['GSTR-1 and GSTR-3B', 'Built from the month’s documents'],
    ['TDS on purchases', 'Deducted on bills where it applies'],
  ],
  payroll: [
    ['Provident fund', 'Employee and employer shares, the monthly ECR file'],
    ['ESI', 'Contributions below the wage ceiling, the return'],
    ['Professional tax', 'By the state each person works in'],
    ['TDS on salary', 'Monthly deduction, quarterly 24Q'],
    ['Form 16', 'For every employee at year end'],
    ['Gratuity and leave encashment', 'In the final settlement'],
  ],
  people: [
    ['Statutory details', 'PAN, Aadhaar, UAN and ESI number on the record, shown only to those who need them'],
    ['Notice periods', 'From the employment terms, into the leaving checklist'],
    ['Document access', 'Each document kept with who may see it'],
  ],
  attendance: [
    ['Working hours and overtime', 'Worked out from shifts and the rules you set'],
    ['Leave', 'Types, balances and carry-over by your policy'],
    ['Selfie retention', 'Phone-punch selfies kept only for the period you choose'],
  ],
  workspace: [
    ['Audit trail', 'Every change to records, roles and access, with who and when'],
    ['Data export', 'A company’s data, exported whenever you want'],
    ['Closing a company', 'A notice period before anything is deleted'],
  ],
};

/* "For small companies." or, for Workspace, "Included with every product." */
const forLine = (p) => (p.who.startsWith('Included') ? `${p.who}.` : `For ${p.who.charAt(0).toLowerCase()}${p.who.slice(1)}.`);

function Hero({ p, c, soon }) {
  const Figure = HERO_FIGS[p.slug];
  return (
    <section className="hero p-hero" aria-labelledby="p-title">
      <div className="wrap p-hero-grid">
        <div className="hero-copy">
          <p className="app-sec-name">
            <Mark product={p} size={26} /> CLOR&nbsp;{p.name} {soon ? <Status product={p} /> : null}
          </p>
          <h1 id="p-title" className="h-hero">
            {c.title}
          </h1>
          <p className="lede">{c.intro}</p>
          {p.who && !soon ? <p className="p-who">{forLine(p)}</p> : null}
          <div className="actions">
            {soon ? (
              <Link className="btn btn--primary btn--lg" href={`/contact?about=${p.slug}`}>
                Tell me when it’s ready
              </Link>
            ) : (
              <Link className="btn btn--primary btn--lg" href={p.slug === 'workspace' ? SITE.demoUrl : demoFor(p.slug)}>
                Request a demo
              </Link>
            )}
            <Link className="btn btn--quiet btn--lg" href="/products">
              All products
            </Link>
          </div>
        </div>
        {Figure ? (
          <div className="p-pic">
            <Figure reveal={false} caption={false} className="fig--hero" />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SoonPage({ p, c }) {
  return (
    <>
      <Hero p={p} c={c} soon />
      <section className="section" aria-labelledby="plan-title">
        <div className="wrap split">
          <Head id="plan-title" title="What we are building" intro="This is the direction, and it may change before release." />
          <ul className="facts-list">
            {c.planned.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </section>
      <Closing title="Use the products that are ready today." text="Books, People, Attendance and Payroll share one sign-in and one list of employees. Projects and Timesheet join them when they are ready.">
        <Link href="/products">See every product</Link>
      </Closing>
    </>
  );
}

/** One capability: its figure on one side, its name and sentence on the other. */
function Capability({ name, text, Figure, n, flip }) {
  return (
    <div className={`cap${flip ? ' cap--flip' : ''}`}>
      <div className="cap-copy">
        <p className="app-sec-n num" aria-hidden="true">
          {n}
        </p>
        <h3 className="h-2">{name}</h3>
        <p className="lede">{text}</p>
      </div>
      <div className="cap-pic">
        <Figure n={n} caption={`${name}: ${text.charAt(0).toLowerCase()}${text.slice(1)}`} />
      </div>
    </div>
  );
}

export default function Product({ slug }) {
  const p = productBySlug(slug);
  const c = PRODUCT_CONTENT[slug];
  if (p.status !== 'available') return <SoonPage p={p} c={c} />;
  const links = CONNECTIONS.filter((x) => x.from === slug || x.to === slug);
  const figs = CAPABILITY_FIGS[slug];
  const drawn = new Set(figs.map(([name]) => name));
  const rest = c.features.filter(([k]) => !drawn.has(k));
  return (
    <>
      <Hero p={p} c={c} />

      <section className="section" aria-labelledby="fixes-title">
        <div className="wrap split">
          <Head id="fixes-title" title="What it fixes" />
          <ul className="problems">
            {c.problems.map(([prob, fix]) => (
              <li key={prob}>
                <h3 className="h-3">{prob}</h3>
                <p className="body">{fix}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="inside-title">
        <div className="wrap">
          <Head id="inside-title" title={`What’s in ${p.name}`} />
          <div className="caps">
            {figs.map(([name, Figure], i) => {
              const feature = c.features.find(([k]) => k === name);
              return <Capability key={name} name={name} text={feature ? feature[1] : ''} Figure={Figure} n={`0${i + 1}`} flip={i % 2 === 1} />;
            })}
          </div>
          {rest.length ? (
            <div className="split caps-rest">
              <Head title={`Also in ${p.name}`} />
              <dl className="steps">
                {rest.map(([k, v]) => (
                  <div key={k}>
                    <dt className="h-3">{k}</dt>
                    <dd className="body">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      </section>

      <section className="section" aria-labelledby="flow-title">
        <div className="wrap split">
          <Head id="flow-title" title={c.workflow.title} />
          <Steps steps={c.workflow.steps} />
        </div>
      </section>

      {links.length ? (
        <section className="section" aria-labelledby="links-title">
          <div className="wrap split">
            <Head id="links-title" title={`${p.name} and the other CLOR products`} intro={`${p.name} works on its own. When you use the others too, these links work for you.`} />
            <ul className="links">
              {links.map((x) => {
                const other = productBySlug(x.from === slug ? x.to : x.from);
                return (
                  <li key={x.from + x.to}>
                    <span className="links-pair">
                      <Mark product={productBySlug(x.from)} size={26} />
                      <span className="links-wire" aria-hidden="true" />
                      <Mark product={productBySlug(x.to)} size={26} />
                    </span>
                    <p className="body">{x.text}</p>
                    <Link className="text-link" href={`/products/${other.slug}`}>
                      CLOR&nbsp;{other.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="section" aria-labelledby="law-title">
        <div className="wrap split">
          <Head id="law-title" title={slug === 'books' || slug === 'payroll' ? 'Indian law, built in' : 'Rules it keeps for you'} />
          <ul className="ruled ruled--2">
            {STATUTORY[slug].map(([k, v]) => (
              <li key={k}>
                <span className="ruled-k">{k}</span>
                <span className="ruled-v">{v}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {slug === 'workspace' ? null : <SettingUp />}

      <section className="section" aria-labelledby="roles-title">
        <div className="wrap split">
          <Head id="roles-title" title="Who sees what" />
          <p className="lede">{c.roles}</p>
        </div>
      </section>

      <TrustBand />

      <section className="section">
        <div className="wrap">
          <Faq items={c.faq} />
        </div>
      </section>

      <Closing demoHref={slug === 'workspace' ? SITE.demoUrl : demoFor(slug)} title={`See ${p.name} with your own data.`} text={`Tell us how you handle this today and we will walk you through the same month in CLOR ${p.name}.`} />
    </>
  );
}

/* The products index: each one a row with its figure, who it is for and what it does. */
export function Products() {
  return (
    <>
      <section className="hero hero--product">
        <div className="wrap hero-copy">
          <h1 className="h-hero">Five products. Buy the ones you need.</h1>
          <p className="lede">Each one does its job on its own. Used together, they share one sign-in, one list of employees and one set of books. Workspace comes with any of them.</p>
        </div>
      </section>
      <section className="section section--flush">
        <div className="wrap">
          <ul className="plist">
            {PRODUCTS.map((p, i) => {
              const Figure = HERO_FIGS[p.slug];
              return (
                <li key={p.slug} className={p.status === 'soon' ? 'is-soon' : ''}>
                  <div className="plist-pic">{Figure ? <Figure n={`0${i + 1}`} /> : <Mark product={p} size={56} />}</div>
                  <div className="plist-copy">
                    <h2 className="h-2">
                      <Link href={`/products/${p.slug}`}>CLOR&nbsp;{p.name}</Link> {p.status === 'soon' ? <Status product={p} /> : null}
                    </h2>
                    {p.who ? <p className="p-who">{forLine(p)}</p> : null}
                    <p className="body">{p.line}</p>
                    <Link className="text-link" href={`/products/${p.slug}`}>
                      {p.status === 'soon' ? 'What is planned' : `More about ${p.name}`}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
      <section className="section">
        <div className="wrap split">
          <Head title="People or Attendance?" intro="Two apps for time and leave, because a company of eight and a company of eight hundred do not need the same thing." />
          <ul className="problems">
            <li>
              <h3 className="h-3">Attendance, for a small company</h3>
              <p className="body">Time, leave and shifts, from biometric readers or a phone, and the month close for payroll. Nothing else to set up.</p>
            </li>
            <li>
              <h3 className="h-3">People, for a company that is growing</h3>
              <p className="body">The full HR app: records, documents, joining and leaving, letters, the org chart and the employee app. It includes everything Attendance does, so you never run both.</p>
            </li>
          </ul>
        </div>
      </section>
      <Closing />
    </>
  );
}
