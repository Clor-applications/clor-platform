import React from 'react';
import { Link } from '../router.jsx';
import { CONNECTIONS, PRODUCTS, SITE, productBySlug } from '../site.js';
import { PRODUCT_CONTENT } from '../content.js';
import { Mark, Status } from '../components/Brand.jsx';
import { Closing, Faq, SectionHead, Steps } from '../components/Blocks.jsx';
import { WINDOWS } from '../components/Windows.jsx';

function SoonPage({ p, c }) {
  return (
    <>
      <section className="hero hero--product">
        <div className="wrap stack" style={{ '--stack': '1.25rem' }}>
          <p className="show-product">
            <Mark product={p} size={32} /> Clor {p.name} <Status product={p} />
          </p>
          <h1 className="h-1">{c.title}</h1>
          <p className="lede">{c.intro}</p>
          <div className="actions">
            <Link className="btn btn--primary" href={`/contact?about=${p.slug}`}>
              Tell me when it’s ready
            </Link>
            <Link className="btn btn--quiet" href="/products">
              See what’s available now
            </Link>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="wrap split">
          <SectionHead title="What we are building" intro="Plans, not promises: this is the direction, and it may change before release." />
          <ul className="facts facts--one">
            {c.planned.map((x) => (
              <li key={x}>
                <h3 className="h-3">{x}</h3>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

export default function Product({ slug }) {
  const p = productBySlug(slug);
  const c = PRODUCT_CONTENT[slug];
  if (p.status !== 'available') return <SoonPage p={p} c={c} />;
  const W = WINDOWS[slug];
  const links = CONNECTIONS.filter((x) => x.from === slug || x.to === slug);
  return (
    <>
      <section className="hero hero--product">
        <div className="wrap product-hero">
          <div className="stack" style={{ '--stack': '1.25rem' }}>
            <p className="show-product">
              <Mark product={p} size={32} /> Clor {p.name} <Status product={p} />
            </p>
            <h1 className="h-1">{c.title}</h1>
            <p className="lede">{c.intro}</p>
            <div className="actions">
              <a className="btn btn--primary" href={SITE.signUpUrl}>
                Get started with {p.name}
              </a>
              <Link className="btn btn--quiet" href="/contact">
                Talk to us
              </Link>
            </div>
          </div>
          <div className="product-shot">{W ? <W /> : null}</div>
        </div>
      </section>

      <section className="section">
        <div className="wrap split">
          <SectionHead title="What it fixes" />
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

      <section className="section section--tint">
        <div className="wrap">
          <SectionHead title={`What’s in ${p.name}`} />
          <dl className="features">
            {c.features.map(([k, v]) => (
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
          <SectionHead title={c.workflow.title} />
          <Steps steps={c.workflow.steps} />
        </div>
      </section>

      {links.length ? (
        <section className="section section--tint">
          <div className="wrap split">
            <SectionHead title="With the other Clor apps" intro={`${p.name} works on its own. When you use the others too, these links work for you.`} />
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
                    <Link className="btn btn--text" href={`/products/${other.slug}`}>
                      Clor {other.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="wrap split">
          <SectionHead title="Who sees what" />
          <p className="lede">{c.roles}</p>
        </div>
      </section>

      <section className="section section--tint">
        <div className="wrap">
          <Faq items={c.faq} />
        </div>
      </section>

      <Closing title={`Try ${p.name} with your own data.`} text="Create a workspace, switch on the app and invite the people who will use it." />
    </>
  );
}

export function Products() {
  return (
    <>
      <section className="hero hero--product">
        <div className="wrap stack" style={{ '--stack': '1.25rem' }}>
          <h1 className="h-1">The Clor products</h1>
          <p className="lede">Each one does a job on its own. Together they share one workspace, one sign-in, one list of people and one set of books.</p>
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
                        Clor {p.name} <Status product={p} />
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
      <section className="section section--tint">
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

