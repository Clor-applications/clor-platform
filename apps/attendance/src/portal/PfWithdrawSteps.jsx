import React from 'react';
import { ExternalLink } from '@ui/components/ui/lineIcons';

export const EPFO_MEMBER_PORTAL = 'https://unifiedportal-mem.epfindia.gov.in/memberinterface/';

/** Round 44 "pfclaim" A: how to take money out of PF, step by step, with the EPFO page. */
export default function PfWithdrawSteps() {
  return (
    /* The shared disclosure (a clickable control at 8px), not a card. */
    <details>
      <summary className="ui-t-sec cursor-pointer">Taking money out of your PF</summary>
      <ol className="ui-pf-steps-list">
        <li>Check that your UAN is active and that your Aadhaar, PAN and bank account are linked to it.</li>
        <li>Sign in to the EPFO member page with your UAN.</li>
        <li>Under Online Services, open Claim, choose what you are taking out and why.</li>
        <li>Confirm with the code sent to your Aadhaar mobile, then follow the claim under Track claim status.</li>
      </ol>
      <a className="ui-link inline-flex items-center gap-1" href={EPFO_MEMBER_PORTAL} target="_blank" rel="noopener noreferrer">
        Open the EPFO member page <ExternalLink size={14} aria-hidden="true" />
      </a>
      <p className="ui-caption">The rules on when and how much can be taken out are on the EPFO page. HR can help if your UAN is not linked.</p>
    </details>
  );
}
