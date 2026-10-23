import React from 'react';
import { ArrowRight } from 'lucide-react';

import { PageHeader } from '@ui/components/ui/Primitives';

/**
 * Where a signed-in person lands on app.clor.in: the company, the apps it
 * uses, and the administration that belongs to all of them.
 *
 * The front door used to forward straight into the last app — usually
 * Accounting — so there was no place that was the company's rather than an
 * app's. Opening an app is now a choice made here, and the admin pages below
 * are the ones this person may open (the shell has already removed the rest).
 */
export default function AdminHome({ tenant, apps = [], navItems = [], openScreen, openApp }) {
  const admin = navItems.filter((n) => n.key && n.key !== 'home' && !n.section);
  const products = apps.filter((a) => !a.platform);

  return (
    <div className="space-y-6">
      <PageHeader title={tenant?.name || 'Company admin'} description="Your apps, and the people, access and account they share." />

      <section className="space-y-3" aria-labelledby="admin-apps">
        <h2 id="admin-apps" className="ui-t-sec">Apps</h2>
        {products.length ? (
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {products.map((a) => (
              <button key={a.id} type="button" className="ui-card ui-lift p-4 text-left" onClick={() => openApp?.(a.id)}>
                <span className="flex items-start gap-3">
                  <span className="grid place-items-center w-9 h-9 rounded-lg shrink-0" style={{ backgroundColor: 'rgb(var(--brand-soft))', color: 'rgb(var(--brand-ink))' }}>
                    <a.icon size={18} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">{a.name}</span>
                      <ArrowRight size={16} aria-hidden="true" className="ui-muted" />
                    </span>
                    <span className="block mt-1 text-sm ui-muted">{a.blurb}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="ui-caption">This company has no apps switched on yet.</p>
        )}
      </section>

      {admin.length ? (
        <section className="space-y-3" aria-labelledby="admin-areas">
          <h2 id="admin-areas" className="ui-t-sec">Administration</h2>
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {admin.map((n) => (
              <button key={n.key} type="button" className="ui-card ui-lift p-4 text-left flex items-center gap-3" onClick={() => openScreen?.(n.key)}>
                {n.icon ? <n.icon size={16} aria-hidden="true" className="shrink-0" /> : null}
                <span className="text-sm font-medium">{n.label}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
