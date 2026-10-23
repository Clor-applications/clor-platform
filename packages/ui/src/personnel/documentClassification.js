/* Who can see a document (docs/people/02-PRD.md DOC-01). The server decides who may open each level; this only names it. */
export const DOC_WHO_CAN_SEE = [
  ['EMPLOYEE_VISIBLE', 'The person and HR'],
  ['HR_ONLY', 'HR only'],
  ['RESTRICTED', 'Restricted (HR with edit rights)'],
  ['CONFIDENTIAL', 'Confidential (named HR only)'],
];
export const docWhoLabel = (d) => DOC_WHO_CAN_SEE.find(([k]) => k === d?.classification)?.[1] || (d?.visibleToEmployee ? 'The person and HR' : 'HR only');
