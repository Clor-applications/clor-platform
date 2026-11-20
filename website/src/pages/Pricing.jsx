import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Link, useSearch } from '../router.jsx';
import { PRODUCTS, SITE, appIdFor, demoFor } from '../site.js';
import { Mark, ProductName } from '../components/Brand.jsx';
import { Closing, Faq } from '../components/Blocks.jsx';
import { PageHead } from './Pages.jsx';
import { useProducts } from '../catalogue.js';
import { BUILT_PRICING, UNIT, inr, provisional } from '../pricing.js';

/*
 * /pricing: the plans published in the operator console, by product, with a
 * monthly / yearly switch. Every number comes from the published price book;
 * the page holds none of its own. With nothing published it says so and
 * offers a demo instead.
 */
const unitWord = (unit, n) => (UNIT[unit] || ['unit', 'units'])[n === 1 ? 0 : 1];
/* The trial flow (app.clor.in/start): checks the email, then sets up the company with this app and plan. */
const trialUrl = (plan) => `${SITE.startUrl}?app=${encodeURIComponent(plan.apps[0])}&plan=${encodeURIComponent(plan.code)}`;
const slugOf = (app) => PRODUCTS.find((p) => appIdFor(p.slug) === app)?.slug;

/*
 * The built prices show from the first paint and stay until the live answer
 * settles; a live list replaces them only when it differs. A 404 (nothing
 * published right now) or no answer keeps what the build saw, so the plans
 * never vanish after they have been read; the next build follows the console.
 */
function usePricing() {
  const [pricing, setPricing] = useState(BUILT_PRICING);
  useEffect(() => {
    let live = true;
    fetch(`${SITE.apiUrl}/public/pricing`, { headers: { Accept: 'application/json' } })
      .then(async (r) => {
        if (!live || !r.ok) return;
        const body = await r.json();
        if (live && Array.isArray(body.plans)) setPricing((cur) => (JSON.stringify(cur) === JSON.stringify(body) ? cur : body));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return pricing;
}

/* One period's price for a plan. Both periods are in the page; the html element's data-period shows one (period.js before paint, then the switch). */
function PlanPrice({ plan, period, both }) {
  const price = period === 'yearly' ? plan.yearly : plan.monthly;
  const per = period === 'yearly' ? 'a year' : 'a month';
  return (
    <div className={both ? `when-${period}` : undefined}>
      {price ? (
        <>
          <p className="plan-price">
            <span className="plan-amount">{inr(price.basePrice)}</span> <span className="small">{per}</span>
          </p>
          <p className="small plan-terms">
            Includes {plan.includedUnits} {unitWord(plan.unit, plan.includedUnits)}
            {price.extraUnitPrice ? `, then ${inr(price.extraUnitPrice)} ${per} for each extra ${unitWord(plan.unit, 1)}.` : `. Extra ${unitWord(plan.unit, 2)} are free.`}
            {period === 'yearly' && price.saving ? ` ${inr(price.saving)} less than paying monthly.` : ''}
          </p>
        </>
      ) : (
        <p className="small plan-terms">Not offered {period === 'yearly' ? 'yearly' : 'monthly'}.</p>
      )}
    </div>
  );
}

function Plan({ plan, periods }) {
  return (
    <li className={`plan${plan.highlight ? ' plan--lead' : ''}`}>
      <h3 className="h-3">{plan.name}</h3>
      {plan.description ? <p className="small">{plan.description}</p> : null}
      {periods.map((p) => (
        <PlanPrice key={p} plan={plan} period={p} both={periods.length > 1} />
      ))}
      <div className="actions plan-actions">
        {plan.trialDays ? (
          <a className={`btn ${plan.highlight ? 'btn--primary' : 'btn--trial'}`} href={trialUrl(plan)}>
            Start free trial
          </a>
        ) : null}
        <Link className="btn btn--text" href={demoFor(slugOf(plan.apps[0]) || '')}>
          Request a demo
        </Link>
      </div>
      {plan.trialDays ? <p className="caption">{plan.trialDays}-day free trial.</p> : null}
    </li>
  );
}

export default function Pricing() {
  const pricing = usePricing();
  /* Which products are on sale comes from the operator console's app catalogue (catalogue.js). */
  const products = useProducts();
  const hasYearly = Boolean(pricing?.plans.some((p) => p.yearly));
  const hasMonthly = Boolean(pricing?.plans.some((p) => p.monthly));
  /*
   * ?period=yearly opens the yearly prices, and the switch writes it back, so a shared link shows what was seen.
   * Read before the first render in the browser; the prerendered page has both periods and period.js picks one before paint.
   */
  const [chosen, setChosen] = useState(() => (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('period') === 'yearly' ? 'yearly' : 'monthly'));
  const search = useSearch();
  /* An in-page link to another ?period= is heard too; on the next frame, not inside the effect. */
  useEffect(() => {
    if (!search) return undefined;
    const want = new URLSearchParams(search).get('period') === 'yearly' ? 'yearly' : 'monthly';
    const frame = requestAnimationFrame(() => setChosen(want));
    return () => cancelAnimationFrame(frame);
  }, [search]);
  const setPeriod = (p) => {
    setChosen(p);
    const q = new URLSearchParams(window.location.search);
    if (p === 'yearly') q.set('period', 'yearly');
    else q.delete('period');
    const s = q.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${s ? `?${s}` : ''}`);
  };
  const period = hasMonthly ? chosen : 'yearly';
  /* Both periods on sale: both are rendered and the html element shows one, before the paint. */
  const periods = hasMonthly && hasYearly ? ['monthly', 'yearly'] : [hasMonthly ? 'monthly' : 'yearly'];
  useLayoutEffect(() => {
    const html = document.documentElement;
    if (period === 'yearly') html.dataset.period = 'yearly';
    else delete html.dataset.period;
    return () => {
      delete html.dataset.period;
    };
  }, [period]);
  const plans = pricing?.plans || [];
  const groups = products.filter((p) => p.status === 'available')
    .map((product) => ({ product, plans: plans.filter((pl) => pl.apps.length === 1 && pl.apps[0] === appIdFor(product.slug)) }))
    .filter((g) => g.plans.length);
  const bundles = plans.filter((pl) => !groups.some((g) => g.plans.includes(pl)));
  const soon = products.filter((p) => p.status === 'soon');

  return (
    <>
      <PageHead eyebrow="Pricing" title="Pay for the products you use." intro="Every CLOR product has its own subscription. A company that needs only payroll pays only for payroll, and you can add a product later without changing the plans you have." />
      {plans.length ? (
        <section className="section section--tight">
          <div className="wrap stack" style={{ '--stack': 'var(--s-6)' }}>
            <div className="price-head">
              {hasMonthly && hasYearly ? (
                <div className="period" role="group" aria-label="Billing period">
                  {['monthly', 'yearly'].map((p) => (
                    <button key={p} type="button" className="period-btn" aria-pressed={period === p} onClick={() => setPeriod(p)}>
                      {p === 'monthly' ? 'Monthly' : 'Yearly'}
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="small">{pricing.gst.note}</p>
              {provisional(pricing) ? <p className="small price-provisional">Prices are being finalised.</p> : null}
            </div>
            {groups.map(({ product, plans: list }) => (
              <section key={product.slug} className="price-group" aria-labelledby={`price-${product.slug}`}>
                <div className="price-group-head">
                  <Mark product={product} size={32} />
                  <div>
                    <h2 id={`price-${product.slug}`} className="h-3">
                      <ProductName name={product.name} />
                    </h2>
                    <p className="small">{product.line}</p>
                  </div>
                </div>
                <ul className="plans">
                  {list.map((pl) => (
                    <Plan key={pl.code} plan={pl} periods={periods} />
                  ))}
                </ul>
              </section>
            ))}
            {bundles.length ? (
              <section className="price-group" aria-labelledby="price-bundles">
                <div className="price-group-head">
                  <div>
                    <h2 id="price-bundles" className="h-3">
                      Products together
                    </h2>
                    <p className="small">One plan for more than one product.</p>
                  </div>
                </div>
                <ul className="plans">
                  {bundles.map((pl) => (
                    <Plan key={pl.code} plan={pl} periods={periods} />
                  ))}
                </ul>
              </section>
            ) : null}
            {soon.length ? (
              <p className="small">
                Coming soon: {soon.map((p) => `CLOR ${p.name}`).join(' and ')}. <Link className="text-link" href="/contact?about=projects">Ask to hear when they are ready</Link>
              </p>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="section section--tight">
          <div className="wrap stack" style={{ '--stack': 'var(--s-5)' }}>
            <p className="lede">We have not published prices yet. Request a demo and we will quote for your company.</p>
            <div className="actions">
              <Link className="btn btn--primary" href={SITE.demoUrl}>
                Request a demo
              </Link>
              <a className="btn btn--trial" href={SITE.startUrl}>
                Start free trial
              </a>
              <Link className="btn btn--text" href="/contact?about=pricing">
                Ask about pricing
              </Link>
            </div>
          </div>
        </section>
      )}
      <section className="section">
        <div className="wrap">
          <Faq
            title="How subscriptions work"
            items={[
              ['Is there one plan for everything?', 'No. You can subscribe to each product on its own, for the companies in your account that use it.'],
              ['What happens to my data if I stop a product?', 'The data stays in your account and can be exported. Switching the product back on brings it back.'],
              ['Do employees count as users?', 'Employees who use only the employee app are not counted as users. Plans priced per employee count everyone on the payroll or in People.'],
            ]}
          />
        </div>
      </section>
      <Closing />
    </>
  );
}
