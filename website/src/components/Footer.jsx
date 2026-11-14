import React from 'react';
import { EnvelopeSimple, MapPin } from '@phosphor-icons/react';
import { Link } from '../router.jsx';
import { NAV, SITE } from '../site.js';
import { useProducts } from '../catalogue.js';
import { Logo, Mark, ProductName } from './Brand.jsx';

/*
 * The footer (13 Nov 2026): the brand, where we are and how to write to us
 * on the left; then five short columns of the same weight, the company's
 * pages and the legal pages apart. One line closes it.
 */
const LEGAL = [
  { href: '/legal/privacy', name: 'Privacy' },
  { href: '/legal/terms', name: 'Terms' },
  { href: '/legal/dpa', name: 'Data processing' },
  { href: '/legal/cookies', name: 'Cookies' },
  { href: '/legal/refund', name: 'Refunds' },
  { href: '/legal/delivery', name: 'Delivery' },
];

export default function Footer() {
  const PRODUCTS = useProducts();
  const cols = [
    ['Solutions', NAV.solutions],
    ['Resources', [...NAV.resources, { href: '/pricing', name: 'Pricing' }]],
    ['Company', [...NAV.company, { href: '/status', name: 'Status' }]],
    ['Legal', LEGAL],
  ];
  const mail = [
    ['General', SITE.contactEmail],
    ['Sales', SITE.salesEmail],
    ['Support', SITE.supportEmail],
  ];
  return (
    <footer className="footer ft">
      <div className="wrap ft-grid">
        <div className="ft-brand">
          <Logo height={24} lazy light />
          <p className="ft-line">Accounting, HR, attendance and payroll for Indian companies. Your data is kept in {SITE.hosting}.</p>
          <ul className="ft-mail">
            {mail.map(([k, v]) => (
              <li key={v}>
                <EnvelopeSimple size={16} aria-hidden="true" />
                <span>{k}</span>
                <a href={`mailto:${v}`}>{v}</a>
              </li>
            ))}
          </ul>
        </div>
        <nav className="ft-col" aria-label="Products">
          <p className="ft-title">Products</p>
          <ul>
            {PRODUCTS.map((p) => (
              <li key={p.slug}>
                <Link href={`/products/${p.slug}`} className="ft-product">
                  <Mark product={p} size={20} /> <ProductName name={p.name} />
                </Link>
              </li>
            ))}
            <li>
              <Link href="/products">All products</Link>
            </li>
          </ul>
        </nav>
        {cols.map(([title, items]) => (
          <nav key={title} className="ft-col" aria-label={title}>
            <p className="ft-title">{title}</p>
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
      <div className="wrap ft-base">
        <p>
          © <span suppressHydrationWarning>{new Date().getFullYear()}</span> {SITE.company}
        </p>
        <p className="ft-addr">
          <MapPin size={15} aria-hidden="true" /> {SITE.address}
        </p>
        <p>Made in India</p>
      </div>
    </footer>
  );
}
