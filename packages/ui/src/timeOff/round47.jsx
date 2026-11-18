import React from 'react';

/*
 * Round 47 picks (18 Nov 2026), approvals, outside Books:
 * - approvalchain B: the request says only the step it is at, "With HR"; the full trail folds away.
 * - balanceafter A: the approver reads "Leaves 4 days after this".
 * - escalate B: HR sees a "Waiting too long" list of requests waiting more than three days.
 * - approvalattach A: the note sent with a request opens inside the request, not as a download.
 */

/** Requests waiting longer than this many whole days are "waiting too long". */
export const LONG_WAIT_DAYS = 3;

export function waitedWholeDays(at, now = Date.now()) {
  if (!at) return 0;
  return Math.max(0, Math.floor((now - new Date(at).getTime()) / 86_400_000));
}

export function isWaitingTooLong(at, now = Date.now()) {
  return Boolean(at) && waitedWholeDays(at, now) > LONG_WAIT_DAYS;
}

/** The one step a request is at, in two or three words: "Yours to decide", "With HR", "Decided". */
export function stepChipText(step) {
  if (!step) return '';
  if (!step.current) return 'Decided';
  if (step.yours) return 'Yours to decide';
  const who = (step.waitingFor || []).filter(Boolean);
  return who.length ? `With ${who.join(', ')}` : 'With someone else';
}

const dayWord = (n) => (Math.abs(Number(n)) === 1 ? 'day' : 'days');

/** "Leaves 4 days after this", then what the balance is without it. */
export function BalanceAfter({ withIt, without }) {
  return (
    <>
      Leaves <strong className={Number(withIt) < 0 ? 'ui-text-neg' : undefined}>{withIt} {dayWord(withIt)}</strong> after this
      <span className="ui-muted"> · {without} {dayWord(without)} without this request</span>
    </>
  );
}

const mimeOf = (dataUrl) => (/^data:([^;,]+)/.exec(String(dataUrl || '')) || [])[1] || '';

/** The document sent with a request, shown inside the request: a picture as a picture, a PDF in a frame. */
export function InlineDocument({ dataUrl, title, onClose }) {
  const mime = mimeOf(dataUrl);
  const name = title || 'Document';
  return (
    <figure className="ui-inline-doc">
      {mime.startsWith('image/') ? (
        <img src={dataUrl} alt={name} />
      ) : mime === 'application/pdf' ? (
        <iframe src={dataUrl} title={name} />
      ) : (
        <p className="text-sm">This kind of file cannot be shown here. <a href={dataUrl} download={name}>Download it</a></p>
      )}
      <figcaption className="flex items-center justify-between gap-2">
        <span className="ui-caption truncate">{name}</span>
        {onClose ? <button type="button" className="ui-link text-sm" onClick={onClose}>Close</button> : null}
      </figcaption>
    </figure>
  );
}
