import React from 'react';
import { Building2, ChevronRight, Lock } from '@ui/components/ui/lineIcons';

import GatePage from './GatePage';
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
    <GatePage
      icon={Lock}
      title={`You don’t have access to ${deniedCode}`}
      subtitle="This link is for a company you are not a member of, or one you no longer have access to. Ask its administrator to add you, or open one of your own companies."
      who={user?.email || user?.name}
      onSignOut={signOut}
    >
      {tenants.length ? (
        <>
          <p className="ui-label mb-2">Your companies</p>
          <ul className="ui-gate-list">
            {tenants.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setTenantId(t.id)}>
                  <Building2 size={16} aria-hidden="true" className="ui-muted shrink-0" />
                  <span className="flex-1 font-medium">{t.name}</span>
                  {t.code ? <span className="ui-caption ui-num">{t.code}</span> : null}
                  <ChevronRight size={16} aria-hidden="true" className="ui-muted shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm ui-muted">You are not a member of any company yet. When someone adds you, it appears here.</p>
      )}
    </GatePage>
  );
}
