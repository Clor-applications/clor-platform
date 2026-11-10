import React, { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';

import { getEmailSwitches, saveEmailSwitches } from '@ui/api/notifications';
import EmailSwitchList from '@ui/notifications/EmailSwitchList';
import { emailGroups, switchesBody, toggleEmail } from '@ui/notifications/emailApps';
import { notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { readOnlyFor } from '@ui/permissions/WriteGuard';
import { PageHead, Panel } from './wsKit';
import './workspace.css';

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

  useEffect(() => {
    let off = false;
    getEmailSwitches()
      .then((r) => {
        if (off) return;
        setEvents(r?.events || []);
        setSaved(r?.events || []);
      })
      .catch((e) => !off && setError(String(e?.message || 'Could not load the email settings.')));
    return () => {
      off = true;
    };
  }, []);

  const subscriptions = Array.isArray(tenant?.subscriptions) ? tenant.subscriptions : null;
  const groups = useMemo(() => emailGroups(events || [], subscriptions), [events, subscriptions]);
  const dirty = Boolean(events && saved) && JSON.stringify(switchesBody(events)) !== JSON.stringify(switchesBody(saved));
  /* Counted over what is shown: an email of an app the company does not have is not one it switched off here. */
  const offCount = groups.reduce((n, g) => n + g.events.filter((e) => !e.enabled).length, 0);

  const save = async () => {
    setSaving(true);
    try {
      await saveEmailSwitches(switchesBody(events));
      setSaved(events);
      notify.success('Email notifications saved.');
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Company', 'Email notifications']}
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

        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

        <div className="ws-layout">
          <div className="ws-main">
            {!events ? (
              <p className="ws-card-blurb">{error ? '' : 'Loading…'}</p>
            ) : groups.length === 0 ? (
              <p className="ws-card-blurb">This company has no apps that send emails you can switch off.</p>
            ) : (
              groups.map((g) => (
                <Panel key={g.id} title={g.label} labelledBy={`email-app-${g.id}`}>
                  {g.events.length ? (
                    <EmailSwitchList
                      events={g.events}
                      labelledBy={`email-app-${g.id}`}
                      disabled={readOnly || saving}
                      onToggle={(key, on) => setEvents((prev) => toggleEmail(prev, key, on))}
                    />
                  ) : (
                    <p className="ws-card-blurb">{`Nothing to switch off. Every email ${g.label} sends has to arrive.`}</p>
                  )}
                </Panel>
              ))
            )}
          </div>

          <aside className="ws-side">
            <Panel title="Always sent">
              <p className="ws-card-blurb">
                Sign-in links, password resets, invitations, offer letters, the link to fill in details before joining,
                salary bank changes and letters to an employee, such as an absence notice. These are not listed and
                cannot be switched off.
              </p>
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}
