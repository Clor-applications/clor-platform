import React from 'react';
import { Link } from '../router.jsx';
import { NAV, SITE } from '../site.js';
import { useProducts } from '../catalogue.js';
import { Logo } from './Brand.jsx';

export default function Footer() {
  const PRODUCTS = useProducts();
  const cols = [
    ['Products', [{ href: '/products', name: 'All products' }, ...PRODUCTS.map((p) => ({ href: `/products/${p.slug}`, name: `CLOR\u00a0${p.name}` }))]],
    ['Solutions', NAV.solutions],
    ['Resources', [...NAV.resources, { href: '/pricing', name: 'Pricing' }]],
    ['Company', [...NAV.company, { href: '/legal/privacy', name: 'Privacy' }, { href: '/legal/terms', name: 'Terms' }, { href: '/legal/cookies', name: 'Cookies' }, { href: '/legal/refund', name: 'Refunds' }, { href: '/legal/delivery', name: 'Delivery' }]],
  ];
  return (
    <footer className="footer">
      <div className="wrap footer-grid">
        <div className="footer-brand">
          <Logo height={20} lazy light />
          <p className="small">Accounting, HR, attendance and payroll for Indian companies. Your data is kept in {SITE.hosting}.</p>
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
        {/* The inboxes, side by side along the bottom (owner, 10 Nov 2026). */}
        <ul className="footer-mail footer-mail--row">
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
        <div className="footer-legal">
          <p className="caption">
            © <span suppressHydrationWarning>{new Date().getFullYear()}</span> {SITE.company} · {SITE.address}
          </p>
          <p className="caption">Made in India</p>
        </div>
      </div>
    </footer>
  );
}
