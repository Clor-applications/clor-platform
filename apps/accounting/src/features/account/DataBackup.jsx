import React, { useState } from 'react';
import { Download, HardDriveDownload, Settings2, Share2 } from 'lucide-react';

import { PageHeader } from '@ui/components/ui/Primitives';
import NotConnected from '@ui/components/ui/NotConnected';
import { notify } from '@ui/components/ui/notify';
import { exportCompanyData } from '../../api/dataExport';

/**
 * Taking a copy of this company's books, and of how it is set up.
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

const Row = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
    <span className="ui-muted">{label}</span>
    <span className="ui-money">{value}</span>
  </div>
);

const BackupCard = ({ icon: Icon, title, blurb, action, scope, busy, last, onDownload, highlights, footnote }) => {
  const kb = (n) => `${Math.max(1, Math.round(Number(n || 0) / 1024)).toLocaleString('en-IN')} KB`;
  return (
    <div className="ui-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Icon size={18} aria-hidden="true" className="ui-muted mt-0.5" />
          <div className="max-w-xl">
            <div className="ui-label">{title}</div>
            <p className="mt-1 text-sm ui-muted">{blurb}</p>
            {footnote ? <p className="mt-2 text-sm ui-muted">{footnote}</p> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDownload(scope)}
          disabled={Boolean(busy)}
          className="ui-btn ui-btn-primary shrink-0"
        >
          <Download size={16} aria-hidden="true" /> {busy === scope ? 'Preparing…' : action}
        </button>
      </div>

      {last ? (
        <div className="mt-4 border-t pt-3">
          <div className="ui-label mb-1">Last taken</div>
          <div className="max-w-sm">
            <Row label="When" value={last.at.toLocaleString()} />
            <Row label="Records" value={last.rows.toLocaleString('en-IN')} />
            <Row label="File size" value={kb(last.size)} />
            {highlights.map(([label, key]) => (
              <Row key={key} label={label} value={Number(last.counts[key] || 0).toLocaleString('en-IN')} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

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

      setLast((prev) => ({ ...(prev || {}), [scope]: { at: new Date(), rows, counts, size: blob.size } }));
      notify.success(`${rows.toLocaleString('en-IN')} records downloaded.`);
    } catch (e) {
      notify.error(`Could not take the backup: ${String(e?.message || e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        entity="settings"
        title="Data Backup"
      />

      <BackupCard
        icon={HardDriveDownload}
        title="Data"
        blurb={`What ${currentCompany?.name || 'this company'} has done: customers and vendors, items, invoices, bills, receipts, payments, and every journal entry behind them. This is the copy you would hand an accountant.`}
        action="Download data"
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

      <BackupCard
        icon={Settings2}
        title="Configuration"
        blurb="How this company is set up: branches and warehouses, the chart of accounts, numbering series, roles and their permissions, tax rates, approval rules and the reference lists. Small, rarely changed, and what you want when somebody has altered the numbering or when a new client company should be arranged like an existing one."
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
        footnote="Passwords and API secrets are stripped out. A configuration file is meant to be read and copied, which is nowhere for a credential to be."
      />

      <div className="ui-card p-4">
        <div className="flex items-start gap-3">
          <Share2 size={18} aria-hidden="true" className="ui-muted mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="ui-label">Send it somewhere automatically</div>
            <div className="mt-3">
              <NotConnected what="scheduled backup to a shared location">
                A nightly copy to SharePoint, Google Drive, a network share or object storage needs an account to send
                it to and permission to write there. Neither exists yet, so nothing is scheduled and nothing is being
                sent. Download above is the whole of it today.
              </NotConnected>
            </div>
          </div>
        </div>
      </div>

      <div className="ui-card p-4">
        <div className="ui-label">Restoring</div>
        <p className="mt-1 max-w-2xl text-sm ui-muted">
          Reading a backup back in is not offered yet, and that is deliberate rather than forgotten. Restoring into a
          company that already has data has to decide what happens to every record that exists in both — and a restore
          that silently duplicates a year of invoices is worse than no restore at all. Until that is built, the file
          above is a record you can read, audit and hand to an accountant, not a one-click undo.
        </p>
      </div>
    </div>
  );
}
