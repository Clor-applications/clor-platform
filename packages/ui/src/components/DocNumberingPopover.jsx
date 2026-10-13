import { useState } from 'react';

import Drawer from './ui/Drawer';
import { formatVoucherNumberPreview } from '../utils/docSettings';

/**
 * The series a document is numbered from, changed on the document itself.
 *
 * Changing a series is a different act from raising the document, but it is
 * nearly always realised *while* raising one — the number that comes up is
 * wrong, or the year has turned over. So it opens over the form rather than
 * navigating away from half-typed work, and the full settings screen is one
 * click further on for anything this panel does not cover.
 *
 * It was written for invoices and lived inside the sales form. Bills are
 * numbered by the same rules, off the same `docSettings.numbering` shape, and
 * were given no way to say so: the bill number was whatever the series had
 * already decided. One panel, told which voucher it is editing.
 */
const DocNumberingPopover = ({
  db,
  setDb,
  currentCompany,
  /* Which series: the key under `docSettings.numbering`, e.g. invoice, bill. */
  voucherKey = 'invoice',
  /* The branch this document belongs to, or '' for the company-wide series. */
  branchId,
  settings,
  title = 'Numbering',
  /* What the sample line says — "Next invoice will be", "Next bill will be". */
  sampleLabel = 'Next number will be',
  onClose,
  onOpenFullSettings,
}) => {
  const current = settings && typeof settings === 'object' ? settings : {};
  const [draft, setDraft] = useState(() => ({
    mode: String(current.mode || 'auto').toLowerCase() === 'manual' ? 'manual' : 'auto',
    enabled: current.enabled !== false,
    prefix: String(current.prefix ?? ''),
    suffix: String(current.suffix ?? ''),
    nextNumber: Number(current.nextNumber ?? 1) || 1,
    digits: Number(current.digits ?? 0),
    dateFormat: String(current.dateFormat || 'none'),
    separator: String(current.separator ?? '-'),
    resetFrequency: String(current.resetFrequency || 'never'),
    includeBranchCode: Boolean(current.includeBranchCode),
    branchCode: String(current.branchCode || 'BR'),
    allowManualOverride: current.allowManualOverride !== false,
  }));

  const set = (patch) => setDraft((p) => ({ ...p, ...patch }));
  /* Several of these can sit on one screen; the ids have to differ. */
  const id = (part) => `${voucherKey}-num-${part}`;

  const save = () => {
    const scoped = String(branchId || '').trim();
    setDb({
      ...db,
      companies: (db.companies || []).map((c) => {
        if (c.id !== currentCompany.id) return c;
        const baseDoc = c?.docSettings && typeof c.docSettings === 'object' ? c.docSettings : {};
        const patch = {
          mode: draft.mode,
          enabled: draft.enabled,
          prefix: draft.prefix,
          suffix: draft.suffix,
          nextNumber: Math.max(1, Number(draft.nextNumber) || 1),
          digits: Math.max(0, Number(draft.digits) || 0),
          dateFormat: draft.dateFormat,
          separator: draft.separator,
          resetFrequency: draft.resetFrequency,
          includeBranchCode: Boolean(draft.includeBranchCode),
          branchCode: draft.branchCode || 'BR',
          allowManualOverride: Boolean(draft.allowManualOverride),
        };
        /* A branch numbers its own documents; without one this is the
           company-wide series. Either way only this voucher's entry moves. */
        if (scoped) {
          const prevByBranch =
            baseDoc?.numberingByBranch && typeof baseDoc.numberingByBranch === 'object' ? baseDoc.numberingByBranch : {};
          const prevBranch =
            prevByBranch?.[scoped] && typeof prevByBranch[scoped] === 'object' ? prevByBranch[scoped] : {};
          return {
            ...c,
            docSettings: {
              ...baseDoc,
              numberingByBranch: {
                ...prevByBranch,
                [scoped]: { ...prevBranch, [voucherKey]: { ...(prevBranch[voucherKey] || {}), ...patch } },
              },
            },
          };
        }
        const prevNum = baseDoc?.numbering && typeof baseDoc.numbering === 'object' ? baseDoc.numbering : {};
        return {
          ...c,
          docSettings: {
            ...baseDoc,
            numbering: { ...prevNum, [voucherKey]: { ...(prevNum[voucherKey] || {}), ...patch } },
          },
        };
      }),
    });
    onClose?.();
  };

  const sample = formatVoucherNumberPreview(draft);

  return (
    <Drawer
      open
      onClose={onClose}
      title={title}
      description="Changes apply to this numbering series in Master Data."
      widthClass="w-[min(38rem,94vw)]"
      actions={(
        <>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={save}>Save</button>
        </>
      )}
    >
      <div className="space-y-4">

        <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'rgb(var(--border))' }}>
          <span className="font-medium">Enable Automatic Numbering</span>
          <input
            id={id('mode')}
            type="checkbox"
            className="ui-checkbox"
            checked={draft.enabled && draft.mode !== 'manual'}
            onChange={(e) => set({ enabled: e.target.checked, mode: e.target.checked ? 'auto' : 'manual' })}
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="ui-label" htmlFor={id('prefix')}>Prefix</label>
            <input
              id={id('prefix')}
              className="ui-input ui-mono"
              value={draft.prefix}
              onChange={(e) => set({ prefix: e.target.value })}
            />
          </div>
          <div>
            <label className="ui-label" htmlFor={id('next')}>Starting Number</label>
            <input
              id={id('next')}
              type="number"
              min="1"
              className="ui-input ui-mono"
              value={draft.nextNumber}
              onChange={(e) => set({ nextNumber: e.target.value })}
            />
          </div>
          <div>
            <label className="ui-label" htmlFor={id('digits')}>Number of Digits</label>
            <select id={id('digits')} className="ui-select w-full" value={draft.digits} onChange={(e) => set({ digits: Number(e.target.value) })}>
              <option value="0">No padding</option>
              {[2, 3, 4, 5, 6, 8].map((number) => <option key={number} value={number}>{number}</option>)}
            </select>
          </div>
          <div>
            <label className="ui-label" htmlFor={id('date-format')}>Date Format</label>
            <select id={id('date-format')} className="ui-select w-full" value={draft.dateFormat} onChange={(e) => set({ dateFormat: e.target.value })}>
              <option value="none">No date</option><option value="yyyy">Year (YYYY)</option><option value="yy">Year (YY)</option><option value="yyyy-mm">Year-Month</option><option value="yy-mm">YY-Month</option><option value="fy">Financial Year</option>
            </select>
          </div>
          <div>
            <label className="ui-label" htmlFor={id('separator')}>Separator</label>
            <select id={id('separator')} className="ui-select w-full" value={draft.separator} onChange={(e) => set({ separator: e.target.value })}>
              <option value="-">- (Hyphen)</option><option value="/">/ (Slash)</option><option value=".">. (Dot)</option><option value="">None</option>
            </select>
          </div>
          <div>
            <label className="ui-label" htmlFor={id('reset')}>Reset Frequency</label>
            <select id={id('reset')} className="ui-select w-full" value={draft.resetFrequency} onChange={(e) => set({ resetFrequency: e.target.value })}>
              <option value="never">Never</option><option value="yearly">Yearly</option><option value="financial-year">Financial year</option><option value="monthly">Monthly</option>
            </select>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={draft.includeBranchCode} onChange={(e) => set({ includeBranchCode: e.target.checked })} />Include Branch Code</label>
          <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={draft.allowManualOverride} onChange={(e) => set({ allowManualOverride: e.target.checked })} />Allow Manual Override</label>
        </div>

        <div className="rounded-lg px-3 py-2" style={{ background: 'rgb(var(--surface-sunken))' }}>
          <div className="ui-caption">{sampleLabel}</div>
          <div className="ui-mono text-sm font-medium">{sample}</div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-4" style={{ borderColor: 'rgb(var(--border))' }}>
          {typeof onOpenFullSettings === 'function' ? (
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={onOpenFullSettings}>
              Open Master Data numbering
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
        </div>
      </div>
    </Drawer>
  );
};

export default DocNumberingPopover;
