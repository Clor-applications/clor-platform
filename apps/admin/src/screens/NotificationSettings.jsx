import { emoji } from '@ui/components/ui/emoji';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useUnsavedChanges from '@ui/components/ui/useUnsavedChanges';
import { Save } from 'lucide-react';

import { getEmailSwitches, saveEmailSwitches } from '@ui/api/notifications';
import EmailSwitchList from '@ui/notifications/EmailSwitchList';
import { emailGroups, switchesBody, toggleEmail } from '@ui/notifications/emailApps';
import { notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { readOnlyFor } from '@ui/permissions/WriteGuard';
import { AppMark, Empty, LoadError, Loading, PageHead } from './wsKit';
import './workspace.css';
import './ws-security.css';
import { errorWords } from '@ui/utils/errorWords';

/* This page's colour icon, the one its menu item wears. */
const PAGE_ICON = emoji('bell');

/**
 * Workspace → Company → Email notifications (automations B5).
 *
 * The emails the company may switch off, under the app that sends them, for
 * the apps it has on. They were reachable only from Accounting's settings, so
 * a company with People, Payroll or Attendance alone could not stop one. Same
 * server as Accounting's tab (routes/email.ts), same permission: seeing it
 * needs Company profile VIEW, saving needs its EDIT. Mail that has to arrive
 * is not in the list, and the server refuses a key it does not list.
 */
export const PERMISSION = 'SETTINGS::Company Profile::VIEW';

export default function NotificationSettings({ tenant }) {
  const [events, setEvents] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const readOnly = readOnlyFor(PERMISSION, usePermissions() || {});

  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  const load = useCallback(() => {
    setError('');
    getEmailSwitches()
      .then((r) => {
        if (!live.current) return;
        setEvents(r?.events || []);
        setSaved(r?.events || []);
      })
      .catch((e) => live.current && setError(errorWords(e, 'load the email settings')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const subscriptions = Array.isArray(tenant?.subscriptions) ? tenant.subscriptions : null;
  const groups = useMemo(() => emailGroups(events || [], subscriptions), [events, subscriptions]);
  const dirty = Boolean(events && saved) && JSON.stringify(switchesBody(events)) !== JSON.stringify(switchesBody(saved));
  /* Switches changed and not saved: leaving the page or closing the tab asks first. */
  useUnsavedChanges(dirty && !saving);
  /* Counted over what is shown: an email of an app the company does not have is not one it switched off here. */
  const offCount = groups.reduce((n, g) => n + g.events.filter((e) => !e.enabled).length, 0);

  const save = async () => {
    setSaving(true);
    try {
      await saveEmailSwitches(switchesBody(events));
      setSaved(events);
      notify.success('Email notifications saved.');
    } catch (err) {
      notify.error(errorWords(err, 'save the email settings'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Apps', 'Email notifications']}
          icon={PAGE_ICON}
          title="Email notifications"
          /* Read-only says so in the head too; the shell's WriteGuard banner gives the reason. */
          meta={readOnly && events ? 'View only' : dirty ? 'Unsaved changes' : events ? (offCount ? `${offCount} switched off` : 'All on') : null}
          actions={
            events ? (
              <button type="button" className="ws-btn ws-btn--primary" disabled={!dirty || saving} onClick={save}>
                <Save size={16} aria-hidden="true" /> {saving ? 'Saving…' : 'Save'}
              </button>
            ) : null
          }
        />

        {error && events ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

        <div className="ws-activity-layout">
          <div className="ws-activity-main ws-mail">
            {!events ? (
              error ? <LoadError onRetry={load}>{error}</LoadError> : <Loading shape="rows" label="Loading email notifications…" />
            ) : groups.length === 0 ? (
              <Empty icon={PAGE_ICON} compact>This company has no apps that send emails you can switch off.</Empty>
            ) : (
              /* Flush groups on the page ground (owner, 19 Nov 2026), each headed by its app and how many are on. */
              groups.map((g) => {
                const on = g.events.filter((e) => e.enabled).length;
                return (
                  <section key={g.id} className="ws-mail-group" aria-labelledby={`email-app-${g.id}`}>
                    <div className="ws-group-title ws-mail-title">
                      <AppMark app={g.id} size={22} title="" />
                      <h2 id={`email-app-${g.id}`} className="ws-mail-name">{g.label}</h2>
                      {g.events.length ? <span className="ws-mail-count">{on} of {g.events.length} on</span> : null}
                    </div>
                    {g.events.length ? (
                      <EmailSwitchList
                        events={g.events}
                        labelledBy={`email-app-${g.id}`}
                        disabled={readOnly || saving}
                        onToggle={(key, on2) => setEvents((prev) => toggleEmail(prev, key, on2))}
                      />
                    ) : (
                      <p className="ws-card-blurb">{`Nothing to switch off. Every email ${g.label} sends has to arrive.`}</p>
                    )}
                  </section>
                );
              })
            )}
          </div>

          <aside className="ws-activity-side" aria-label="About email notifications">
            {groups.length ? (
              <section className="ws-activity-box">
                <p className="ws-activity-box-title">Switched on</p>
                <p className="ws-activity-big"><span className="ui-num">{groups.reduce((n, g) => n + g.events.filter((e) => e.enabled).length, 0)}</span> of {groups.reduce((n, g) => n + g.events.length, 0)}</p>
                <p className="ws-activity-sub">{dirty ? 'Unsaved changes: press Save' : offCount ? `${offCount} ${offCount === 1 ? 'email' : 'emails'} not sent` : 'Every email is on'}</p>
                <ul className="ws-activity-bars ws-activity-bars--wide" aria-label="On, by app">
                  {groups.filter((g) => g.events.length).map((g) => {
                    const on = g.events.filter((e) => e.enabled).length;
                    return (
                      <li key={g.id} data-tone={on === g.events.length ? 'ok' : undefined}>
                        <span className="ws-activity-bar-label">{g.label}</span>
                        <span className="ws-activity-bar"><span style={{ width: `${Math.round((on / g.events.length) * 100)}%` }} /></span>
                        <span className="ws-activity-bar-n ui-num">{on}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
            <section className="ws-activity-box" aria-labelledby="email-always">
              <h2 id="email-always" className="ws-activity-box-title">Always sent</h2>
              <p className="ws-side-note">
                Sign-in links, password resets, invitations, offer letters, the link to fill in details before joining,
                salary bank changes and letters to an employee, such as an absence notice. These are not listed and
                cannot be switched off.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
