import React, { useMemo, useState } from 'react';
import { Download, FileStack } from 'lucide-react';
import { PageHeader } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { buildTallyMastersXml, buildTallyVouchersXml } from '@ui/utils/tallyXml';

/**
 * Tally export — hand the CA exactly what they ask for.
 *
 * Two XML files in Tally's Import Data format: Masters first (ledgers,
 * parented into Tally's standard groups), then Vouchers for the date range.
 * Import order matters in Tally, so the buttons are numbered.
 */
const VOUCHER_TYPES = ['Sales', 'Purchase', 'Credit Note', 'Debit Note', 'Receipt', 'Payment', 'Journal'];

export default function TallyExport({ db, currentCompany }) {
  const today = new Date().toISOString().slice(0, 10);
  const fyStart = useMemo(() => {
    const d = new Date();
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `${y}-04-01`;
  }, []);
  const [from, setFrom] = useState(fyStart);
  const [to, setTo] = useState(today);
  const [types, setTypes] = useState(() => new Set(VOUCHER_TYPES));

  const preview = useMemo(
    () => buildTallyVouchersXml(db, currentCompany, { from, to, types: [...types] }).counts,
    [db, currentCompany, from, to, types]
  );
  const totalVouchers = Object.values(preview).reduce((s, n) => s + n, 0);

  const download = (name, xml) => {
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleType = (t) =>
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  return (
    <div className="space-y-6">
      <PageHeader
        entity="report"
        title="Tally Export"
        description="Masters + vouchers as Tally XML. In Tally: Gateway of Tally → Import Data → select the file. Import Masters first, then Vouchers."
      />

      <div className="ui-card space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="ui-label" htmlFor="tallyexport-from">From</label>
            <input id="tallyexport-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ui-input" />
          </div>
          <div>
            <label className="ui-label" htmlFor="tallyexport-to">To</label>
            <input id="tallyexport-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ui-input" />
          </div>
          <div className="ui-caption pb-2">Defaults to the current financial year.</div>
        </div>

        <div>
          <label className="ui-label mb-1 block">Voucher types</label>
          <div className="flex flex-wrap gap-2">
            {VOUCHER_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                className={`ui-btn ui-btn-sm ${types.has(t) ? 'ui-btn-primary' : 'ui-btn-secondary'}`}
              >
                {t} ({preview[t] ?? 0})
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="text-sm">
            <span className="font-medium">{totalVouchers}</span> voucher(s) in range ·{' '}
            <span className="ui-muted">masters cover every referenced ledger</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                download(`Tally-Masters-${currentCompany.name || 'export'}.xml`, buildTallyMastersXml(db, currentCompany));
                notify.success('Masters XML downloaded — import this into Tally FIRST.');
              }}
              className="ui-btn ui-btn-secondary"
            >
              <FileStack size={16} aria-hidden="true" /> 1. Masters XML
            </button>
            <button
              type="button"
              onClick={() => {
                const { xml } = buildTallyVouchersXml(db, currentCompany, { from, to, types: [...types] });
                download(`Tally-Vouchers-${from}-to-${to}.xml`, xml);
                notify.success(`${totalVouchers} voucher(s) exported — import after Masters.`);
              }}
              className="ui-btn ui-btn-primary"
            >
              <Download size={16} aria-hidden="true" /> 2. Vouchers XML
            </button>
          </div>
        </div>
      </div>

      <div className="ui-card p-4 text-sm">
        <div className="mb-1 font-semibold">Import steps in Tally (Prime / ERP 9)</div>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open (or create) the company in Tally with the same financial year.</li>
          <li>Gateway of Tally → <strong>Import Data</strong> → Masters → pick <em>Tally-Masters….xml</em>.</li>
          <li>Gateway of Tally → Import Data → Vouchers → pick <em>Tally-Vouchers….xml</em>.</li>
          <li>Check Day Book for the imported vouchers; every voucher arrives balanced (a Round Off line absorbs paise differences).</li>
        </ol>
      </div>
    </div>
  );
}
