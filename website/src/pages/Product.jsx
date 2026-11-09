import React from 'react';
import { Link } from '../router.jsx';
import { CONNECTIONS, PRODUCTS, demoFor, productBySlug } from '../site.js';
import { PRODUCT_CONTENT } from '../content.js';
import { Mark, Status } from '../components/Brand.jsx';
import { WINDOWS } from '../components/Windows.jsx';
import { Closing, Faq, SectionHead, Steps } from '../components/Blocks.jsx';
import { Head, SettingUp, TrustBand } from '../components/Sections.jsx';

/*
 * Each product's page: what it is, a screen drawn with sample data, what it
 * fixes, what is in it, a working day in it, and how it joins the other
 * products. The demo request carries the product (?app=), so the contact
 * page names it in the message.
 */

/*
 * One photograph on some product pages, of the kind of business that uses
 * it (Unsplash; credited on the About page). Never in the hero, and never
 * presented as a customer.
 */
const PHOTOS = {
  books: { src: '/photos/photo-shop.webp', width: 1000, height: 668, alt: 'A snack shop in Mumbai with the owner behind the counter, packets of chips hanging on every side.' },
  attendance: { src: '/photos/photo-workshop.webp', width: 1000, height: 668, alt: 'A carpenter cutting a plank on a band saw in a small workshop.' },
  payroll: { src: '/photos/photo-office.webp', width: 1000, height: 750, alt: 'Two people at a laptop on a cafe table outdoors, talking through what is on the screen.' },
};

function Hero({ p, c, soon }) {
  const Win = WINDOWS[p.slug];
  return (
    <section className="hero p-hero" aria-labelledby="p-title">
      <div className={`wrap${Win ? ' p-hero-grid' : ''}`}>
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
              <Link className="btn btn--primary btn--lg" href={demoFor(p.slug)}>
                Request a demo
              </Link>
            )}
            <Link className="btn btn--text" href="/products">
              {soon ? 'See what’s available now' : 'All products'}
            </Link>
          </div>
        </div>
        {Win ? (
          <figure className="p-shot">
            <Win />
            <figcaption className="caption">Drawn with sample data. Real screenshots are on the way.</figcaption>
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
      <Closing title="Use the products that are ready today." text="Books, People, Payroll and Attendance share one login and one list of employees. Projects joins them when it is ready.">
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
  const photo = PHOTOS[slug];
  return (
    <>
      <Hero p={p} c={c} />

      <section className="section" aria-labelledby="fixes-title">
        <div className={`wrap${photo ? ' p-fixes' : ''}`}>
          <div>
            <Head id="fixes-title" title="What it fixes" />
            <ul className={photo ? 'steps-list' : 'groups'}>
              {c.problems.map(([prob, fix]) => (
                <li key={prob}>
                  <h3 className="h-3">{prob}</h3>
                  <p className="body">{fix}</p>
                </li>
              ))}
            </ul>
          </div>
          {photo ? <img className="photo" src={photo.src} width={photo.width} height={photo.height} alt={photo.alt} loading="lazy" decoding="async" /> : null}
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

      <SettingUp />

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

      <Closing demoHref={demoFor(slug)} title={`See ${p.name} with your own data.`} text={`Tell us how you handle this today and we will walk you through the same month in CLOR ${p.name}.`} />
    </>
  );
}

export function Products() {
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
