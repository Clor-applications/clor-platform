import React, { useCallback, useMemo } from 'react';

import ReferJobs from '@ui/referrals/ReferJobs';
import { SignedOut, applyWithin, getReferrals, referFriend, referralLink } from './portalApi';

/**
 * Jobs in the employee app (People referrals, server routes/peopleReferralsPortal.ts): the jobs
 * open to me for referrals, refer a friend or share my link on WhatsApp, apply myself where HR
 * allows it, and where my referrals are. Shown only while the company has Hiring on.
 */
const Card = ({ children }) => <div className="ui-card p-5">{children}</div>;

export default function MyJobs({ guard }) {
  const api = useMemo(() => ({ load: getReferrals, refer: referFriend, link: referralLink, apply: applyWithin }), []);
  /* The app's guard sends a signed-out person back to sign in; the form says nothing more. */
  const run = useCallback((p) => guard(p).catch((e) => {
    if (e instanceof SignedOut) e.signedOut = true;
    throw e;
  }), [guard]);
  return <ReferJobs api={api} run={run} wrap={Card} hideWhenEmpty />;
}
