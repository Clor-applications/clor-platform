import React from 'react';
import { FIELDS, operator } from '@platform/operator';

/**
 * The legal documents, written from what the code does.
 *
 * Every statement here was checked against the implementation when it was
 * written (see docs/compliance/COMPLIANCE_AUDIT.md). If the product changes
 * what it collects, sends or keeps, change these in the same commit — a
 * privacy notice that describes last year's product is a false statement.
 *
 * Nothing about the operator is invented: unknown facts render as marked
 * placeholders (operator.js). These drafts need review by a lawyer before
 * they are relied on.
 */

/** An operator fact, or a visible placeholder when nobody has supplied it. */
export function Fact({ field }) {
  const value = operator[field];
  if (value) return <>{value}</>;
  return <span className="legal-placeholder">[{FIELDS[field].label} — to be provided]</span>;
}

const Email = ({ field }) =>
  operator[field] ? <a className="ui-link" href={`mailto:${operator[field]}`}>{operator[field]}</a> : <Fact field={field} />;

const Section = ({ id, title, children }) => (
  <section aria-labelledby={id} className="legal-section">
    <h2 id={id}>{title}</h2>
    {children}
  </section>
);

const Operator = () => (
  <>
    <Fact field="name" />, <Fact field="address" />
    {operator.registration ? <> ({operator.registration})</> : null}
  </>
);

export const DOCUMENTS = {
  privacy: {
    title: 'Privacy notice',
    summary: 'What this service collects, why, who else sees it, how long it is kept, and your rights.',
    Body: PrivacyNotice,
  },
  terms: {
    title: 'Terms of service',
    summary: 'The agreement for using Clor.',
    Body: TermsOfService,
  },
  cookies: {
    title: 'Cookies and browser storage',
    summary: 'Everything this site keeps in your browser, and why none of it needs a consent banner.',
    Body: StorageNotice,
  },
  accessibility: {
    title: 'Accessibility',
    summary: 'The standard we work to, what we know falls short, and how to tell us.',
    Body: AccessibilityStatement,
  },
};

function PrivacyNotice() {
  return (
    <>
      <Section id="p-who" title="Who we are">
        <p>
          Clor is operated by <Operator />. In this notice &ldquo;we&rdquo; means the operator. Questions about
          your data go to <Email field="contactEmail" />; complaints go to our grievance officer,{' '}
          <Fact field="grievanceOfficer" />, at <Email field="grievanceEmail" />.
        </p>
      </Section>

      <Section id="p-roles" title="Two kinds of data, two roles">
        <p>
          <strong>Your account.</strong> Your name, email address and sign-in records are collected by us so you can
          use Clor. For these we decide why and how they are used.
        </p>
        <p>
          <strong>Your business&rsquo;s records.</strong> The customers, suppliers, employees, invoices, payments and
          other records a business keeps in Clor belong to that business. It decides what goes in and what it is used
          for; we store and process them on its behalf, to provide the service. If you are a customer, supplier or
          employee of a business that uses Clor and want to exercise your rights over those records, ask that business
          first — we will help it answer you.
        </p>
      </Section>

      <Section id="p-what" title="What we collect">
        <ul>
          <li>
            <strong>Account:</strong> name, email address, password (stored only as a one-way bcrypt hash, never in
            readable form), and — if you add them — first and last name, username, phone number and profile picture.
          </li>
          <li>
            <strong>Company set-up:</strong> company name, state, GSTIN, PAN, addresses and contact details entered by
            the business.
          </li>
          <li>
            <strong>Business records entered by users:</strong> customers and suppliers (names, GSTIN, PAN, contact
            people, email addresses, phone numbers, addresses), invoices, bills, payments, stock and accounts. Where a
            business uses Payroll: employee names and contact details, PAN, UAN, PF and ESI numbers, bank account
            number and IFSC, and salary, deduction and loan details.
          </li>
          <li>
            <strong>Sign-in and security records:</strong> for each sign-in session and each sign-in attempt
            (including failed ones), the IP address and the browser&rsquo;s identifying string (user agent), and the
            time. The IP address from which a password reset is requested. A log of changes made in each company,
            with who made them.
          </li>
          <li>
            <strong>Emails we send you:</strong> a copy of each account email (email verification, password reset,
            invitations, approval requests) is kept with its recipient and subject. Sign-in links in those copies are
            removed once the email has been sent.
          </li>
          <li>
            <strong>Server request log:</strong> the type of each request, the address requested (with share links,
            GSTINs and search terms removed), the result and the time it took.
          </li>
        </ul>
        <p>
          We do <strong>not</strong> use analytics, advertising, tracking pixels, session recording or third-party
          cookies, and we do not sell personal data or use it to build profiles.
        </p>
      </Section>

      <Section id="p-why" title="Why we use it">
        <ul>
          <li>To provide the service: keep the books, documents and reports a business asks Clor to keep.</li>
          <li>To sign you in, keep accounts secure, detect misuse and lock an account after repeated failed attempts.</li>
          <li>To send the account emails listed above. We do not send marketing email.</li>
          <li>To meet legal obligations that apply to us.</li>
        </ul>
        <p>
          By creating an account you consent to this processing of your account data. You can withdraw that consent
          by asking us to close your account (see &ldquo;Your rights&rdquo;); processing that has already happened is
          not affected, and we may need to keep some records where the law requires it.
        </p>
      </Section>

      <Section id="p-share" title="Who else receives it">
        <ul>
          <li>
            <strong>Hosting:</strong> the servers and database run with <Fact field="hosting" />.
          </li>
          <li>
            <strong>Email delivery:</strong> account emails go through an email (SMTP) server — ours, or one the
            business configures for its own company.
          </li>
          <li>
            Only when a business switches them on:
            <ul>
              <li>a GST Suvidha Provider, which receives a GSTIN being looked up;</li>
              <li>the government Invoice Registration Portal or a GST Suvidha Provider chosen by the business, which
                receives e-invoice data (both parties&rsquo; GSTINs, names and addresses, items and amounts);</li>
              <li>an AI service (TypeSafe) that suggests a role for a new user from the job title and duties an
                administrator types — no financial or customer data is sent.</li>
            </ul>
          </li>
          <li>
            Payment reminders sent over WhatsApp or email are sent from the user&rsquo;s own device and accounts, not
            by us.
          </li>
          <li>Anyone we are required by law to disclose data to.</li>
        </ul>
      </Section>

      <Section id="p-keep" title="How long we keep it">
        <ul>
          <li>Password-reset and email-verification records: deleted 7 days after they expire or are used.</li>
          <li>Ended sign-in sessions, with their IP address and browser: deleted 90 days after they end.</li>
          <li>Sign-in attempt history: <span className="legal-placeholder">[retention period to be decided by the operator]</span>.</li>
          <li>
            Account data: while the account is open, and afterwards only as long as the law requires.{' '}
            <span className="legal-placeholder">[period after closure to be decided by the operator]</span>
          </li>
          <li>
            Business records: as the business instructs. Tax and company law can require a business to keep its
            accounting records for several years; that obligation is the business&rsquo;s.
          </li>
          <li>Backups: overwritten on a rolling basis (the most recent 30 daily copies by default).</li>
        </ul>
      </Section>

      <Section id="p-security" title="How we protect it">
        <p>
          Passwords are stored as bcrypt hashes. The long-lived sign-in token is kept in a cookie scripts cannot read,
          and if an old copy of it is ever replayed, every session on the account is signed out. Stored credentials for email servers and
          e-invoice portals are encrypted (AES-256-GCM). Access inside a company is limited by roles and permissions,
          and changes are logged. Payroll bank account numbers and PAN are masked from people without permission to
          see them. Repeated failed sign-ins lock the account for a time. Backup files are readable only by the
          server&rsquo;s administrator.
        </p>
        <p>
          No system is perfectly secure. If a breach affects your personal data, we will tell you and the Data
          Protection Board of India as the law requires.
        </p>
      </Section>

      <Section id="p-rights" title="Your rights">
        <ul>
          <li>
            <strong>See your data:</strong> download everything held about your account from <em>Profile → Your data
            and privacy</em>. A businessA business can export its own records from <em>Account → Data backup</em>.rsquo;s administrator can export the companyA business can export its own records from <em>Account → Data backup</em>.rsquo;s records from <em>Settings → Backup</em>.
          </li>
          <li>
            <strong>Correct it:</strong> edit your name, username, phone and picture in your profile; ask us, or your
            company&rsquo;s administrator, to change your email address.
          </li>
          <li>
            <strong>Erase it / withdraw consent:</strong> write to <Email field="grievanceEmail" />. Closing an account
            is not yet self-service; we will act on the request within the time the law allows and tell you what, if
            anything, must be kept and why.
          </li>
          <li>
            <strong>Nominate someone</strong> to exercise these rights if you die or become unable to: write to us.
          </li>
          <li>
            <strong>Complain:</strong> to our grievance officer first (above). If you are not satisfied, you may
            complain to the Data Protection Board of India.
          </li>
        </ul>
      </Section>

      <Section id="p-children" title="Children">
        <p>Clor is a tool for businesses and is not meant for anyone under 18. We do not knowingly create accounts for children.</p>
      </Section>

      <Section id="p-changes" title="Changes to this notice">
        <p>
          We will post any change here with a new effective date, and tell account holders by email before a change
          that affects how their data is used.
        </p>
      </Section>
    </>
  );
}

function TermsOfService() {
  return (
    <>
      <Section id="t-agreement" title="The agreement">
        <p>
          These terms are between you and <Operator /> (&ldquo;we&rdquo;). By creating an account or using Clor you
          accept them. If you use Clor for a business, you accept them for that business and confirm you may do so.
        </p>
      </Section>

      <Section id="t-service" title="The service">
        <p>
          Clor is software for accounting, GST invoicing and returns, inventory, point of sale and payroll. Apps
          marked &ldquo;Coming&rdquo; are not available yet. We may change, add or remove features; we will give
          notice before removing something a business depends on.
        </p>
        <p>
          Clor helps you prepare records and returns; it does not give tax, legal or accounting advice. You are
          responsible for checking what you file and for meeting your own tax and legal obligations.
        </p>
      </Section>

      <Section id="t-fees" title="Fees">
        <p>
          <span className="legal-placeholder">[Fees, billing and any refund or cancellation terms — to be decided by the operator. Clor does not currently charge for use or take payments.]</span>
        </p>
      </Section>

      <Section id="t-accounts" title="Your account">
        <ul>
          <li>Give accurate details and keep your password to yourself. You are responsible for what is done with your account.</li>
          <li>Tell us at once at <Email field="contactEmail" /> if you think someone else has used it.</li>
          <li>Administrators of a company decide who has access to it and what they may do.</li>
        </ul>
      </Section>

      <Section id="t-use" title="Acceptable use">
        <p>You must not:</p>
        <ul>
          <li>break the law with Clor, including by issuing false invoices or misreporting tax;</li>
          <li>enter personal data you have no right to process;</li>
          <li>try to reach data or accounts that are not yours, or test, probe or overload the service without our written permission;</li>
          <li>copy, resell or reverse-engineer the service except where the law allows it.</li>
        </ul>
      </Section>

      <Section id="t-data" title="Your data">
        <p>
          The records you enter are yours. You give us permission to store and process them only to provide the
          service, as described in the <a className="ui-link" href="#/legal/privacy">privacy notice</a>. You can export
          a company&rsquo;s records at any time.
        </p>
      </Section>

      <Section id="t-third" title="Services run by others">
        <p>
          Some features connect to services we do not run — the e-invoice portal, GST Suvidha Providers, email
          servers, WhatsApp. Their availability and terms are theirs.
        </p>
      </Section>

      <Section id="t-ip" title="Our software">
        <p>The software, its design and the Clor name remain ours or our licensors&rsquo;. These terms do not transfer them to you.</p>
      </Section>

      <Section id="t-availability" title="Availability">
        <p>We work to keep Clor available and your data backed up, but we do not promise it will be uninterrupted or error-free.</p>
      </Section>

      <Section id="t-ending" title="Suspension and ending">
        <p>
          You may stop using Clor at any time. We may suspend or close an account that breaks these terms or puts the
          service or others at risk, with notice where we reasonably can. Before a business&rsquo;s account is closed
          we will give it a reasonable chance to export its records.
        </p>
      </Section>

      <Section id="t-liability" title="Liability">
        <p>
          <span className="legal-placeholder">[Limitation of liability, exclusions and any cap — to be drafted with legal advice.]</span>{' '}
          Nothing in these terms limits liability that cannot be limited by law.
        </p>
      </Section>

      <Section id="t-law" title="Law and disputes">
        <p>These terms are governed by the laws of India. Disputes go to the courts at <Fact field="governingLaw" />.</p>
      </Section>

      <Section id="t-changes" title="Changes">
        <p>We will post changes here with a new effective date and tell account holders before a change that reduces their rights takes effect.</p>
      </Section>

      <Section id="t-contact" title="Contact">
        <p><Email field="contactEmail" /></p>
      </Section>
    </>
  );
}

const STORAGE = [
  ['Cookie', 'neev_rt', 'Keeps you signed in. Readable only by the server (HttpOnly), sent only to the sign-in service, deleted when you sign out.', '30 days'],
  ['Browser storage', 'token', 'Your short-lived sign-in token, sent with each request.', 'Until you sign out'],
  ['Browser storage', 'activeOrgId, activeBranchId, branchId, activeWarehouseId, lastSelection:v1, dashboardBranchIds', 'Which company, branch and warehouse you were working in.', 'Until you clear it'],
  ['Browser storage', 'uiTheme, uiDensity, navCollapsed, notifSeenKey, ledger_expanded_*, neev:tip:*', 'Display preferences, which menus are open and which tips you have dismissed.', 'Until you clear it'],
  ['Browser storage', 'app-table-widths:*, *:hiddenCols, report-layout:*, report-saved-layouts:*, report-column-widths:*', 'Column widths, hidden columns and report layouts you chose.', 'Until you clear it'],
  ['Browser storage', 'pickerRecents:v1', 'The customers, items and accounts you picked recently, so they appear first. Holds their internal ids, not their names.', 'Until you clear it'],
  ['Browser storage', 'theme-preset, theme-dark-mode, onboarded:org:*', 'Display choices and a "welcome shown" marker written by earlier versions of Clor. No longer written; harmless if present.', 'Until you clear it'],
];

function StorageNotice() {
  return (
    <>
      <Section id="c-summary" title="In short">
        <p>
          Clor uses one cookie and some browser storage, all of it needed to sign you in or to remember choices you
          made on screen. There are no analytics, advertising or third-party cookies, and the site loads nothing from
          other companies&rsquo; servers. Because nothing here is optional tracking, there is no consent banner to
          click through.
        </p>
      </Section>

      <Section id="c-list" title="Everything this site stores">
        <div className="ui-table-scroll">
          <table className="legal-table">
            <caption className="sr-only">Cookies and browser storage used by Clor</caption>
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Name</th>
                <th scope="col">Purpose</th>
                <th scope="col">Kept for</th>
              </tr>
            </thead>
            <tbody>
              {STORAGE.map(([type, name, purpose, life]) => (
                <tr key={name}>
                  <td>{type}</td>
                  <td><code>{name}</code></td>
                  <td>{purpose}</td>
                  <td>{life}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="c-control" title="Your control">
        <p>
          Signing out removes the cookie and the sign-in token. Clearing this site&rsquo;s data in your browser
          removes everything else; you will need to sign in again and your display choices will reset.
        </p>
      </Section>

      <Section id="c-changes" title="If this changes">
        <p>
          If Clor ever adds analytics or anything else that is not strictly needed, it will not run until you have
          agreed, and you will be able to change your mind here.
        </p>
      </Section>
    </>
  );
}

function AccessibilityStatement() {
  return (
    <>
      <Section id="a-aim" title="Our aim">
        <p>
          We want Clor to work for everyone, including people who use a keyboard instead of a mouse, a screen reader,
          zoom or high-contrast settings. We work towards the Web Content Accessibility Guidelines (WCAG) 2.2 at level
          AA. We have not had Clor independently audited, so we do not claim to meet that standard in full.
        </p>
      </Section>

      <Section id="a-done" title="What we have done">
        <ul>
          <li>Buttons, links and fields show a visible focus ring when reached with the keyboard.</li>
          <li>Text and button colours are set to meet the AA contrast ratios, in light and dark themes.</li>
          <li>Animation is switched off when your system asks for reduced motion.</li>
          <li>The page can be zoomed; nothing blocks it.</li>
          <li>When a form cannot be saved, focus moves to the first field that needs attention.</li>
        </ul>
      </Section>

      <Section id="a-gaps" title="What we know falls short">
        <ul>
          <li>The borders of some input fields are faint, and may be hard to see for people with low vision.</li>
          <li>Most charts do not yet have a text or table alternative.</li>
          <li>Some large tables and older screens have not been tested with a screen reader.</li>
        </ul>
      </Section>

      <Section id="a-contact" title="Tell us">
        <p>
          If something in Clor is hard to use, write to <Email field="contactEmail" /> and say which screen and what
          you were trying to do. We will reply and, where we can, fix it.
        </p>
      </Section>
    </>
  );
}
