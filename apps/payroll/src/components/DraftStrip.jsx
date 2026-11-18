import React from 'react';

/*
 * A payslip printed before payroll is approved (owner's pick, round 27: a
 * coloured strip at the top, clear but tidy). It prints too, so a draft that
 * leaves the building still says what it is.
 */
const DRAFT_SLIP = new Set(['DRAFT', 'CALCULATED']);
const DRAFT_RUN = new Set(['DRAFT', 'CALCULATED', 'REVIEW']);

export const isDraftSlip = (slip) => Boolean(slip) && (DRAFT_SLIP.has(slip.status) || DRAFT_RUN.has(slip.run?.status));

export default function DraftStrip({ slip }) {
  if (!isDraftSlip(slip)) return null;
  return (
    <p className="ui-draft-strip" role="note">
      <b>Draft</b> Payroll is not approved yet, so these figures can still change.
    </p>
  );
}
