import React, { useEffect, useState } from 'react';
import { Link } from '../router.jsx';
import { PRODUCTS, SITE, appIdFor, demoFor } from '../site.js';
import { Mark } from '../components/Brand.jsx';
import { Closing, Faq } from '../components/Blocks.jsx';
import { PageHead } from './Pages.jsx';
import { BUILT_PRICING, UNIT, inr, provisional } from '../pricing.js';

/*
 * /pricing: the plans published in the operator console, by product, with a
 * monthly / yearly switch. Every number comes from the published price book;
 * the page holds none of its own. With nothing published it says so and
 * offers a demo instead.
 */
const unitWord = (unit, n) => (UNIT[unit] || ['unit', 'units'])[n === 1 ? 0 : 1];
const trialUrl = (plan) => `${SITE.appUrl}/signup?app=${encodeURIComponent(plan.apps[0])}&plan=${encodeURIComponent(plan.code)}`;
const slugOf = (app) => PRODUCTS.find((p) => appIdFor(p.slug) === app)?.slug;

function usePricing() {
  const [pricing, setPricing] = useState(BUILT_PRICING);
  useEffect(() => {
    let live = true;
    fetch(`${SITE.apiUrl}/public/pricing`, { headers: { Accept: 'application/json' } })
      .then(async (r) => {
        if (!live) return;
        /* Nothing published now: take the prices down. The API not answering: keep what the build saw. */
        if (r.status === 404) setPricing(null);
        else if (r.ok) {
          const body = await r.json();
          if (live && Array.isArray(body.plans)) setPricing(body);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return pricing;
}

function Plan({ plan, period }) {
  const price = period === 'yearly' ? plan.yearly : plan.monthly;
  const per = period === 'yearly' ? 'a year' : 'a month';
  return (
    <li className={`plan${plan.highlight ? ' plan--lead' : ''}`}>
      <h3 className="h-3">{plan.name}</h3>
      {plan.description ? <p className="small">{plan.description}</p> : null}
      {price ? (
        <>
          <p className="plan-price">
            <span className="plan-amount">{inr(price.basePrice)}</span> <span className="small">{per}</span>
          </p>
          <p className="small plan-terms">
            For up to {plan.includedUnits} {unitWord(plan.unit, plan.includedUnits)}
            {price.extraUnitPrice ? `, then ${inr(price.extraUnitPrice)} ${per} for each extra ${unitWord(plan.unit, 1)}.` : `. No charge for more ${unitWord(plan.unit, 2)}.`}
            {period === 'yearly' && price.saving ? ` ${inr(price.saving)} less than paying monthly.` : ''}
          </p>
        </>
      ) : (
        <p className="small plan-terms">Not offered {period === 'yearly' ? 'yearly' : 'monthly'}.</p>
      )}
      <div className="actions plan-actions">
        {plan.trialDays ? (
          <a className={`btn ${plan.highlight ? 'btn--primary' : 'btn--quiet'}`} href={trialUrl(plan)}>
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
  const hasYearly = Boolean(pricing?.plans.some((p) => p.yearly));
  const hasMonthly = Boolean(pricing?.plans.some((p) => p.monthly));
  const [chosen, setPeriod] = useState('monthly');
  const period = hasMonthly ? chosen : 'yearly';
  const plans = pricing?.plans || [];
  const groups = PRODUCTS.filter((p) => p.status === 'available')
    .map((product) => ({ product, plans: plans.filter((pl) => pl.apps.length === 1 && pl.apps[0] === appIdFor(product.slug)) }))
    .filter((g) => g.plans.length);
  const bundles = plans.filter((pl) => !groups.some((g) => g.plans.includes(pl)));
  const soon = PRODUCTS.filter((p) => p.status === 'soon');

  return (
    <>
      <PageHead title="Pay for the products you use." intro="Every CLOR product has its own subscription. A company that needs only payroll pays only for payroll, and adding a product later never means changing plans." />
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
                      CLOR {product.name}
                    </h2>
                    <p className="small">{product.line}</p>
                  </div>
                </div>
                <ul className="plans">
                  {list.map((pl) => (
                    <Plan key={pl.code} plan={pl} period={period} />
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
                    <Plan key={pl.code} plan={pl} period={period} />
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
            <p className="lede">Prices are being set now. Ask for a demo and we will tell you what your company would pay.</p>
            <div className="actions">
              <Link className="btn btn--primary" href={SITE.demoUrl}>
                Request a demo
              </Link>
              <Link className="btn btn--quiet" href="/contact?about=pricing">
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
              ['Is there one plan for everything?', 'No. Each product is subscribed to on its own, for the companies in your workspace that use it.'],
              ['What happens to my data if I stop a product?', 'The data stays in your workspace and can be exported. Switching the product back on brings it back.'],
              ['Do employees count as users?', 'Employees using only the employee app are not users who sign in. Plans counted per employee count everyone on the payroll or in People.'],
            ]}
          />
        </div>
      </section>
      <Closing />
    </>
  );
}
