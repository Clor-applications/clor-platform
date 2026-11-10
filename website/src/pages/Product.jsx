import React from 'react';
import { Link } from '../router.jsx';
import { CONNECTIONS, SITE, demoFor, productBySlug } from '../site.js';
import { useProducts } from '../catalogue.js';
import { PRODUCT_CONTENT } from '../content.js';
import { Mark, Status } from '../components/Brand.jsx';
import { Closing, Faq, SectionHead, Steps } from '../components/Blocks.jsx';
import { Head } from '../components/Sections.jsx';

/*
 * Each product's page: what it is, a screen drawn with sample data, what it
 * fixes, what is in it, a working day in it, and how it joins the other
 * products. The demo request carries the product (?app=), so the contact
 * page names it in the message.
 */

/* Each product's hero photo: a person at work with that product's real screen on the device. */
const PHOTOS = {
  books: { src: ['/people/books-invoice-560.webp', '/people/books-invoice-980.webp'], w: [560, 980], h: 620, alt: 'A tax invoice in CLOR Books on a laptop, with sample data', cut: true },
  people: { src: ['/people/people-hr-700.webp', '/people/people-hr-1400.webp'], w: [700, 1400], h: 788, alt: 'An HR manager looking at an employee’s profile in CLOR People' },
  payroll: { src: ['/people/payroll-payslip-560.webp', '/people/payroll-payslip-1120.webp'], w: [560, 1120], h: 1400, alt: 'An employee reading her October payslip from CLOR Payroll on her phone', tall: true },
  attendance: { src: ['/people/attendance-reader-700.webp', '/people/attendance-reader-1400.webp'], w: [700, 1400], h: 1050, alt: 'An employee punching in on a biometric reader showing CLOR Attendance' },
  projects: { src: ['/people/projects-360.webp', '/people/projects-720.webp'], w: [454, 909], h: 720, alt: 'Two colleagues planning project work at a desk' },
  timesheet: { src: ['/people/timesheet-360.webp', '/people/timesheet-720.webp'], w: [372, 744], h: 720, alt: 'A consultant logging time at his laptop' },
};

function Hero({ p, c, soon }) {
  const ph = PHOTOS[p.slug];
  return (
    <section className="hero p-hero" aria-labelledby="p-title">
      <div className={`wrap${ph ? ' p-hero-grid' : ''}`}>
        <div className="hero-copy">
          <h1 id="p-title" className="h-hero">
            CLOR&nbsp;{p.name}
          </h1>
          {soon ? <Status product={p} /> : null}
          <p className="lede">
            {c.title} {c.intro}
          </p>
          <div className="actions">
            {soon ? (
              <Link className="btn btn--primary btn--lg" href={`/contact?about=${p.slug}`}>
                Tell me when it’s ready
              </Link>
            ) : (
              <>
                <Link className="btn btn--primary btn--lg" href={demoFor(p.slug)}>
                  Request a demo
                </Link>
                <a className="btn btn--quiet btn--lg" href={`${SITE.startUrl}?app=${p.slug}`}>
                  Start free trial
                </a>
              </>
            )}
            <Link className="btn btn--text" href="/products">
              {soon ? 'See what’s available now' : 'All products'}
            </Link>
          </div>
          {soon ? null : (
            <p className="p-signin">
              Already using CLOR {p.name}?{' '}
              <a href={SITE.appHomeFor(p.slug)}>Sign in at {SITE.appHomeFor(p.slug).replace(/^https?:\/\//, '')}</a>
            </p>
          )}
        </div>
        {ph ? (
          <figure className={`p-photo${ph.cut ? ' p-photo--cut' : ''}${ph.tall ? ' p-photo--tall' : ''}`}>
            <img
              src={ph.src[1]}
              srcSet={`${ph.src[0]} ${ph.w[0]}w, ${ph.src[1]} ${ph.w[1]}w`}
              sizes="(max-width: 900px) 100vw, 560px"
              width={ph.w[1]}
              height={ph.h || undefined}
              fetchPriority="high"
              alt={ph.alt}
            />
          </figure>
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
      <Closing title="Use the products that are ready today." text="Books, Payroll, People and Attendance share one login and one list of employees. Projects joins them when it is ready.">
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
          <Head id="fixes-title" title="What it fixes" />
          <ul className="groups">
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
          <dl className="p-features">
            {c.features.map(([k, v]) => (
              <div key={k} className="p-feature">
                <dt className="h-3">{k}</dt>
                <dd className="body">{v}</dd>
              </div>
            ))}
          </dl>
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

      <section className="section" aria-labelledby="roles-title">
        <div className="wrap split">
          <Head id="roles-title" title="Who sees what" />
          <div className="stack">
            <p className="lede">{c.roles}</p>
            <Link className="text-link" href="/security">
              How CLOR keeps your data safe
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <Faq items={c.faq} />
        </div>
      </section>

      <Closing demoHref={demoFor(slug)} title={`See ${p.name} with your own data.`} text={`Tell us how you handle this today and we will walk you through the same month in CLOR ${p.name}.`} />
    </>
  );
}

export function Products() {
  const PRODUCTS = useProducts();
  return (
    <>
      <section className="hero hero--product">
        <div className="wrap stack" style={{ '--stack': '1.25rem' }}>
          <h1 className="h-1">The CLOR products</h1>
          <p className="lede">Each one does a job on its own. Bought together, they share one login, one list of employees and one set of books.</p>
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
                        CLOR&nbsp;{p.name} <Status product={p} />
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
      <section className="section">
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
