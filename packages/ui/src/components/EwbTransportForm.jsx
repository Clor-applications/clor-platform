import React, { useState } from 'react';

/**
 * Transport details for an e-Way Bill — the fields Part A/B need:
 * transporter, mode, distance, vehicle, LR (transport document) number/date.
 * Pure form: the caller decides what happens on submit (IRP call for a
 * registered invoice, EWB-01 JSON download for a challan).
 */
export default function EwbTransportForm({ onSubmit, onCancel, submitLabel = 'Generate e-Way Bill', busy = false }) {
  const [form, setForm] = useState({
    transporterId: '',
    transporterName: '',
    mode: '1',
    vehicleNo: '',
    distanceKm: '',
    transDocNo: '',
    transDocDate: '',
  });

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.(form);
      }}
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="ui-label" htmlFor="ewbtransportform-transporter-id-gstin-transin">Transporter ID (GSTIN/TRANSIN)</label>
          <input id="ewbtransportform-transporter-id-gstin-transin" type="text" value={form.transporterId} onChange={set('transporterId')} className="ui-input w-full" placeholder="29ABCDE1234F1Z5" maxLength={15} />
        </div>
        <div>
          <label className="ui-label" htmlFor="ewbtransportform-transporter-name">Transporter name</label>
          <input id="ewbtransportform-transporter-name" type="text" value={form.transporterName} onChange={set('transporterName')} className="ui-input w-full" placeholder="ABC Logistics" />
        </div>
        <div>
          <label className="ui-label" htmlFor="ewbtransportform-transport-mode">Transport mode</label>
          <select id="ewbtransportform-transport-mode" value={form.mode} onChange={set('mode')} className="ui-select w-full">
            <option value="1">Road</option>
            <option value="2">Rail</option>
            <option value="3">Air</option>
            <option value="4">Ship</option>
          </select>
        </div>
        <div>
          <label className="ui-label" htmlFor="ewbtransportform-vehicle-number">Vehicle number</label>
          <input id="ewbtransportform-vehicle-number" type="text" value={form.vehicleNo} onChange={set('vehicleNo')} className="ui-input w-full" placeholder="KA01AB1234" />
        </div>
        <div>
          <label className="ui-label" htmlFor="ewbtransportform-distance-km">Distance (km)</label>
          <input id="ewbtransportform-distance-km" type="number" min="0" max="4000" value={form.distanceKm} onChange={set('distanceKm')} className="ui-input w-full" placeholder="0 = auto by PIN codes" />
        </div>
        <div>
          <label className="ui-label" htmlFor="ewbtransportform-lr-transport-doc-no">LR / Transport doc no</label>
          <input id="ewbtransportform-lr-transport-doc-no" type="text" value={form.transDocNo} onChange={set('transDocNo')} className="ui-input w-full" placeholder="LR-1234" />
        </div>
        <div>
          <label className="ui-label" htmlFor="ewbtransportform-transport-doc-date">Transport doc date</label>
          <input id="ewbtransportform-transport-doc-date" type="date" value={form.transDocDate} onChange={set('transDocDate')} className="ui-input w-full" />
        </div>
      </div>
      <p className="text-xs ui-muted">
        Road needs a vehicle number OR a transporter ID (Part A only). Rail/Air/Ship need the LR/RR/AWB number and date.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="ui-btn ui-btn-secondary">Cancel</button>
        <button type="submit" disabled={busy} className="ui-btn ui-btn-primary">{busy ? 'Generating…' : submitLabel}</button>
      </div>
    </form>
  );
}
