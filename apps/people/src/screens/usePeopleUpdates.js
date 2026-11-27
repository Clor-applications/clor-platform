import { useEffect, useRef, useState } from 'react';
import { orgId } from '@platform/context';
import { watchPeopleChanges } from '@platform/peopleChanges';

// Merge rapid writes into one read. Other devices are picked up on the visible-page timer.
export function usePeopleUpdates(refresh) {
  const current = useRef(refresh);
  useEffect(() => { current.current = refresh; }, [refresh]);
  const org = orgId();
  useEffect(() => {
    let pending;
    const check = () => {
      clearTimeout(pending);
      if (!document.hidden && navigator.onLine !== false) pending = setTimeout(() => current.current(), 150);
    };
    const stop = watchPeopleChanges(org, check);
    const timer = setInterval(check, 15000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    return () => {
      stop();
      clearInterval(timer);
      clearTimeout(pending);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
    };
  }, [org]);
}

// Announce a difference between successful reads, never the initial contents of a view.
export function useChangeMessage(snapshot, describe, scope = '') {
  const [last, setLast] = useState(() => ({ scope, snapshot, message: null }));
  if (scope !== last.scope) {
    setLast({ scope, snapshot, message: null });
    return null;
  }
  if (snapshot && snapshot !== last.snapshot) {
    const text = last.snapshot ? describe(last.snapshot, snapshot) : null;
    const message = text ? { text, at: new Date(), scope } : last.message;
    setLast({ scope, snapshot, message });
    return message;
  }
  return last.message;
}
