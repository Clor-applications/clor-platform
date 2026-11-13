import React, { useEffect, useState } from 'react';
import { Download } from '@ui/components/ui/lineIcons';

import { notify } from '@ui/components/ui/notify';
import { downloadPayrollExport, listPayrollExportLayouts } from '../api/attendance';

/**
 * A closed month for a company that pays salaries outside CLOR: one row per
 * employee with payable days, loss of pay, leave, offs, overtime and late
 * marks, in CLOR's own layout or the import layout of another payroll. The
 * server builds the file from the month's snapshot, so it carries the same
 * figures CLOR Payroll would take (server: services/attendance/payrollExport.ts).
 *
 * Shown on Month close once the month is closed. A secondary action: the
 * screen's one primary action is closing the month.
 */
const FORMAT_NAME = { xlsx: 'Excel (.xlsx)', csv: 'CSV (.csv)', xml: 'Tally import file (.xml)' };

export default function PayrollExport({ month, monthLabel }) {
  const [layouts, setLayouts] = useState(null);
  const [failed, setFailed] = useState('');
  const [layoutId, setLayoutId] = useState('generic');
  const [format, setFormat] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    listPayrollExportLayouts()
      .then((list) => live && setLayouts(list))
      .catch((e) => live && setFailed(String(e?.message || 'Could not read the layouts.')));
    return () => {
      live = false;
    };
  }, []);

  const layout = (layouts || []).find((l) => l.id === layoutId) || (layouts || [])[0] || null;
  /* The file type follows the layout: Tally's own file is not offered for Keka. */
  const chosenFormat = layout && layout.formats.includes(format) ? format : layout?.formats[0] || '';

  const download = async (e) => {
    e.preventDefault();
    if (!layout || !chosenFormat) return;
    setBusy(true);
    try {
      await downloadPayrollExport(month, layout.id, chosenFormat);
      notify.success(`${monthLabel} downloaded in the ${layout.name} layout.`);
    } catch (err) {
      notify.error(String(err?.message || 'Could not make the file.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ui-card p-4 space-y-3" aria-labelledby="payexp-h">
      <div>
        <h2 id="payexp-h" className="ui-t-sec">Export for another payroll</h2>
        <p className="text-sm ui-muted mt-0.5">
          If salaries are paid outside CLOR, take {monthLabel} as a file: one row per employee with payable days, loss of pay, leave, weekly offs, holidays, overtime hours and late marks.
        </p>
      </div>
      {failed ? (
        <p className="text-sm ui-text-neg" role="alert">{failed}</p>
      ) : !layouts ? (
        <p className="ui-caption" role="status">Reading the layouts…</p>
      ) : (
        <form className="space-y-2" onSubmit={download}>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="ui-label">Layout</span>
              <select className="ui-select !w-auto" value={layout?.id || ''} onChange={(e) => setLayoutId(e.target.value)} aria-describedby="payexp-about">
                {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="ui-label">File type</span>
              <select className="ui-select !w-auto" value={chosenFormat} onChange={(e) => setFormat(e.target.value)}>
                {(layout?.formats || []).map((f) => <option key={f} value={f}>{FORMAT_NAME[f] || f}</option>)}
              </select>
            </label>
            <button type="submit" className="ui-btn ui-btn-secondary" disabled={busy || !layout}>
              <Download size={16} aria-hidden="true" /> {busy ? 'Making the file…' : 'Download'}
            </button>
          </div>
          <p id="payexp-about" className="ui-caption">{layout?.about}</p>
          {layout && layout.id !== 'generic' ? (
            <p className="ui-caption">Check the first import against {layout.name}’s own template: column names differ between versions.</p>
          ) : null}
        </form>
      )}
    </section>
  );
}
