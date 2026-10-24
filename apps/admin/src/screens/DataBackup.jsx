import React, { useState } from 'react';
import { Download } from 'lucide-react';

import NotConnected from '@ui/components/ui/NotConnected';
import { notify } from '@ui/components/ui/notify';
import { exportCompanyData } from '@platform/admin/dataExport';
import { ICON, PageHead, Panel } from './wsKit';
import './workspace.css';

/**
 * Workspace → Data → Data export (redesign W-R9): taking a copy of this company's books, and of how it is set up.
 *
 * Two backups, because they answer two different questions. Data is what the
 * business did — it is large, it only grows, and it is what you would hand an
 * accountant. Configuration is how the company is arranged: the chart of
 * accounts, numbering, roles, tax rates, the reference lists. It is small, it
 * changes rarely, and it is what you want when somebody has broken the invoice
 * numbering or when a practice is setting up its eleventh client the way it set
 * up the tenth.
 *
 * Deliberately not "system backup". The database backup is the operator's tool
 * — it is every customer's books in one file and no customer should ever hold
 * one. This is the other thing: one company's own data, for the people whose
 * data it is, in a file they can keep, read and take elsewhere.
 *
 * A customer who cannot get their data out is a customer who is locked in, and
 * the fastest way to lose trust is for that to be true.
 */

const kb = (n) => `${Math.max(1, Math.round(Number(n || 0) / 1024)).toLocaleString('en-IN')} KB`;

const Row = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
    <dt style={{ color: 'rgb(var(--ws-muted))' }}>{label}</dt>
    <dd style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{value}</dd>
  </div>
);

/** One kind of copy: what it holds, its download button, and what the last copy taken here contained. */
const ExportPanel = ({ icon: Icon, title, blurb, action, primary, scope, busy, last, onDownload, highlights, footnote }) => (
  <Panel
    title={title}
    action={
      <button
        type="button"
        onClick={() => onDownload(scope)}
        disabled={Boolean(busy)}
        className={`ws-btn ws-btn--small ${primary ? 'ws-btn--primary' : 'ws-btn--quiet'}`}
      >
        <Download size={14} aria-hidden="true" /> {busy === scope ? 'Preparing…' : action}
      </button>
    }
  >
    <div className="flex items-start gap-3">
      <span className="ws-tile" aria-hidden="true"><Icon size={20} /></span>
      <div className="grid gap-2" style={{ maxWidth: '68ch' }}>
        <p className="ws-card-blurb">{blurb}</p>
        {footnote ? <p className="ws-card-blurb">{footnote}</p> : null}
      </div>
    </div>

    {last ? (
      <div style={{ borderTop: '1px solid rgb(var(--ws-line))', paddingTop: 12 }} className="grid gap-3 sm:grid-cols-2">
        <div>
          <h3 className="ws-item-title">Last taken</h3>
          <dl className="mt-1">
            <Row label="When" value={last.at.toLocaleString()} />
            <Row label="Records" value={last.rows.toLocaleString('en-IN')} />
            <Row label="File size" value={kb(last.size)} />
            {highlights.map(([label, key]) => (
              <Row key={key} label={label} value={Number(last.counts[key] || 0).toLocaleString('en-IN')} />
            ))}
          </dl>
        </div>
        {last.withheld?.length ? (
          <div>
            <h3 className="ws-item-title">Left out of this copy</h3>
            <ul className="mt-1 grid gap-1 text-sm" style={{ color: 'rgb(var(--ws-muted))' }}>
              {last.withheld.map((w) => (
                <li key={w.domain}>
                  <span className="capitalize">{w.domain}</span>: {w.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    ) : null}
  </Panel>
);

export default function DataBackup({ currentCompany }) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);

  const download = async (scope) => {
    if (busy) return;
    setBusy(scope);
    try {
      const payload = await exportCompanyData(scope);
      const counts = payload?.export?.counts || {};
      const rows = Object.values(counts).reduce((n, c) => n + Number(c || 0), 0);
      // People and payroll records only travel to someone who may see them in the app.
      const withheld = Array.isArray(payload?.export?.withheld) ? payload.export.withheld : [];

      const stamp = new Date().toISOString().slice(0, 10);
      const name = String(currentCompany?.name || 'company').replace(/[\\/:*?"<>|]+/g, '-');
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // The scope is in the filename: two files in one folder, six months
      // apart, have to be tellable apart without opening them.
      a.download = `${name}-${scope}-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setLast((prev) => ({ ...(prev || {}), [scope]: { at: new Date(), rows, counts, size: blob.size, withheld } }));
      notify.success(
        withheld.length
          ? `${rows.toLocaleString('en-IN')} records downloaded. ${withheld.map((w) => w.domain).join(' and ')} left out.`
          : `${rows.toLocaleString('en-IN')} records downloaded.`,
      );
    } catch (e) {
      notify.error(`Could not take the backup: ${String(e?.message || e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Data', 'Data export']}
          title="Data export"
        />

        <div className="ws-layout">
          <div className="ws-main">
            <ExportPanel
              icon={ICON.accounting}
              title="Books and documents"
              blurb={"Customers, vendors, items, invoices, bills, payments and journal entries."}
              action="Download data"
              primary
              scope="data"
              busy={busy}
              last={last?.data}
              onDownload={download}
              highlights={[
                ['Invoices', 'invoices'],
                ['Journal entries', 'journalEntries'],
                ['Customers & vendors', 'parties'],
              ]}
            />

            <ExportPanel
              icon={ICON.settings}
              title="Configuration"
              blurb="Branches, warehouses, chart of accounts, numbering series, roles, tax rates and approval rules."
              action="Download configuration"
              scope="configuration"
              busy={busy}
              last={last?.configuration}
              onDownload={download}
              highlights={[
                ['Ledger accounts', 'ledgerAccounts'],
                ['Roles', 'roles'],
                ['Numbering series', 'numberSeries'],
              ]}
              footnote="Passwords and API secrets are left out."
            />
          </div>

          <aside className="ws-side">
            <Panel title="Sent automatically">
              <NotConnected what="scheduled backup to a shared location">
                Download is the only way to take a copy for now.
              </NotConnected>
            </Panel>
            <Panel title="Restoring">
              <p className="ws-card-blurb">
                Not available yet.
              </p>
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}
