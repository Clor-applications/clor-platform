import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Check } from '@ui/components/ui/lineIcons';

import { Popover } from '@base-ui/react/popover';
import { getInbox, getMutes, markAllRead, markRead, setMute } from '@ui/api/notifications';

import { kindLabel } from './notificationKinds';

/**
 * The bell every app shares. One inbox per person per company, read every
 * minute and when the dropdown opens; a notification opens the screen it is
 * about through `onOpen(link)`, which the shell resolves across apps.
 */

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
};

/**
 * `waiting` is the one waiting number the app's rail shows (requests to approve
 * plus the reader's own open tasks): the badge says it, so the bell, Home and
 * the Inbox never disagree. Unread notices stay the list underneath.
 */
export default function NotificationBell({ tenantKey, onOpen, icon: Icon = Bell, waiting = 0, onOpenWaiting }) {
  const [state, setState] = useState({ key: '', unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const [mutes, setMutes] = useState([]);

  const load = useCallback(() => {
    if (!tenantKey) return;
    getInbox(30)
      .then((d) => setState({ key: tenantKey, unread: Number(d?.unread) || 0, items: Array.isArray(d?.notifications) ? d.notifications : [] }))
      .catch(() => undefined);
  }, [tenantKey]);

  useEffect(() => {
    load();
    const i = setInterval(load, 60_000);
    return () => clearInterval(i);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    load();
    getMutes().then(setMutes).catch(() => undefined);
  }, [open, load]);
  const toggleMute = (kind, muted) => setMute(kind, muted).then(setMutes).catch(() => undefined);

  const items = state.key === tenantKey ? state.items : [];
  const unread = state.key === tenantKey ? state.unread : 0;
  const waitingN = Number(waiting) || 0;
  /* The badge counts distinct unread notices (the server reads a stacked daily digest as one); what waits for your answer is the first line of the list. */
  const badge = unread;
  const badgeLabel = `${unread} unread`;

  const openOne = async (n) => {
    setOpen(false);
    if (!n.readAt) markRead([n.id]).then(load).catch(() => undefined);
    if (n.link && onOpen) onOpen(n.link);
  };
  const readAll = () => markAllRead().then(load).catch(() => undefined);

  return (
    /* base-ui places the panel on screen, closes it on Escape or a click elsewhere and returns the keyboard to the bell. */
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="ui-icon-btn relative" aria-label={badge ? `Notifications, ${badgeLabel}` : 'Notifications'}>
        <Icon size={Icon === Bell ? 16 : 20} />
        {badge ? (
          <span className="ui-bell-count">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={16} positionMethod="fixed" style={{ zIndex: 'var(--z-platform-menu)' }}>
        <Popover.Popup className="ui-menu" style={{ width: 'min(24rem, calc(100vw - 32px))', padding: 8, outline: 'none' }} aria-label="Notifications">
          {onOpenWaiting ? (
            <button type="button" className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm ui-hover-sunken" onClick={() => { setOpen(false); onOpenWaiting(); }}>
              <span>{waitingN ? <><strong className="tabular-nums">{waitingN}</strong> {waitingN === 1 ? 'thing waits' : 'things wait'} for your answer</> : 'Nothing waits for your answer'}</span>
              <span className="ui-caption whitespace-nowrap">Open Inbox</span>
            </button>
          ) : null}
          <div className="flex items-center justify-between px-2 py-1">
            <Popover.Title className="ui-t-sec" render={<span />}>Notifications</Popover.Title>
            {unread ? (
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={readAll}>
                <Check size={14} aria-hidden="true" /> Mark all read
              </button>
            ) : null}
          </div>
          {items.length ? (
            <ul className="max-h-[60vh] overflow-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <div className="flex items-start gap-1">
                    <button type="button" className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left ui-hover-sunken" onClick={() => openOne(n)}>
                      <div className={`text-sm ${n.readAt ? '' : 'font-semibold'}`}>{n.readAt ? null : <span className="ui-bell-unread" aria-hidden="true" />}{n.title}</div>
                      {n.body ? <div className="ui-caption">{n.body}</div> : null}
                      <div className="ui-caption">{ago(n.createdAt)}</div>
                    </button>
                    <button type="button" className="ui-icon-btn mt-1" aria-label={`Stop showing ${kindLabel(n.kind).toLowerCase()}`} title={`Stop showing ${kindLabel(n.kind).toLowerCase()}`} onClick={() => toggleMute(n.kind, true)}>
                      <BellOff size={14} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ui-caption px-2 py-3">Nothing yet. Approvals, reader alerts, bank changes and directory changes land here.</p>
          )}
          {mutes.length ? (
            <div className="border-t px-2 pt-2 mt-1" style={{ borderColor: 'rgb(var(--border))' }}>
              <div className="ui-caption">Not shown to you:</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {mutes.map((k) => (
                  <button key={k} type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => toggleMute(k, false)} title="Show again">
                    {kindLabel(k)} ✕
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
