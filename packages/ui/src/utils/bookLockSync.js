import { lockFiscalYear } from '../api/ledger';
import { hasApiSession } from '../api/purchaseDocs';
import { notify } from '../components/ui/notify';

/**
 * The fiscal year a date falls in, named the way the server names it.
 *
 * India's year runs April to March, so anything before April belongs to the
 * year that started the previous April. The server derives the same name from
 * the same rule; if the two ever disagree the lock would be written against a
 * year nobody is posting into.
 */
export const fyNameFor = (dateIso) => {
  const d = new Date(`${String(dateIso || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

/**
 * Closing or reopening the books on the server.
 *
 * The server is what refuses a posting into a closed period. A lock kept only
 * in this browser binds this browser: a second user, or the same user on
 * another machine, could still post into the year somebody had closed.
 *
 * Locking needs the approve right on the ledger. A refusal is reported and
 * nothing is changed here either, so the screen never shows a year as closed
 * that the server would still accept entries into.
 */
export const setBookLockOnServer = async ({ fyDate, lockedThrough }) => {
  if (!hasApiSession()) return { ok: true, local: true };
  // Reopening still has to name a year, so the year comes from the date under
  // discussion rather than from the value being written.
  const name = fyNameFor(fyDate);
  if (!name) return { ok: false };
  try {
    await lockFiscalYear(name, lockedThrough || null);
    return { ok: true };
  } catch (e) {
    notify.error(
      lockedThrough
        ? `The books were not closed on the server: ${String(e?.message || e)}`
        : `The books were not reopened on the server: ${String(e?.message || e)}`
    );
    return { ok: false };
  }
};
