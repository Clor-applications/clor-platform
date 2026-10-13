import { useEffect, useState } from 'react';

import { getDocumentPostings } from '@ui/api/ledger';

/**
 * Whether a document has reached the books, asked before it is offered for editing.
 *
 * The server has refused to change the amounts on an issued invoice since
 * `d024b6d`: the document said 40,000 while the ledger said 118,000, and the
 * edit route was the one place in the product that could do that. The refusal
 * is right, but the form never knew about it — every financial control stayed
 * live, so the way to find out was to retype an invoice, press Save, and be
 * told by a toast that none of it could be kept.
 *
 * So the form asks first. `POSTED` is not the question — a reversal copies the
 * original's source document, so after a cancellation the only posted entry is
 * the contra that undid it. `getDocumentPostings` applies the server's own
 * definition (`postingState.ts`): posted, and not a contra one of this
 * document's own entries points at. The document's status is not the question
 * either: a Draft invoice posts today, so Draft does not mean "not in the
 * books" — the entries do.
 *
 * **It fails open, on purpose.** A caller without ledger permission gets a 403,
 * an offline browser gets nothing, and neither is evidence that the document is
 * unposted. Guessing "locked" there would take editing away from a draft over a
 * dropped request; guessing "open" leaves the form exactly as it was before this
 * existed, and the server still refuses. The cost of being wrong is a toast, and
 * only for somebody who could not have been shown the truth anyway.
 */
export function usePostingLock(docType, docId) {
  const key = String(docId || '').trim();
  /* The answer is carried with the document it is about, so a form switched to
     another invoice does not read the previous one's verdict for a frame. */
  const [answer, setAnswer] = useState({ key: '', locked: false });

  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    getDocumentPostings(docType, key)
      .then((postings) => {
        if (alive) setAnswer({ key, locked: postings.length > 0 });
      })
      .catch(() => {
        /* No permission, no network, no answer — the form behaves as it always
           did and the server stays the authority. */
        if (alive) setAnswer({ key, locked: false });
      });
    return () => {
      alive = false;
    };
  }, [docType, key]);

  const known = Boolean(key) && answer.key === key;
  return {
    locked: known ? answer.locked : false,
    /* 'unknown' while the ledger has not answered for THIS document yet. */
    state: !key ? 'open' : known ? (answer.locked ? 'locked' : 'open') : 'unknown',
  };
}

export default usePostingLock;
