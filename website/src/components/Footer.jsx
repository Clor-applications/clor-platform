import React from 'react';
import { Link } from '../router.jsx';
import { NAV, PRODUCTS, SITE } from '../site.js';
import { Logo } from './Brand.jsx';

export default function Footer() {
  const cols = [
    ['Products', [{ href: '/products', name: 'All products' }, ...PRODUCTS.map((p) => ({ href: `/products/${p.slug}`, name: `Clor ${p.name}` }))]],
    ['Solutions', NAV.solutions],
    ['Resources', [...NAV.resources, { href: '/pricing', name: 'Pricing' }]],
    ['Company', [...NAV.company, { href: '/legal/privacy', name: 'Privacy' }, { href: '/legal/terms', name: 'Terms' }, { href: '/legal/cookies', name: 'Cookies' }]],
  ];
  return (
    <footer className="footer">
      <div className="wrap footer-grid">
        <div className="footer-brand">
          <Logo height={20} />
          <p className="small">Business software for Indian companies: accounting, people, payroll and attendance, in one workspace.</p>
          <p className="small">
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
          </p>
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
          © {new Date().getFullYear()} {SITE.company}
        </p>
        <p className="caption">Made in India</p>
      </div>
    </footer>
  );
}
