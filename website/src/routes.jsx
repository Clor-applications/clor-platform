import React from 'react';
import { PRODUCTS, SITE } from './site.js';
import { PRODUCT_CONTENT } from './content.js';
import Home from './pages/Home.jsx';
import Product, { Products } from './pages/Product.jsx';
import { About, Businesses, Contact, Firms, Integrations, Legal, NotFound, Pricing, Resources, Security } from './pages/Pages.jsx';

/** Every page: its address, title, description and component. The sitemap is made from this list. */
export const ROUTES = [
  { path: '/', title: 'Clor — business software for Indian companies', description: 'Accounting, HR, payroll and attendance for Indian businesses. Use one Clor product or several; they share one workspace and one set of records.', page: () => <Home /> },
  { path: '/products', title: 'Products', description: 'Clor Books, People, Payroll and Attendance, with Projects and Timesheet on the way. Choose the products you need.', page: () => <Products /> },
  ...PRODUCTS.map((p) => ({
    path: `/products/${p.slug}`,
    title: `Clor ${p.name}${p.status === 'soon' ? ' (coming soon)' : ''}`,
    description: p.status === 'soon' ? PRODUCT_CONTENT[p.slug].intro : `${p.line} ${PRODUCT_CONTENT[p.slug].intro}`.slice(0, 300),
    page: () => <Product slug={p.slug} />,
  })),
  { path: '/solutions/businesses', title: 'Clor for businesses', description: 'Accounts, people and payroll in one place for small and mid-sized Indian companies.', page: () => <Businesses /> },
  { path: '/solutions/accounting-firms', title: 'Clor for accounting firms', description: 'Work in your clients’ Clor books with your own login and the access they give you.', page: () => <Firms /> },
  { path: '/pricing', title: 'Pricing', description: 'Each Clor product has its own subscription: pay for the products you use.', page: () => <Pricing /> },
  { path: '/integrations', title: 'Integrations', description: 'Biometric readers, Tally, HR tools, single sign-on, SCIM, the API, UPI and GST e-invoicing.', page: () => <Integrations /> },
  { path: '/resources', title: 'Guides', description: 'How to set up readers, the on-site connector, Tally, HR tools, single sign-on and directory sync.', page: () => <Resources /> },
  { path: '/company/about', title: 'About Clor', description: `${SITE.company} builds Clor: accounting, HR, payroll and attendance on one set of records.`, page: () => <About /> },
  { path: '/contact', title: 'Contact', description: 'Talk to the Clor team about your business.', page: () => <Contact /> },
  { path: '/security', title: 'Security', description: 'How Clor keeps each company’s data apart and safe.', page: () => <Security /> },
  { path: '/legal/privacy', title: 'Privacy notice', description: 'What Clor collects, why, who else sees it, how long it is kept, and your rights.', page: () => <Legal doc="privacy" /> },
  { path: '/legal/terms', title: 'Terms of service', description: 'The agreement for using Clor.', page: () => <Legal doc="terms" /> },
  { path: '/legal/cookies', title: 'Cookies and browser storage', description: 'What Clor keeps in your browser, and why.', page: () => <Legal doc="cookies" /> },
];

export const NOT_FOUND = { path: '/404', title: 'Page not found', description: 'This page isn’t here.', page: () => <NotFound />, noindex: true };

export const routeFor = (path) => ROUTES.find((r) => r.path === path) || NOT_FOUND;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The <head> for a page: title, description, canonical and sharing tags. */
export function headFor(path) {
  const r = routeFor(path);
  const title = r.path === '/' ? r.title : `${r.title} — Clor`;
  const url = `${SITE.url}${r.path === '/' ? '/' : r.path}`;
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(r.description)}" />`,
    r.noindex ? '<meta name="robots" content="noindex" />' : `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Clor" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(r.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${SITE.url}/brand/og.png" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join('\n    ');
}
