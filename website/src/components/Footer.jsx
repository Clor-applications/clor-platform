import React from 'react';
import { Link } from '../router.jsx';
import { NAV, PRODUCTS, SITE } from '../site.js';
import { Logo } from './Brand.jsx';
import { DOORS } from './Nav.jsx';

/*
 * The footer carries every page the header does not: the products, the
 * solutions and guides, the company pages, the two sign-in doors and the
 * policies a payment provider looks for. The address is printed in full.
 */
export default function Footer() {
  const cols = [
    ['Products', [...PRODUCTS.map((p) => ({ href: `/products/${p.slug}`, name: `CLOR\u00a0${p.name}` })), { href: '/pricing', name: 'Pricing' }]],
    ['For', [...NAV.solutions, { href: '/integrations', name: 'Integrations' }, { href: '/resources', name: 'Guides' }, { href: '/security', name: 'Security' }]],
    ['Company', [...NAV.company, { href: SITE.demoUrl, name: 'Request a demo' }, ...DOORS.map((d) => ({ href: d.href, name: d.name }))]],
    [
      'Policies',
      [
        { href: '/legal/terms', name: 'Terms of service' },
        { href: '/legal/privacy', name: 'Privacy notice' },
        { href: '/legal/refund', name: 'Refund and cancellation' },
        { href: '/legal/delivery', name: 'Delivery policy' },
        { href: '/legal/cookies', name: 'Cookies' },
      ],
    ],
  ];
  return (
    <footer className="footer">
      <div className="wrap footer-grid">
        <div className="footer-brand">
          <Logo height={20} lazy />
          <p className="small">Accounts, GST, staff and salaries for companies in India. Your data is kept in {SITE.hosting}.</p>
          <ul className="footer-mail">
            {[
              ['General', SITE.contactEmail],
              ['Sales', SITE.salesEmail],
              ['Support', SITE.supportEmail],
            ].map(([k, v]) => (
              <li key={v}>
                <span className="caption">{k}</span> <a href={`mailto:${v}`}>{v}</a>
              </li>
            ))}
          </ul>
        </div>
        {cols.map(([title, items]) => (
          <nav key={title} className="footer-col" aria-label={title}>
            <p className="footer-title">{title}</p>
            <ul>
              {items.map((i) => (
                <li key={i.href}>
                  <Link href={i.href}>{i.name}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="wrap footer-base">
        <p className="caption">
          © <span suppressHydrationWarning>{new Date().getFullYear()}</span> {SITE.company}
          <br />
          {SITE.address}
        </p>
        <p className="caption">Pictures by unDraw, recoloured. Made in India.</p>
      </div>
    </footer>
  );
}
