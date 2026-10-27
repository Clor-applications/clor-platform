import React, { useState } from 'react';
import { Download, Printer } from 'lucide-react';

import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { getPunchEvidence, getPunchEvidenceCsv, todayIst } from '../api/attendance';
import { printEvidence } from './readerTrust';

/**
 * Attendance evidence (reader trust, O-11): every punch of one person in a
 * period — reader ID, serial, when it was made and when CLOR received it,
 * finger, face, card or phone, the work-site check, and the day's trust. As a
 * CSV, or as a printable page for an inspector, a dispute or a labour court.
 *
 * The existing evidence workbook (evidenceXlsx.js) covers the days, history
 * and corrections; this is the punch-by-punch proof behind them, from the
 * server (routes/attendanceInsights.ts, /evidence/punches).
 */
const saveText = (text, fileName) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

const monthStart = () => `${todayIst().slice(0, 7)}-01`;

/** Pick a person and a period, then take the evidence as CSV or print it. */
export default function PunchEvidence({ open, onClose, people = [], initial = {} }) {
  const [form, setForm] = useState(() => ({ employeeId: initial.employeeId || '', from: initial.from || monthStart(), to: initial.to || todayIst() }));
  const [busy, setBusy] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const ready = form.employeeId && form.from && form.to && form.from <= form.to;
  const person = people.find((p) => p.id === form.employeeId);

  const csv = async () => {
    setBusy('csv');
    try {
      const text = await getPunchEvidenceCsv(form.employeeId, form.from, form.to);
      saveText(text, `Attendance evidence ${person?.code || person?.name || ''} ${form.from} to ${form.to}.csv`.replace(/[\\/:*?"<>|]+/g, '-'));
      notify.success('Evidence downloaded.');
    } catch (err) {
      notify.error(String(err?.message || 'Could not build the evidence.'));
    } finally {
      setBusy('');
    }
  };
  const print = async () => {
    setBusy('print');
    try {
      printEvidence(await getPunchEvidence(form.employeeId, form.from, form.to));
    } catch (err) {
      notify.error(String(err?.message || 'Could not build the evidence.'));
    } finally {
      setBusy('');
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Attendance evidence"
      description="Every punch of one person in a period: reader ID and serial, when it was made and when CLOR received it, how it was verified, the work-site check, and the day’s trust."
      widthClass="w-[min(36rem,96vw)]"
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" disabled={!ready || Boolean(busy)} onClick={print}>
            <Printer size={16} aria-hidden="true" /> {busy === 'print' ? 'Preparing…' : 'Printable page'}
          </button>
          <button type="button" className="ui-btn ui-btn-primary" disabled={!ready || Boolean(busy)} onClick={csv}>
            <Download size={16} aria-hidden="true" /> {busy === 'csv' ? 'Preparing…' : 'Download CSV'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="ui-label">Person *</span>
          <select className="ui-select w-full" value={form.employeeId} onChange={set('employeeId')} aria-label="Person">
            <option value="">Choose…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` · ${p.code}` : ''}</option>)}
          </select>
        </label>
        <label className="block"><span className="ui-label">From *</span><input type="date" className="ui-input w-full" value={form.from} max={form.to} onChange={set('from')} /></label>
        <label className="block"><span className="ui-label">To *</span><input type="date" className="ui-input w-full" value={form.to} max={todayIst()} onChange={set('to')} /></label>
        <p className="ui-caption sm:col-span-2">Up to 92 days at a time. Taking someone’s evidence is kept on the audit trail.</p>
      </div>
    </Drawer>
  );
}
