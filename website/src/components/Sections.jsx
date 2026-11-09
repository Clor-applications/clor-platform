import React from 'react';
import { Link } from '../router.jsx';

/*
 * Sections the home page and every product page share, so they stay word for
 * word the same: the section head, Setting up, and Where your data lives.
 */

/** A section's title and its line under the title. */
export function Head({ title, intro, id }) {
  return (
    <div className="head">
      <h2 className="h-1" id={id}>
        {title}
      </h2>
      {intro ? <p className="lede">{intro}</p> : null}
    </div>
  );
}

/** How a company gets going: one sentence, no numbered steps. */
export function SettingUp() {
  return (
    <section className="section" aria-labelledby="setup-title">
      <div className="wrap split">
        <Head id="setup-title" title="Setting up" />
        <div className="stack">
          <p className="lede">
            Add the company with its name, address and GSTIN, switch on the products you bought, then invite your accountant and your staff, each with their own login. Most of it is one
            form.
          </p>
          <p className="body">
            Coming from Tally? Masters and opening balances import directly, and the on-site connector can keep Tally in step while you move. Employee lists come in from a spreadsheet, with a
            preview before anything is saved.
          </p>
        </div>
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
          <ul className="facts-list">
            <li>Each company’s records are walled off from every other company on CLOR, in the database itself.</li>
            <li>Every user sees only the companies, branches and products you gave them, and every change is written to an audit trail with their name on it.</li>
            <li>Changing salary bank details or closing a company can need a second person’s approval or a fresh authenticator code.</li>
          </ul>
          <Link className="text-link" href="/security">
            How CLOR keeps your data safe
          </Link>
        </div>
      </div>
    </section>
  );
}
