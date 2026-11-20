import React, { useEffect, useState } from 'react';

import { getGrowth } from './portalApi';

/**
 * Round 37, courseassign B: a training I have been put down for stays on the Today tab until it is
 * marked completed (or missed). It reads the same growth data as Me → My goals and reviews, so
 * nothing new is asked of the server; it says nothing when the company has Performance off or
 * nothing is waiting.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (d) => {
  const [y, m, dd] = String(d || '').slice(0, 10).split('-');
  return y && m && dd ? `${Number(dd)} ${MONTHS[Number(m) - 1]} ${y}` : '';
};

/** The trainings still to finish: assigned, not completed or missed, earliest first. */
export function trainingsDue(trainings = []) {
  return trainings
    .filter((t) => t && t.status === 'ASSIGNED' && !t.completedOn)
    .sort((a, b) => String(a.startDate || '9999').localeCompare(String(b.startDate || '9999')));
}

export default function TrainingsDue({ guard }) {
  const [list, setList] = useState([]);
  useEffect(() => {
    let live = true;
    guard(getGrowth()).then((d) => { if (live) setList(d?.on ? trainingsDue(d.trainings) : []); }).catch(() => { if (live) setList([]); });
    return () => { live = false; };
  }, [guard]);
  if (!list.length) return null;
  return (
    <section className="portal-sec space-y-2" aria-labelledby="training-due-h">
      <h2 id="training-due-h" className="ui-t-sec">{list.length === 1 ? 'A training to finish' : `${list.length} trainings to finish`}</h2>
      <ul className="divide-y" aria-label="Trainings to finish">
        {list.map((t) => (
          <li key={t.id} className="py-2 text-sm">
            <span className="block">{t.title}</span>
            <span className="block ui-caption">{t.startDate ? `From ${longDate(t.startDate)}` : 'Your HR team put you down for it'}</span>
          </li>
        ))}
      </ul>
      <p className="ui-caption">It stays here until HR marks it completed.</p>
    </section>
  );
}
