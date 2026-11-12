import React, { useEffect, useState } from 'react';
import { Check, ChevronRight } from '@ui/components/ui/lineIcons';

import { apiFetch } from '@platform/http';
import { getAccountMe, listInvitations, memberDirectory } from '@platform/admin/account';
import { getAccountOverview } from '@platform/admin/admin';
import { getPolicy } from '@platform/admin/security';
import { WsDrawer } from './wsKit';
import './workspace.css';

/**
 * Setup guide at the foot of the Workspace rail (the "Setup" of Microsoft's
 * admin centre, Zoho One's "Getting started"): how far this company is from
 * being set up, and the next thing to do. Every step is read from data the
 * server already holds; nothing is ticked by hand. Shown to account owners
 * and admins only, and gone once every step is done.
 */

const isPrivileged = (m) => m.accountRole === 'OWNER' || m.accountRole === 'ADMIN' || (m.companies || []).some((c) => c.isAdmin);

/** The steps, each done or not, from what the server returned. Pure, for the tests. */
export function setupSteps({ tenantId, overview, profile, directory, invitations, policy }) {
  const company = (overview?.companies || []).find((c) => c.orgId === tenantId);
  const members = directory?.members || [];
  const here = members.map((m) => ({ ...m, place: (m.companies || []).find((c) => c.orgId === tenantId) })).filter((m) => m.place && m.status === 'ACTIVE');
  const privileged = members.filter((m) => m.status === 'ACTIVE' && isPrivileged(m));
  const pending = (invitations || []).filter((i) => i.status === 'PENDING').length;
  return [
    {
      key: 'company',
      title: 'Add company details',
      text: 'GSTIN, PAN and the registered address.',
      screen: 'company',
      done: Boolean(company?.gstin && profile?.pan && profile?.addressLine),
    },
    {
      key: 'invite',
      title: 'Invite your team',
      text: 'Bring in the people who will work here.',
      screen: 'invitations',
      done: members.length > 1 || pending > 0,
    },
    {
      key: 'access',
      title: 'Give everyone access',
      text: 'Each person needs a role that opens an app.',
      screen: 'users',
      done: here.length > 0 && here.every((m) => m.place.isAdmin || (m.place.apps || []).length > 0),
    },
    {
      key: 'secure',
      title: 'Protect admin sign-in',
      text: 'Require an authenticator app for owners and admins.',
      screen: 'security',
      done: Boolean(policy?.requireAdminTwoFactor) || (privileged.length > 0 && privileged.every((m) => m.authenticator)),
    },
  ];
}

export default function SetupGuide({ tenant, goTo, screen }) {
  const [steps, setSteps] = useState(null);
  const [open, setOpen] = useState(false);

  const orgId = tenant?.id;
  /* Read again on every page change, so finishing a step shows here as soon as you move on. */
  useEffect(() => {
    let live = true;
    (async () => {
      const me = await getAccountMe().catch(() => null);
      if (me?.role !== 'OWNER' && me?.role !== 'ADMIN') {
        if (live) setSteps(null);
        return;
      }
      const [overview, profile, directory, invitations, policy] = await Promise.all([
        getAccountOverview().catch(() => null),
        orgId ? apiFetch(`/orgs/${encodeURIComponent(orgId)}/company-profile`, { skipWarehouseHeader: true }).then((r) => r.company).catch(() => null) : null,
        memberDirectory().catch(() => null),
        listInvitations().then((r) => r.invitations).catch(() => []),
        getPolicy().then((r) => r.policy).catch(() => null),
      ]);
      if (live) setSteps(setupSteps({ tenantId: orgId, overview, profile, directory, invitations, policy }));
    })();
    return () => {
      live = false;
    };
  }, [orgId, screen]);

  if (!steps) return null;
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const pct = done / steps.length;
  const C = 2 * Math.PI * 15;

  return (
    <>
      <button type="button" className="ui-split-mod ws-setup-ring" onClick={() => setOpen(true)} title="Set up your workspace">
        <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r="15" className="ws-setup-ring-track" />
          <circle cx="18" cy="18" r="15" className="ws-setup-ring-fill" strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 18 18)" />
          <text x="18" y="22" textAnchor="middle" className="ws-setup-ring-text">{done}/{steps.length}</text>
        </svg>
        {/* Named by its visible word, then the count for a screen reader (axe label-content-name-mismatch). */}
        <span>Setup</span><span className="sr-only">: {done} of {steps.length} done</span>
      </button>

      <WsDrawer open={open} onClose={() => setOpen(false)} title="Set up your workspace" description={`${done} of ${steps.length} done`}>
        <div className="ws-meter-bar" role="meter" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Setup progress">
          <span style={{ width: `${Math.round(pct * 100)}%` }} />
        </div>
        <ol className="ws-setup-steps">
          {steps.map((s) => (
            <li key={s.key} data-done={s.done || undefined}>
              <span className="ws-setup-step-mark" aria-hidden="true">{s.done ? <Check size={14} /> : null}</span>
              <span className="ws-item-text">
                <span className="ws-item-title">{s.title}</span>
                <span className="ws-item-sub">{s.done ? 'Done' : s.text}</span>
              </span>
              {s.done ? null : (
                <button
                  type="button"
                  className="ws-btn ws-btn--quiet ws-btn--small"
                  onClick={() => {
                    setOpen(false);
                    goTo?.(s.screen);
                  }}
                >
                  Go <ChevronRight size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ol>
      </WsDrawer>
    </>
  );
}
