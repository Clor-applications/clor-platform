import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Check } from 'lucide-react';

import { useDismissable } from '@ui/components/ui/useDismissable';
import { getInbox, getMutes, markAllRead, markRead, setMute } from '@ui/api/notifications';

/**
 * The bell every app shares. One inbox per person per company, read every
 * minute and when the dropdown opens; a notification opens the screen it is
 * about through `onOpen(link)`, which the shell resolves across apps.
 */
/** What each kind is, in the words of the mute list. */
const KIND = {
  'approval.requested': 'Approvals waiting',
  'reader.alert': 'Reader alerts',
  'connector.alert': 'Connector alerts',
  'payroll.bank_change': 'Bank account changes',
  'scim.user': 'People added by directory sync',
  'people.data_request': 'Data requests',
  'people.joined': 'Joiners',
  'people.left': 'Leavers',
  'people.document_expiring': 'Documents expiring',
  'people.contractor_licence': 'Contractor licences',
  'payment.claimed': 'UPI payments to confirm',
  'books.overdue': 'Overdue invoices',
  'books.payables': 'Payables due this week',
};
const kindLabel = (k) => KIND[k] || k;

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
};

export default function NotificationBell({ tenantKey, onOpen }) {
  const [state, setState] = useState({ key: '', unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const [mutes, setMutes] = useState([]);
  const ref = useRef(null);
  useDismissable(open, () => setOpen(false), ref);

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

  const openOne = async (n) => {
    setOpen(false);
    if (!n.readAt) markRead([n.id]).then(load).catch(() => undefined);
    if (n.link && onOpen) onOpen(n.link);
  };
  const readAll = () => markAllRead().then(load).catch(() => undefined);

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="ui-icon-btn relative" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Bell size={16} />
        {unread ? (
          <span className="absolute -top-1 -end-1 min-w-[1.1rem] rounded-full px-1 text-center text-[10px] font-semibold leading-4 text-white" style={{ background: 'rgb(var(--neg))' }}>
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="ui-card absolute end-0 z-40 mt-2 w-[min(24rem,92vw)] p-2 shadow-lg" role="dialog" aria-label="Notifications">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="ui-t-sec">Notifications</span>
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
                      <div className={`text-sm ${n.readAt ? '' : 'font-semibold'}`}>{n.title}</div>
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
        </div>
      ) : null}
    </div>
  );
}
