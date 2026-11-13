import React from 'react';
import { Link } from '../router.jsx';
import { NAV, SITE } from '../site.js';
import { useProducts } from '../catalogue.js';
import { Globe } from '@phosphor-icons/react';
import { Logo } from './Brand.jsx';

export default function Footer() {
  const PRODUCTS = useProducts();
  /* Laid out after Azure's footer (owner, 13 Nov 2026): light grey ground,
   * larger column titles, legal links moved to one line along the bottom. */
  const cols = [
    ['Products', [{ href: '/products', name: 'All products' }, ...PRODUCTS.map((p) => ({ href: `/products/${p.slug}`, name: `CLOR\u00a0${p.name}` }))]],
    ['Solutions', [...NAV.solutions, { href: '/pricing', name: 'Pricing' }, { href: '/demo', name: 'Request a demo' }]],
    ['Resources', [...NAV.resources, { href: '/status', name: 'Status' }]],
    ['Company', NAV.company],
    [
      'Talk to us',
      [
        { href: `mailto:${SITE.salesEmail}`, name: `Sales: ${SITE.salesEmail}`, mail: true },
        { href: `mailto:${SITE.supportEmail}`, name: `Support: ${SITE.supportEmail}`, mail: true },
        { href: `mailto:${SITE.contactEmail}`, name: `General: ${SITE.contactEmail}`, mail: true },
      ],
    ],
  ];
  const legal = [
    ['/legal/privacy', 'Privacy'],
    ['/legal/terms', 'Terms'],
    ['/legal/dpa', 'Data processing'],
    ['/legal/cookies', 'Cookies'],
    ['/legal/refund', 'Refunds'],
    ['/legal/delivery', 'Delivery'],
  ];
  return (
    <footer className="footer footer--az">
      <div className="wrap footer-top">
        <Logo height={22} lazy />
        <p className="small">Accounting, HR, attendance and payroll for Indian companies. Your data is kept in {SITE.hosting}.</p>
      </div>
      <div className="wrap footer-grid">
        {cols.map(([title, items]) => (
          <nav key={title} className="footer-col" aria-label={title}>
            <p className="footer-title">{title}</p>
            <ul>
              {items.map((i) => (
                <li key={i.href}>{i.mail ? <a href={i.href}>{i.name}</a> : <Link href={i.href}>{i.name}</Link>}</li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="wrap footer-base">
        <p className="footer-locale">
          <Globe size={22} weight="light" aria-hidden="true" /> India (English)
        </p>
        <ul className="footer-legal-links">
          {legal.map(([href, name]) => (
            <li key={href}>
              <Link href={href}>{name}</Link>
            </li>
          ))}
          <li className="footer-copy">
            © <span suppressHydrationWarning>{new Date().getFullYear()}</span> {SITE.company}
          </li>
        </ul>
        <p className="footer-address caption">{SITE.address}</p>
      </div>
    </footer>
  );
}
