import React from 'react';
import { ArrowRight } from 'lucide-react';

import { PageHeader } from '@ui/components/ui/Primitives';
import { adminApp } from '../../manifest.jsx';

/**
 * The Workspace: where a signed-in person lands on app.clor.in — the company,
 * every Clor app and where this company stands with it, and the administration
 * that belongs to all of them.
 *
 * The front door used to forward straight into the last app — usually
 * Accounting — so there was no place that was the company's rather than an
 * app's. Opening an app is now a choice made here.
 *
 * An app's state comes from what the shell already holds for this company:
 * its subscriptions, and the plan the server reports (`tenant.billing`). A
 * product the company has not switched on is shown as such, never as "Open";
 * one not built yet says so. The administration below lists only the pages
 * this person may open — the shell has already removed the rest by permission.
 */

/** What an app is to this company right now, in the words the launcher shows. */
export function appState(app, tenant) {
  if (!app.available) return { key: 'soon', label: 'Coming soon', pill: 'ui-pill-neutral' };
  if ((tenant?.subscriptions || []).includes(app.id)) return { key: 'open', label: 'Switched on', pill: 'ui-pill-pos' };
  /* Unrestricted billing (no plan assigned) owns everything sellable; a plan names what it includes. */
  const onPlan = !tenant?.billing?.restricted || (tenant.billing.ownedApps || []).includes(app.id);
  return onPlan
    ? { key: 'off', label: 'Not switched on', pill: 'ui-pill-neutral' }
    : { key: 'plan', label: 'Not on your plan', pill: 'ui-pill-warn' };
}

const firstName = (user) => String(user?.firstName || user?.fullName || '').trim().split(/\s+/)[0] || '';

export default function AdminHome({ user, tenant, catalog = [], navItems = [], openScreen, openApp, openMoreApps }) {
  /* Every Clor product, from the shell (an app does not import the shell's registry). */
  const products = catalog.filter((a) => !a.platform);
  const may = new Map(navItems.filter((n) => n.key && n.key !== 'home' && !n.section).map((n) => [n.key, n]));
  /* The sidebar's own grouping, kept to the pages this person may open. */
  const groups = adminApp.modules
    .filter((m) => m.key !== 'home')
    .map((m) => ({ key: m.key, label: m.label, items: (m.items || m.groups.flatMap((g) => g.items)).map((k) => may.get(k)).filter(Boolean) }))
    .filter((g) => g.items.length);
  const name = firstName(user);

  return (
    <div className="space-y-8">
      <PageHeader
        title={name ? `Welcome, ${name}` : 'Workspace'}
        description={`${tenant?.name || 'Your company'}: your apps, and the people, access and account they share.`}
      />

      <section className="space-y-3" aria-labelledby="ws-apps">
        <h2 id="ws-apps" className="ui-t-sec">Apps</h2>
        <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" role="list">
          {products.map((a) => {
            const s = appState(a, tenant);
            return (
              <li key={a.id} className="ui-card p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <span className="grid place-items-center w-9 h-9 rounded-lg shrink-0" style={{ backgroundColor: 'rgb(var(--brand-soft))', color: 'rgb(var(--brand-ink))' }}>
                    <a.icon size={18} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">{a.name}</span>
                      <span className={`ui-pill ${s.pill}`}>{s.label}</span>
                    </span>
                    <span className="block mt-1 text-sm ui-muted">{a.blurb}</span>
                  </span>
                </div>
                <div className="mt-auto">
                  {s.key === 'open' ? (
                    <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => openApp?.(a.id)}>
                      Open {a.name} <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  ) : s.key === 'off' && openMoreApps ? (
                    <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => openMoreApps()}>
                      See how to add it
                    </button>
                  ) : s.key === 'plan' ? (
                    <span className="ui-caption">Contact Clor to add it to your plan.</span>
                  ) : s.key === 'soon' ? (
                    <span className="ui-caption">Not built yet.</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {groups.length ? (
        <section className="space-y-4" aria-labelledby="ws-admin">
          <h2 id="ws-admin" className="ui-t-sec">Administration</h2>
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map((g) => (
              <nav key={g.key} aria-label={g.label} className="space-y-1">
                <h3 className="ui-caption">{g.label}</h3>
                <ul role="list">
                  {g.items.map((n) => (
                    <li key={n.key}>
                      <button type="button" className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left ui-hover-sunken" onClick={() => openScreen?.(n.key)}>
                        {n.icon ? <n.icon size={16} aria-hidden="true" className="shrink-0 ui-muted" /> : null}
                        <span className="text-sm">{n.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
