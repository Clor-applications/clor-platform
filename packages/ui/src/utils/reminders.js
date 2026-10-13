/**
 * Payment reminders over WhatsApp / email deep links.
 *
 * Zero-API first version: wa.me and mailto links with a prefilled message —
 * the operator's own WhatsApp/mail client does the sending, which is exactly
 * how Indian SMB collections actually run. Reminder history is stamped on the
 * invoice (remindersSent) so the schedule (due → +7 → +15) knows what stage
 * each invoice is at.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const balanceOf = (inv) => Math.max(0, num(inv.total) - num(inv.paidAmount));

export const daysOverdue = (inv, today = new Date().toISOString().slice(0, 10)) => {
  const due = String(inv.dueDate || '').slice(0, 10);
  if (!due) return 0;
  const ms = new Date(`${today}T00:00:00Z`) - new Date(`${due}T00:00:00Z`);
  return Math.floor(ms / 86400000);
};

/**
 * Reminder schedule: stage 1 on/after the due date, stage 2 at +7 days,
 * stage 3 at +15 days. Returns the stage the invoice has REACHED (0 = not
 * due yet).
 */
export const reminderStage = (inv, today) => {
  const d = daysOverdue(inv, today);
  if (d >= 15) return 3;
  if (d >= 7) return 2;
  if (d >= 0 && String(inv.dueDate || '')) return 1;
  return 0;
};

export const lastReminder = (inv) => {
  const list = Array.isArray(inv.remindersSent) ? inv.remindersSent : [];
  return list.length ? list[list.length - 1] : null;
};

/** Reached a stage no reminder has been sent for yet. */
export const needsReminder = (inv, today) => {
  const stage = reminderStage(inv, today);
  if (!stage) return false;
  const sentStages = new Set((inv.remindersSent || []).map((r) => Number(r.stage)));
  return !sentStages.has(stage);
};

/** Open collectible invoices for the reminders screen, most overdue first. */
export function collectiblesList(db, companyId, today) {
  return (db?.invoices || [])
    .filter((i) => {
      if (i.companyId !== companyId) return false;
      const st = String(i.status || '').toLowerCase();
      if (st === 'draft' || st === 'cancelled' || st === 'paid') return false;
      return balanceOf(i) > 0.004;
    })
    .map((i) => ({ invoice: i, overdue: daysOverdue(i, today), stage: reminderStage(i, today), balance: balanceOf(i) }))
    .sort((a, b) => b.overdue - a.overdue);
}

const fmtMoney = (v) => `₹${num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildReminderMessage({ invoice, customer, company, shareUrl }) {
  const name = customer?.contactPerson || customer?.displayName || invoice.customerName || 'Sir/Madam';
  const overdue = daysOverdue(invoice);
  const dueLine =
    overdue > 0
      ? `was due on ${invoice.dueDate} (overdue by ${overdue} day${overdue === 1 ? '' : 's'})`
      : `is due on ${invoice.dueDate || invoice.date}`;
  return (
    `Dear ${name},\n\n` +
    `Gentle reminder: invoice ${invoice.number} dated ${invoice.date} for ${fmtMoney(invoice.total)} ${dueLine}.\n` +
    `Balance outstanding: ${fmtMoney(balanceOf(invoice))}.\n\n` +
    (shareUrl ? `View invoice: ${shareUrl}\n\n` : '') +
    `Kindly arrange the payment at the earliest. Please ignore if already paid.\n\n` +
    `Regards,\n${company?.name || ''}`
  );
}

/** wa.me needs country code — assume India for bare 10-digit numbers. */
export const waPhone = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

export const waLink = (phone, message) => {
  const p = waPhone(phone);
  const text = encodeURIComponent(message);
  // No number → wa.me contact picker via api link still works with text only.
  return p ? `https://wa.me/${p}?text=${text}` : `https://wa.me/?text=${text}`;
};

export const mailtoLink = (email, subject, body) =>
  `mailto:${encodeURIComponent(String(email || ''))}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
