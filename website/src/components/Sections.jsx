import React from 'react';
import { Link } from '../router.jsx';
import { Buildings, Check, LockKey, PaperPlaneTilt, ShieldCheck, ToggleRight, UserFocus } from '@phosphor-icons/react';
import { PRODUCTS } from '../site.js';
import { Mark, ProductName } from './Brand.jsx';

/*
 * Sections the home page and every product page share, so they stay word for
 * word the same: the section head, Setting up, and Where your data lives.
 */

/** A section's title and its line under the title. */
export function Head({ title, intro, id, eyebrow }) {
  return (
    <div className="head">
      {eyebrow ? <p className="fx-eyebrow">{eyebrow}</p> : null}
      <h2 className="h-1" id={id}>
        {title}
      </h2>
      {intro ? <p className="lede">{intro}</p> : null}
    </div>
  );
}

/** A small icon tile in the brand orange. */
function Tile({ icon: Icon }) {
  return (
    <span className="tile" aria-hidden="true">
      <Icon size={22} weight="duotone" />
    </span>
  );
}

const SWITCH_ON = ['books', 'people', 'payroll', 'attendance'];
const TEAM = [
  ['RK', 'Accountant', '#232A66'],
  ['MS', 'HR', '#C93F28'],
  ['AP', 'Staff', '#0079BF'],
];

/**
 * How a company gets going, as three small moving pictures: the company form
 * filling itself in, the products switching on one by one, the team arriving.
 * Each plays in a loop; under reduced motion each shows its finished state.
 */
export function SettingUp() {
  return (
    <section className="section" aria-labelledby="setup-title">
      <div className="wrap">
        <Head id="setup-title" title="Setting up" intro="Most of it is one form. Add the company, switch on what you bought, invite your people." />
        <ol className="setup">
          <li className="setup-step">
            <div className="setup-art" aria-hidden="true">
              <div className="sf">
                <span className="sf-label">Company name</span>
                <span className="sf-field"><span className="sf-type sf-type--1">CLOR Applications Private Limited</span></span>
                <span className="sf-label">GSTIN</span>
                <span className="sf-field"><span className="sf-type sf-type--2">29AAACA1234F1Z5</span></span>
                <span className="sf-ok"><Check size={12} weight="bold" /> Saved</span>
              </div>
            </div>
            <div className="setup-copy">
              <Tile icon={Buildings} />
              <h3 className="h-3">Add the company</h3>
              <p className="body">Its name, address and GSTIN. Branches can come later.</p>
            </div>
          </li>
          <li className="setup-step">
            <div className="setup-art" aria-hidden="true">
              <ul className="sw">
                {SWITCH_ON.map((slug, i) => {
                  const p = PRODUCTS.find((x) => x.slug === slug);
                  return (
                    <li key={slug} style={{ '--i': i, '--app': p.accent }}>
                      <Mark product={p} size={26} />
                      <ProductName name={p.name} />
                      <span className="sw-toggle"><span /></span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="setup-copy">
              <Tile icon={ToggleRight} />
              <h3 className="h-3">Switch on your products</h3>
              <p className="body">Only the ones you bought. Add the rest whenever you like.</p>
            </div>
          </li>
          <li className="setup-step">
            <div className="setup-art" aria-hidden="true">
              <ul className="tm">
                {TEAM.map(([ini, role, col], i) => (
                  <li key={ini} style={{ '--i': i }}>
                    <span className="tm-av" style={{ background: col }}>{ini}</span>
                    <span className="tm-role">{role}</span>
                    <span className="tm-ok"><Check size={11} weight="bold" /></span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="setup-copy">
              <Tile icon={PaperPlaneTilt} />
              <h3 className="h-3">Invite your team</h3>
              <p className="body">Your accountant and your staff, each with their own login.</p>
            </div>
          </li>
        </ol>
        <p className="setup-tally">
          <strong>Coming from Tally?</strong> Masters and opening balances import directly, and the on-site connector keeps Tally in step while you move. Employee lists come in from a
          spreadsheet, with a preview before anything is saved.
        </p>
      </div>
    </section>
  );
}

/** Where the data is kept, said plainly on the page ground. */
export function TrustBand() {
  return (
    <section className="section" aria-labelledby="trust-title">
      <div className="wrap split">
        <Head id="trust-title" title="Where your data lives" />
        <div className="stack">
          <p className="lede">
            Your records are kept in Google Cloud’s Mumbai region. One company can never see another’s, and you can export everything at any time.
          </p>
          <ul className="icon-facts">
            <li>
              <Tile icon={ShieldCheck} />
              <p className="body">Each company’s records are walled off from every other company on CLOR, in the database itself.</p>
            </li>
            <li>
              <Tile icon={UserFocus} />
              <p className="body">Every user sees only the companies, branches and products you gave them, and every change is written to an audit trail with their name on it.</p>
            </li>
            <li>
              <Tile icon={LockKey} />
              <p className="body">Changing salary bank details or closing a company can need a second person’s approval or a fresh authenticator code.</p>
            </li>
          </ul>
          <Link className="text-link" href="/security">
            How CLOR keeps your data safe
          </Link>
        </div>
      </div>
    </section>
  );
}
