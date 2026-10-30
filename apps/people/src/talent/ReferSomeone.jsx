import React, { useMemo } from 'react';
import { PageHeader } from '@ui/components/ui/Primitives';
import ReferJobs from '@ui/referrals/ReferJobs';
import { applyMyself, myReferralLink, myReferrals, referSomeone } from '../api/talent';

/**
 * Refer someone (People referrals, A20), for anyone signed in to CLOR who works here: the jobs
 * open to them, refer a friend or share their own link, apply themselves where HR allows it, and
 * where their referrals are. The same block as the employee app's Jobs, on the page ground.
 */
export default function ReferSomeone({ params = {} }) {
  const api = useMemo(() => ({ load: myReferrals, refer: referSomeone, link: myReferralLink, apply: applyMyself }), []);
  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'Talent' }, { label: 'Refer someone' }]} title="Refer someone" />
      <div className="max-w-2xl space-y-8">
        <ReferJobs api={api} openJob={params?.opening || null} />
      </div>
    </div>
  );
}
