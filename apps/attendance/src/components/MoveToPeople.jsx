import React, { useEffect, useState } from 'react';
import { apiFetch } from '@platform/http';
import { requestOpenApp } from '@platform/context';

/**
 * One quiet line on Attendance's Today for whoever looks after the plan, when
 * the account has Attendance without People (platform audit, 11 Nov 2026: no
 * way to upgrade). It opens Workspace, Billing, where "Move to People" asks
 * CLOR sales. Hidden once dismissed on this browser.
 */
const KEY = 'clor.attendance.movePeopleHidden';
const hidden = () => {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

export default function MoveToPeople() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (hidden()) return undefined;
    let cancelled = false;
    apiFetch('/billing/subscription')
      .then((r) => {
        const owned = r?.ownedApps || [];
        if (!cancelled) setShow(Boolean(r?.mayChangePlan) && owned.includes('attendance') && !owned.includes('people'));
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);
  if (!show) return null;
  const hide = () => {
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {
      /* Private window: hidden for this visit only. */
    }
    setShow(false);
  };
  return (
    <p className="ui-muted text-sm" aria-label="People">
      Growing? People adds hiring, reviews, learning, assets and expenses, and keeps everything in Attendance.{' '}
      <button type="button" className="ui-link" onClick={() => requestOpenApp('admin', 'billing')}>
        See moving to People
      </button>
      {' · '}
      <button type="button" className="ui-link" onClick={hide}>
        Not now
      </button>
    </p>
  );
}
