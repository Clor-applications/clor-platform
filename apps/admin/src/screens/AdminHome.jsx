import React, { useEffect, useState } from 'react';
import { ArrowRight, Building2, Check, ChevronRight, CreditCard, Database, KeyRound, ShieldCheck, UserPlus, Users } from 'lucide-react';

import { getAccountMe, listAccountMembers } from '@platform/admin/account';
import { adminApp } from '../../manifest.jsx';
import './workspace.css';

/**
 * The Workspace: where a signed-in person lands on app.clor.in — the company,
 * every Clor app and where this company stands with it, and the administration
 * that belongs to all of them. Its own palette (workspace.css, decision D-3);
 * no app's screens change with it.
 *
 * Every state shown comes from what the server reported: the company's
 * subscriptions and plan (`tenant.billing`), the person's account role
 * (/account/me) and, for owners and administrators, the account's members.
 * The administration lists only the pages this person may open — the shell
 * has already removed the rest by permission — and the server checks again.
 */

/** Each product's own colour, as on clor.in; it stays on that product's tile. */
const ACCENT = { accounting: '#2F6FDB', people: '#7A4FD6', payroll: '#1E9E6A', attendance: '#D07A1F', projects: '#2E8DA3', timesheet: '#B5487A' };
const GROUP_ICON = { company: Building2, access: Users, security: ShieldCheck, plan: CreditCard, data: Database };
const ROLE_LABEL = { OWNER: 'Owner', ADMIN: 'Administrator', BILLING_ADMIN: 'Billing admin', MEMBER: 'Member' };

/** What an app is to this company right now, in the words the launcher shows. */
export function appState(app, tenant) {
  if (!app.available) return { key: 'soon', label: 'Coming soon', pill: 'ws-pill' };
  if ((tenant?.subscriptions || []).includes(app.id)) return { key: 'open', label: 'Switched on', pill: 'ws-pill ws-pill--ok' };
  /* Unrestricted billing (no plan assigned) owns everything sellable; a plan names what it includes. */
  const onPlan = !tenant?.billing?.restricted || (tenant.billing.ownedApps || []).includes(app.id);
  return onPlan ? { key: 'off', label: 'Not switched on', pill: 'ws-pill ws-pill--off' } : { key: 'plan', label: 'Not on your plan', pill: 'ws-pill' };
}

const firstName = (user) => String(user?.firstName || user?.fullName || '').trim().split(/\s+/)[0] || '';
const greeting = (d = new Date()) => (d.getHours() < 12 ? 'Good morning' : d.getHours() < 17 ? 'Good afternoon' : 'Good evening');

export default function AdminHome({ user, tenant, catalog = [], navItems = [], openScreen, openApp, openMoreApps }) {
  const [role, setRole] = useState(null);
  const [members, setMembers] = useState(null);

  useEffect(() => {
    let live = true;
    getAccountMe()
      .then((r) => {
        if (!live) return;
        setRole(r?.role || null);
        if (r?.role === 'OWNER' || r?.role === 'ADMIN') return listAccountMembers().then((m) => live && setMembers(m?.members || []));
        return null;
      })
      /* No answer hides what depends on it; nothing is guessed. */
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tenant?.id]);

  /* Every Clor product, from the shell (an app does not import the shell's registry). */
  const products = catalog.filter((a) => !a.platform);
  const may = new Map(navItems.filter((n) => n.key && n.key !== 'home' && !n.section).map((n) => [n.key, n]));
  /* The sidebar's own grouping, kept to the pages this person may open. */
  const groups = adminApp.modules
    .filter((m) => m.key !== 'home')
    .map((m) => ({ key: m.key, label: m.label, items: (m.items || m.groups.flatMap((g) => g.items)).map((k) => may.get(k)).filter(Boolean) }))
    .filter((g) => g.items.length);

  const switchedOn = products.filter((a) => appState(a, tenant).key === 'open').length;
  const isAdmin = role === 'OWNER' || role === 'ADMIN';
  const steps = isAdmin
    ? [
        { key: 'company', title: 'Company created', text: tenant?.name || 'Your first company', done: true },
        { key: 'apps', title: 'Apps switched on', text: switchedOn ? `${switchedOn} of ${products.filter((a) => a.available).length} available` : 'Choose the apps you need', done: switchedOn > 0, go: openMoreApps },
        {
          key: 'people',
          title: 'Team invited',
          text: members ? (members.length > 1 ? `${members.length} people in the account` : 'Only you so far') : 'Checking…',
          done: (members?.length || 0) > 1,
          go: may.has('users') ? () => openScreen?.('users') : null,
        },
      ]
    : [];
  const doneCount = steps.filter((s) => s.done).length;
  const name = firstName(user);

  return (
    <div className="ws">
      <div className="ws-inner">
        <header className="ws-head">
          <div>
            <p className="ws-context">
              <Building2 size={16} aria-hidden="true" />
              <span>{tenant?.name || 'Your company'}</span>
              {role ? <span className="ws-pill ws-pill--role">{ROLE_LABEL[role] || role}</span> : null}
            </p>
            <h1 className="ws-title">{name ? `${greeting()}, ${name}` : 'Workspace'}</h1>
            <p className="ws-lede">Every Clor app your company uses, and the people, access and plan they share.</p>
          </div>
          <div className="ws-actions">
            {may.has('users') ? (
              <button type="button" className="ws-btn ws-btn--primary" onClick={() => openScreen?.('users')}>
                <UserPlus size={16} aria-hidden="true" /> Add people
              </button>
            ) : null}
            {may.has('security') ? (
              <button type="button" className="ws-btn ws-btn--quiet" onClick={() => openScreen?.('security')}>
                <KeyRound size={16} aria-hidden="true" /> Sign-in & security
              </button>
            ) : null}
          </div>
        </header>

        {steps.length && doneCount < steps.length ? (
          <section className="ws-setup" aria-labelledby="ws-setup-title">
            <div className="ws-section-head">
              <h2 id="ws-setup-title" className="ws-h2">Finish setting up</h2>
              <span className="ws-pill">
                {doneCount} of {steps.length} done
              </span>
            </div>
            <div className="ws-progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Setup progress">
              <span style={{ width: `${(doneCount / steps.length) * 100}%` }} />
            </div>
            <ol className="ws-steps">
              {steps.map((s) => (
                <li key={s.key} className={`ws-step${s.done ? ' is-done' : ''}`}>
                  <span className="ws-step-mark" aria-hidden="true">
                    {s.done ? <Check size={14} strokeWidth={3} /> : null}
                  </span>
                  <span>
                    <span className="ws-step-title">{s.title}</span>
                    <span className="sr-only">{s.done ? ' (done)' : ' (to do)'}</span>
                    <span className="block ws-card-blurb">{s.text}</span>
                    {!s.done && s.go ? (
                      <button type="button" className="ws-link mt-1" onClick={s.go}>
                        Do this now <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <section className="ws-section" aria-labelledby="ws-apps-title">
          <div className="ws-section-head">
            <h2 id="ws-apps-title" className="ws-h2">Your apps</h2>
            {openMoreApps ? (
              <button type="button" className="ws-link" onClick={() => openMoreApps()}>
                All apps <ChevronRight size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <ul className="ws-apps" role="list">
            {products.map((a) => {
              const s = appState(a, tenant);
              const open = s.key === 'open';
              return (
                <li key={a.id}>
                  <article className={`ws-card${open ? ' is-open' : ''}${s.key === 'soon' ? ' is-soon' : ''}`}>
                    <div className="ws-card-top">
                      <span className="ws-tile" style={{ '--tile-fg': ACCENT[a.id] || 'rgb(var(--ws-ink))' }}>
                        <a.icon size={20} aria-hidden="true" />
                      </span>
                      <span className={s.pill}>{s.label}</span>
                    </div>
                    <div>
                      <h3 className="ws-card-name">{a.name}</h3>
                      <p className="ws-card-blurb">{a.blurb}</p>
                    </div>
                    <div className="ws-card-foot">
                      {open ? (
                        <>
                          <span>Ready to use</span>
                          <button type="button" className="ws-link ws-card-link" onClick={() => openApp?.(a.id)}>
                            Open {a.name} <ArrowRight size={14} aria-hidden="true" />
                          </button>
                        </>
                      ) : s.key === 'off' ? (
                        <>
                          <span>On your plan</span>
                          {openMoreApps ? (
                            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => openMoreApps()}>
                              See how to add it
                            </button>
                          ) : null}
                        </>
                      ) : s.key === 'plan' ? (
                        <span>Contact Clor to add it to your plan.</span>
                      ) : (
                        <span>Not built yet.</span>
                      )}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </section>

        {groups.length ? (
          <section className="ws-section" aria-labelledby="ws-admin-title">
            <div className="ws-section-head">
              <h2 id="ws-admin-title" className="ws-h2">Administration</h2>
            </div>
            <div className="ws-admin">
              {groups.map((g) => {
                const Icon = GROUP_ICON[g.key] || Building2;
                return (
                  <nav key={g.key} aria-label={g.label} className="ws-group">
                    <div className="ws-group-head">
                      <span className="ws-tile" aria-hidden="true">
                        <Icon size={16} />
                      </span>
                      {g.label}
                    </div>
                    <ul role="list">
                      {g.items.map((n) => (
                        <li key={n.key}>
                          <button type="button" className="ws-row" onClick={() => openScreen?.(n.key)}>
                            {n.icon ? <n.icon size={16} aria-hidden="true" /> : null}
                            <span>{n.label}</span>
                            <ChevronRight size={16} className="ws-chev" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </nav>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
