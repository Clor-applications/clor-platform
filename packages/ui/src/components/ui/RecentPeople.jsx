import React, { useEffect, useState } from 'react';
import { UserRound } from '@ui/components/ui/lineIcons';
import { RECENT_PEOPLE_EVENT, recentPeople } from '@ui/components/ui/recents';

/**
 * Round 55 (recentrecords A, owner 18 Nov 2026): "Recently opened" in the
 * menu, the last five people whose record was opened, so HR can go back and
 * forth between a few people without searching again. Nothing shows until a
 * record has been opened in this browser.
 */
export default function RecentPeople({ onOpen, currentId = null }) {
  const [people, setPeople] = useState(() => recentPeople());
  useEffect(() => {
    const sync = () => setPeople(recentPeople());
    window.addEventListener(RECENT_PEOPLE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(RECENT_PEOPLE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  if (!people.length) return null;
  return (
    <div className="ui-recent-people mt-4" role="group" aria-label="Recently opened">
      <p className="ui-caption px-2 pb-1">Recently opened</p>
      {people.map((p) => (
        <button
          key={p.id}
          type="button"
          className="ui-split-item"
          aria-current={String(currentId) === p.id ? 'page' : undefined}
          onClick={() => onOpen?.(p)}
        >
          <UserRound size={16} aria-hidden="true" />
          <span className="min-w-0 truncate">{p.name}</span>
        </button>
      ))}
    </div>
  );
}
