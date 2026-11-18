import { todayIst } from '@ui/utils/dates';
import { day } from './shared';

/*
 * Round 36 (owner's picks, 18 Nov 2026), offer with no answer, pick A: an offer has a last date
 * and that date is shown plainly while the candidate has not answered. Only a sent offer waits
 * for an answer; accepted, declined, withdrawn and expired offers keep their plain line.
 */

const MS_DAY = 24 * 60 * 60 * 1000;

/** Whole days from today (IST) to an ISO date; negative once the date has passed. */
export function daysUntil(iso, today = todayIst()) {
  if (!iso) return null;
  const a = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / MS_DAY);
}

/** Words for a sent offer's answer date, or null when there is nothing to wait for. */
export function answerByText(offer, today = todayIst()) {
  if (!offer || offer.status !== 'SENT' || !offer.acceptBy) return null;
  const left = daysUntil(offer.acceptBy, today);
  if (left == null) return null;
  const date = day(String(offer.acceptBy).slice(0, 10));
  if (left < 0) return { text: `Answer date passed · ${date}`, late: true };
  if (left === 0) return { text: `Answer by today · ${date}`, late: false };
  return { text: `Answer by ${date} · ${left === 1 ? '1 day' : `${left} days`} left`, late: false };
}

/** The amber chip beside a sent offer. */
export function OfferAnswerBy({ offer, today }) {
  const t = answerByText(offer, today);
  if (!t) return null;
  return <span className={`ui-pill ui-pill-warn tabular-nums ui-answer-by${t.late ? ' is-late' : ''}`}>{t.text}</span>;
}
