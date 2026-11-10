import React from 'react';
import { PRODUCTS, SITE } from './site.js';
import { PRODUCT_CONTENT } from './content.js';
import Home from './pages/Home.jsx';
import Demo from './pages/Demo.jsx';
import Product, { Products } from './pages/Product.jsx';
import { About, Businesses, Contact, Firms, Integrations, Legal, NotFound, Pricing, Resources, Security } from './pages/Pages.jsx';

/** Every page: its address, title, description and component. The sitemap is made from this list. */
export const ROUTES = [
  { path: '/', title: 'CLOR: accounting, HR and payroll for Indian companies', description: 'GST invoicing and accounts, employee records, attendance from biometric readers, and payroll with PF, ESI and TDS, for Indian companies. Use one CLOR product or several.', page: () => <Home /> },
  { path: '/products', title: 'Products', description: 'CLOR Books, Payroll, People and Attendance, with Projects and Timesheet on the way. Buy only the ones you need.', page: () => <Products /> },
  ...PRODUCTS.map((p) => ({
    path: `/products/${p.slug}`,
    title: `CLOR ${p.name}${p.status === 'soon' ? ' (coming soon)' : ''}`,
    description: p.status === 'soon' ? PRODUCT_CONTENT[p.slug].intro : `${p.line} ${PRODUCT_CONTENT[p.slug].intro}`.slice(0, 300),
    page: () => <Product slug={p.slug} />,
  })),
  { path: '/solutions/businesses', title: 'CLOR for businesses', description: 'GST invoices, staff records, attendance and salaries for small Indian companies, under one login.', page: () => <Businesses /> },
  { path: '/solutions/accounting-firms', title: 'CLOR for accounting firms', description: 'Work in your clients’ CLOR books with your own login and the access they give you.', page: () => <Firms /> },
  { path: '/pricing', title: 'Pricing', description: 'Each CLOR product has its own subscription: pay for the products you use.', page: () => <Pricing /> },
  { path: '/integrations', title: 'Integrations', description: 'Biometric readers, Tally, HR tools, single sign-on, SCIM, the API, UPI and GST e-invoicing.', page: () => <Integrations /> },
  { path: '/resources', title: 'Guides', description: 'How to set up readers, the on-site connector, Tally, HR tools, single sign-on and directory sync.', page: () => <Resources /> },
  { path: '/company/about', title: 'About', description: `${SITE.company} makes CLOR in Bengaluru: accounting, HR, payroll and attendance on one set of records.`, page: () => <About /> },
  { path: '/demo', title: 'Request a demo', description: 'Tell us about your company and the CLOR apps you want to see. We call within one working day to set up a demo.', page: () => <Demo /> },
  { path: '/contact', title: 'Contact', description: 'Write to the CLOR team about your business, pricing or CLOR for accounting firms.', page: () => <Contact /> },
  { path: '/security', title: 'Security', description: 'How CLOR keeps each company’s data apart and safe: Mumbai hosting, sign-in, second approvals, audit trail and export.', page: () => <Security /> },
  { path: '/legal/privacy', title: 'Privacy notice', description: 'What CLOR collects, why, who else sees it, how long it is kept, and your rights.', page: () => <Legal doc="privacy" /> },
  { path: '/legal/terms', title: 'Terms of service', description: 'The agreement between your company and Clor Applications Pvt Ltd for using CLOR: accounts, fees, your data, and how either side can end it.', page: () => <Legal doc="terms" /> },
  { path: '/legal/refund', title: 'Refund and cancellation', description: 'How CLOR subscriptions are billed, how to cancel a product or a company, and when a payment is refunded.', page: () => <Legal doc="refund" /> },
  { path: '/legal/delivery', title: 'Delivery policy', description: 'How you receive CLOR after you sign up or pay: by email, with nothing shipped.', page: () => <Legal doc="delivery" /> },
  { path: '/legal/cookies', title: 'Cookies and browser storage', description: 'The cookies and browser storage CLOR uses to keep you signed in and remember your choices, and how to clear them.', page: () => <Legal doc="cookies" /> },
];

export const NOT_FOUND = { path: '/404', title: 'Page not found', description: 'This page isn’t here.', page: () => <NotFound />, noindex: true };

export const routeFor = (path) => ROUTES.find((r) => r.path === path) || NOT_FOUND;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The <head> for a page: title, description, canonical and sharing tags. */
/** The tab title: the home page's own, every other page's followed by the brand. */
export const titleFor = (r) => (r.path === '/' || r.title.startsWith('CLOR') ? r.title : `${r.title} | CLOR`);

export function headFor(path) {
  const r = routeFor(path);
  const title = titleFor(r);
  const url = `${SITE.url}${r.path === '/' ? '/' : r.path}`;
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(r.description)}" />`,
    r.noindex ? '<meta name="robots" content="noindex" />' : `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="CLOR" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(r.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${SITE.url}/brand/og.png" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join('\n    ');
}
