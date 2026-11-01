import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from '@ui/components/ui/lineIcons';
import Drawer from '@ui/components/ui/Drawer';
import DatePicker from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { notify } from '@ui/components/ui/notify';
import { createOffer, offerSetup, previewOffer } from './api';
import { todayIst } from '@ui/utils/dates';

/*
 * Send an offer from CLOR (HR-VIEW gap 5), to a draft hire (`employee`) or
 * a candidate (`candidate`). The letter is the company's offer template; the
 * pay annexure is the CTC and its monthly lines, worked out from a salary
 * structure when Payroll is on, or typed. It goes by e-mail with a link to
 * accept; accepting is recorded and HR is told.
 */

const plusDays = (n) => new Date(Date.parse(`${todayIst()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const TYPED = '__typed';

export default function OfferDrawer({ employee, candidate, onClose, onSent }) {
  const target = employee || candidate;
  const [setup, setSetup] = useState(null);
  const [initial, setInitial] = useState(() => ({
    /* A candidate (Talent): their e-mail, and the opening's designation as the position. */
    email: employee ? employee.personalEmail || employee.email || employee.workEmail || '' : candidate?.email || candidate?.details?.email || '',
    designation: employee?.designation || candidate?.designation || '',
    joiningDate: employee?.dateOfJoining ? String(employee.dateOfJoining).slice(0, 10) : '',
    acceptBy: plusDays(7),
    annualCtc: '',
    structureId: TYPED,
    lines: [{ label: 'Basic', monthly: '' }, { label: 'House rent allowance', monthly: '' }],
    signatory: '',
    message: '',
  }));
  const [form, setForm] = useState(initial);
  /* Closing with something typed asks first: an offer half-written (pay
     lines, signatory) is a lot to lose to a stray Escape. */
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const [annexure, setAnnexure] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    offerSetup().then((s) => {
      setSetup(s);
      if (s?.payrollOn && s.structures?.length) {
        /* The default structure is ours, not the user's: move the baseline
           with it so it alone does not count as an unsaved change. */
        setForm((f) => ({ ...f, structureId: s.structures[0].id }));
        setInitial((f) => ({ ...f, structureId: s.structures[0].id }));
      }
    }).catch(() => setSetup({ payrollOn: false, structures: [] }));
  }, []);
  const typed = form.structureId === TYPED;
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setAnnexure(null); };
  const setLine = (i, patch) => set({ lines: form.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const pay = () => ({
    annualCtc: Number(String(form.annualCtc).replace(/,/g, '')),
    ...(typed ? { lines: form.lines.filter((l) => l.label.trim() || l.monthly !== '').map((l) => ({ label: l.label.trim(), monthly: Number(String(l.monthly).replace(/,/g, '')) })) } : { structureId: form.structureId }),
  });
  const preview = async () => {
    try {
      setAnnexure((await previewOffer(pay())).annexure.join('\n').trim());
    } catch (e) {
      notify.error(String(e?.message || 'Could not work it out.'));
    }
  };
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await createOffer({
        ...(employee ? { employeeId: employee.id } : { candidateId: candidate.id }),
        email: form.email.trim(), designation: form.designation.trim(), joiningDate: form.joiningDate || null, acceptBy: form.acceptBy,
        signatory: form.signatory.trim(), message: form.message.trim() || null, ...pay(),
      });
      notify.success(`Offer sent to ${r.offer.email}. You will be told when they answer.`);
      onSent?.(r.offer);
    } catch (err) {
      notify.error(String(err?.message || 'Not sent.'));
    } finally {
      setBusy(false);
    }
  };
  const structureOptions = [...(setup?.structures || []).map((s) => ({ value: s.id, label: s.name })), { value: TYPED, label: 'Type the monthly lines' }];
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(40rem,96vw)]" title={`Send an offer to ${target.name || target.title}`} dirty={dirty}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="offer-form" className="ui-btn ui-btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send offer'}</button></>}>
      <form id="offer-form" onSubmit={send} className="grid gap-4">
        <div className="ui-form-grid">
          <label className="block">
            <span className="ui-label">E-mail *</span>
            <input className="ui-input w-full" type="email" required value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </label>
          <label className="block">
            <span className="ui-label">Position *</span>
            <input className="ui-input w-full" required maxLength={120} value={form.designation} onChange={(e) => set({ designation: e.target.value })} />
          </label>
          <div><label className="ui-label" htmlFor="offer-joining">Joining date</label><DatePicker id="offer-joining" value={form.joiningDate} onChange={(v) => set({ joiningDate: v || '' })} /></div>
          <div><label className="ui-label" htmlFor="offer-accept-by">Open until *</label><DatePicker id="offer-accept-by" required min={todayIst()} value={form.acceptBy} onChange={(v) => set({ acceptBy: v || '' })} /></div>
          <label className="block">
            <span className="ui-label">Annual CTC (₹) *</span>
            <input className="ui-input w-full tabular-nums" inputMode="decimal" required value={form.annualCtc} onChange={(e) => set({ annualCtc: e.target.value })} placeholder="600000" />
          </label>
        </div>

        {setup?.payrollOn && setup.structures?.length ? (
          <div><PopupSelect showValueSubtext={false} label="Monthly pay" value={form.structureId} onChange={(v) => set({ structureId: v || TYPED })} options={structureOptions} /></div>
        ) : null}
        {typed ? (
          <fieldset className="space-y-2">
            <legend className="ui-label">Monthly lines</legend>
            {!setup?.payrollOn ? <p className="ui-caption">Payroll is not on, so type what is paid each month. The CTC goes on the letter as well.</p> : null}
            {form.lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <input className="ui-input flex-1" aria-label={`Line ${i + 1} name`} placeholder="Basic" value={l.label} maxLength={80} onChange={(e) => setLine(i, { label: e.target.value })} />
                <input className="ui-input w-36 tabular-nums text-right" aria-label={`Line ${i + 1} a month`} inputMode="decimal" placeholder="a month" value={l.monthly} onChange={(e) => setLine(i, { monthly: e.target.value })} />
                <button type="button" className="ui-icon-btn" aria-label={`Remove line ${i + 1}`} onClick={() => set({ lines: form.lines.filter((_, j) => j !== i) })}><Trash2 size={16} aria-hidden="true" /></button>
              </div>
            ))}
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => set({ lines: [...form.lines, { label: '', monthly: '' }] })}><Plus size={14} aria-hidden="true" /> Add a line</button>
          </fieldset>
        ) : null}

        <label className="block">
          <span className="ui-label">Signed by *</span>
          <input className="ui-input w-full" required maxLength={200} placeholder="Name and title, e.g. Asha Rao, Director" value={form.signatory} onChange={(e) => set({ signatory: e.target.value })} />
        </label>
        <label className="block">
          <span className="ui-label">Note in the e-mail (optional)</span>
          <textarea className="ui-input w-full" rows={2} maxLength={2000} value={form.message} onChange={(e) => set({ message: e.target.value })} />
        </label>
        <div>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={!form.annualCtc} onClick={preview}>Show the pay annexure</button>
          {annexure ? <pre className="mt-2 whitespace-pre-wrap text-sm tabular-nums border rounded-xl p-3" aria-label="Pay annexure">{annexure}</pre> : null}
        </div>
      </form>
    </Drawer>
  );
}
