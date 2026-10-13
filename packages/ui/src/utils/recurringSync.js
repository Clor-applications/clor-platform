import { createSchedule, deleteSchedule, updateSchedule } from '../api/recurring';
import { hasApiSession } from '../api/purchaseDocs';
import { notify } from '../components/ui/notify';

/**
 * Write-through for recurring schedules.
 *
 * The schedule is what the server needs: it raises the invoices, hourly, whether
 * or not anybody has the app open. The local row is kept so the screen keeps
 * working exactly as it did, and so a refusal never costs somebody their typing.
 *
 * Only the schedule moves. The materialising — deciding which periods are due
 * and raising a draft for each — is entirely the server's now, keyed so one
 * period can be billed once and once only.
 */

/** A local template as the server stores a schedule. */
export const scheduleFromTemplate = (t) => ({
  name: String(t.name || t.customerName || 'Recurring invoice').slice(0, 160),
  partyId: t.customerId ? String(t.customerId) : null,
  partyName: String(t.customerName || 'Customer').slice(0, 200),
  branchId: t.branchId ? String(t.branchId) : null,
  warehouseId: t.warehouseId ? String(t.warehouseId) : null,
  frequency: ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'].includes(String(t.frequency))
    ? String(t.frequency)
    : 'MONTHLY',
  interval: Math.max(1, Number(t.interval) || 1),
  nextRunDate: String(t.nextRunDate || '').slice(0, 10),
  endDate: t.endDate ? String(t.endDate).slice(0, 10) : null,
  maxOccurrences: Number(t.maxOccurrences) > 0 ? Number(t.maxOccurrences) : null,
  dueDays: Number.isFinite(Number(t.dueDays)) ? Number(t.dueDays) : 30,
  isActive: t.active !== false,
  notes: t.notes || null,
  // The invoice it raises, kept whole: a schedule must keep billing what was
  // agreed even after the item's price changes.
  template: {
    items: Array.isArray(t.items) ? t.items : [],
    subtotal: Number(t.subtotal) || 0,
    cgstTotal: Number(t.cgstTotal) || 0,
    sgstTotal: Number(t.sgstTotal) || 0,
    igstTotal: Number(t.igstTotal) || 0,
    gstTotal: Number(t.gstTotal) || 0,
    total: Number(t.total) || 0,
  },
});

export const saveSchedule = async (template) => {
  if (!hasApiSession()) return {};
  try {
    const created = await createSchedule(scheduleFromTemplate(template));
    const id = created?.schedule?.id;
    return id ? { backendScheduleId: String(id) } : {};
  } catch (e) {
    notify.error(`Saved on this device only — the server refused it: ${String(e?.message || e)}`);
    return {};
  }
};

export const patchSchedule = async (template, patch) => {
  const id = String(template?.backendScheduleId || '').trim();
  if (!id || !hasApiSession()) return;
  try {
    await updateSchedule(id, patch);
  } catch (e) {
    notify.error(`Changed on this device only — the server refused it: ${String(e?.message || e)}`);
  }
};

export const removeSchedule = async (template) => {
  const id = String(template?.backendScheduleId || '').trim();
  if (!id || !hasApiSession()) return;
  try {
    await deleteSchedule(id);
  } catch (e) {
    notify.error(`Removed on this device only — the server refused it: ${String(e?.message || e)}`);
  }
};
