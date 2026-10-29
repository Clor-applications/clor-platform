import React, { useEffect } from 'react';
import { ArrowRight } from '@ui/components/ui/lineIcons';

import { PageHeader } from '../components/ui/Primitives';
import { requestOpenApp } from '@platform/context';

/**
 * Users, roles, sign-in, branches, the audit trail and the account now live in
 * Workspace, the company's own workspace (ADR-010) — they were never
 * Accounting's alone. A bookmark, a notification or a habit that still opens
 * the old place is taken there, to the same page, rather than to nothing.
 */
export default function OpenInCompanyAdmin({ title, screen, forApp = '' }) {
  /* `forApp`: open on one app's share of it (an app's "Roles & Access" shows that app's permissions). */
  useEffect(() => {
    requestOpenApp('admin', screen, forApp ? { for: forApp } : {});
  }, [screen, forApp]);

  return (
    <div className="space-y-6">
      <PageHeader title={title} description="This is in Workspace now, with everything else your apps share." />
      <button type="button" className="ui-btn ui-btn-primary" onClick={() => requestOpenApp('admin', screen, forApp ? { for: forApp } : {})}>
        Open in Workspace <ArrowRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
