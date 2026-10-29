import React from 'react';
import { Building2, LogOut } from '@ui/components/ui/lineIcons';

import { ClorLogo } from '@ui/components/brand';
import { useSession } from './session';

/**
 * The address names a company this person cannot open (A-26).
 *
 * Opening some other company instead — which is what used to happen — is the
 * worst answer: a link sent between two people would show each of them a
 * different set of books, and nothing on screen would say so. This says which
 * company was asked for and lets them pick one of their own. It does not say
 * whether that company exists: a code is not a way to find out.
 */
export default function NoCompanyAccess() {
  const { user, tenants, deniedCode, setTenantId, signOut } = useSession();

  return (
    <div className="min-h-dvh" style={{ backgroundColor: 'rgb(var(--app-bg))' }}>
      <header
        className="flex h-14 items-center gap-3 px-4"
        style={{ borderBottom: '1px solid rgb(var(--border))', backgroundColor: 'rgb(var(--surface))' }}
      >
        <ClorLogo size={20} />
        <div className="flex-1" />
        <span className="ui-caption">{user?.email || user?.name}</span>
        <button type="button" className="ui-icon-btn" onClick={signOut} aria-label="Sign out">
          <LogOut size={16} aria-hidden="true" />
        </button>
      </header>

      <main className="mx-auto px-6 py-12" style={{ maxWidth: '44rem' }}>
        <h1 className="ui-t-page">You don’t have access to {deniedCode}</h1>
        <p className="mt-2 text-sm ui-muted">
          This link is for a company you are not a member of, or one you no longer have access to. Ask its
          administrator to add you, or open one of your own companies.
        </p>

        {tenants.length ? (
          <>
            <div className="ui-label mt-8 mb-2">Your companies</div>
            <ul style={{ borderTop: '1px solid rgb(var(--border))' }}>
              {tenants.map((t) => (
                <li key={t.id} style={{ borderBottom: '1px solid rgb(var(--border))' }}>
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 rounded-lg px-2 py-3 text-left ui-hover-sunken"
                    onClick={() => setTenantId(t.id)}
                  >
                    <Building2 size={16} aria-hidden="true" className="ui-muted" />
                    <span className="flex-1 text-sm">{t.name}</span>
                    {t.code ? <span className="ui-caption">{t.code}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </main>
    </div>
  );
}
