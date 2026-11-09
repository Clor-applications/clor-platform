import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/*
 * HR daily gaps (FEATURE-UI-AUDIT 30 Oct 2026, batch 3), screen by screen:
 * a document asked to be accepted and its state on the record (6), the
 * offers list with withdraw (7), the probation review feeding the decision
 * (8), one Delegates screen for leave and other approvals (9), past imports
 * with undo (14), and a comment its author deletes (22).
 */
const perms = vi.hoisted(() => ({ current: { isAdmin: true, permissions: new Set() } }));
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
vi.mock('../packages/ui/src/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@ui/components/ui/notify', () => dialogs);
vi.mock('../packages/ui/src/components/ui/notify', () => dialogs);
vi.mock('@ui/components/ui/useUnsavedChanges', () => ({ default: () => {} }));
const ctx = vi.hoisted(() => ({ user: { id: 'u-me' }, apps: ['people', 'attendance'] }));
vi.mock('@platform/context', async (orig) => ({ ...(await orig()), currentUser: () => ctx.user, hasApp: (id) => ctx.apps.includes(id), orgId: () => 'org1', branchId: () => 'b1' }));

const personnel = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  askToAccept: vi.fn(async () => ({ newlyAsked: 1 })),
  remindToAccept: vi.fn(async () => ({ reminded: 1 })),
  uploadDocument: vi.fn(),
  importBatches: vi.fn(),
  undoImport: vi.fn(async () => ({ removed: 2, restored: 0, kept: 0 })),
  listInvites: vi.fn(async () => []),
  sendHeldToPayroll: vi.fn(async () => ({ sent: 1 })),
  listEmployeeInvites: vi.fn(async () => [{ id: 'i3', statutory: { status: 'APPLIED', values: { pan: 'AB*******F' } } }]),
}));
const life = vi.hoisted(() => ({ pageJoiners: vi.fn(async () => ({ rows: [], total: 0, counts: {} })) }));
vi.mock('../packages/ui/src/lifecycle/api', async (orig) => ({ ...(await orig()), ...life }));
vi.mock('../packages/ui/src/personnel/api', async (orig) => ({ ...(await orig()), ...personnel }));
const wf = vi.hoisted(() => ({
  listOffers: vi.fn(),
  withdrawOffer: vi.fn(async () => ({ offer: {} })),
  getProbation: vi.fn(),
  saveProbationReview: vi.fn(async () => ({ review: {} })),
  decideProbation: vi.fn(async () => ({ applied: {} })),
}));
vi.mock('../apps/people/src/workforce/api', async (orig) => ({ ...(await orig()), ...wf }));
const time = vi.hoisted(() => ({
  listStandIns: vi.fn(),
  addStandIn: vi.fn(async () => ({ standIn: {} })),
  removeStandIn: vi.fn(async () => ({ ok: true })),
  listPeople: vi.fn(async () => [{ id: 'e-rahul', name: 'Rahul Manager', code: 'R1' }, { id: 'e-kavya', name: 'Kavya Iyer', code: 'K1' }, { id: 'e-asha', name: 'Asha Rao', code: 'A1' }]),
}));
vi.mock('../packages/ui/src/timeOff/api', async (orig) => ({ ...(await orig()), ...time }));
const appr = vi.hoisted(() => ({
  listStandInsFull: vi.fn(),
  standInCandidates: vi.fn(async () => [{ id: 'e-boss', name: 'Kavya Boss', code: 'B1' }]),
  addStandIn: vi.fn(async () => ({ standIn: {} })),
  removeStandIn: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../apps/people/src/api/approvals', async (orig) => ({ ...(await orig()), ...appr }));

import { EmployeeDocuments, taskNote } from '../packages/ui/src/personnel/Employees';
import Offers from '../apps/people/src/workforce/Offers';
import { ProbationSection } from '../apps/people/src/workforce/RecordExtras';
import Delegates from '../apps/people/src/screens/Delegates';
import ImportHistory from '../apps/people/src/workforce/ImportHistory';
import ActivityTimeline from '../packages/ui/src/components/ui/ActivityTimeline';
import Joining from '../packages/ui/src/lifecycle/Joining';
import JoiningStatutory from '../packages/ui/src/personnel/JoiningStatutory';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  perms.current = { isAdmin: true, permissions: new Set() };
  ctx.user = { id: 'u-me' };
  ctx.apps = ['people', 'attendance'];
});

async function pick(name, option) {
  fireEvent.click(screen.getByRole('combobox', { name }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
function typeDate(input, text) {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
}

describe('Documents: ask to read and accept (gap 6)', () => {
  const doc = (over) => ({ id: 'd1', title: 'Code of conduct', kind: 'OTHER', mime: 'application/pdf', size: 2048, createdAt: '2026-10-20T10:00:00Z', version: 1, classification: 'EMPLOYEE_VISIBLE', acceptance: null, ...over });

  it('asks from the row menu; the row then says when it was asked', async () => {
    personnel.listDocuments.mockResolvedValueOnce([doc()]).mockResolvedValueOnce([doc({ acceptance: { askedAt: '2026-10-30T05:00:00Z', acceptedAt: null, remindCount: 0 } })]);
    render(<EmployeeDocuments employeeId="e1" personName="Priya" />);
    fireEvent.click(await screen.findByRole('button', { name: 'More for Code of conduct' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ask to read and accept' }));
    await waitFor(() => expect(personnel.askToAccept).toHaveBeenCalledWith('d1'));
    expect(await screen.findByText(/Not accepted yet · asked 30 Oct 2026/)).toBeInTheDocument();
    expect(dialogs.notify.success).toHaveBeenCalledWith('Priya will be asked to read and accept Code of conduct.');
  });

  it('a waiting one offers Remind; an accepted one says the day; an HR-only file is never offered', async () => {
    personnel.listDocuments.mockResolvedValue([
      doc({ acceptance: { askedAt: '2026-10-28T05:00:00Z', acceptedAt: null, remindCount: 1 } }),
      doc({ id: 'd2', title: 'Offer letter', acceptance: { askedAt: '2026-10-01T05:00:00Z', acceptedAt: '2026-10-02T05:00:00Z', remindCount: 0 } }),
      doc({ id: 'd3', title: 'Pay notes', classification: 'HR_ONLY' }),
    ]);
    render(<EmployeeDocuments employeeId="e1" personName="Priya" />);
    expect(await screen.findByText('Not accepted yet · asked 28 Oct 2026, reminded once')).toBeInTheDocument();
    expect(screen.getByText('Accepted 2 Oct 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More for Code of conduct' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remind to accept' }));
    await waitFor(() => expect(personnel.remindToAccept).toHaveBeenCalledWith('d1'));
    fireEvent.click(screen.getByRole('button', { name: 'More for Pay notes' }));
    expect(screen.queryByRole('menuitem', { name: 'Ask to read and accept' })).toBeNull();
  });

  it('without Documents edit, nobody is asked', async () => {
    perms.current = { isAdmin: false, permissions: new Set(['PEOPLE::Documents::VIEW', 'PEOPLE::Documents::CREATE']) };
    personnel.listDocuments.mockResolvedValue([doc()]);
    render(<EmployeeDocuments employeeId="e1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'More for Code of conduct' }));
    expect(screen.queryByRole('menuitem', { name: 'Ask to read and accept' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Remove' })).toBeNull();
  });

  it('a read-only role (Viewer) gets the file and nothing that adds, replaces or removes one', async () => {
    perms.current = { isAdmin: false, permissions: new Set(['PEOPLE::Documents::VIEW']) };
    personnel.listDocuments.mockResolvedValue([doc()]);
    render(<EmployeeDocuments employeeId="e1" />);
    expect(await screen.findByRole('button', { name: 'Download Code of conduct' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Upload/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Issue a letter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More for Code of conduct' })).toBeNull();
  });
});

describe('Offers (gap 7)', () => {
  const offers = [
    { id: 'o1', employeeId: 'e1', name: 'Neha Rao', email: 'neha@example.com', designation: 'Designer', annualCtc: 600000, joiningDate: '2026-12-01', acceptBy: '2026-11-05', status: 'SENT', createdAt: '2026-10-30T05:00:00Z' },
    { id: 'o2', employeeId: 'e2', name: 'Arun Kumar', email: 'arun@example.com', designation: 'Tailor', annualCtc: 300000, joiningDate: '2026-11-15', acceptBy: '2026-11-01', status: 'ACCEPTED', acceptedAt: '2026-10-29T05:00:00Z', createdAt: '2026-10-25T05:00:00Z' },
    { id: 'o3', employeeId: 'e3', name: 'Old Offer', email: 'old@example.com', designation: 'Helper', annualCtc: 200000, acceptBy: '2026-10-10', status: 'WITHDRAWN', createdAt: '2026-10-01T05:00:00Z' },
  ];

  it('waiting offers first, with the CTC; withdraw asks, then sends', async () => {
    wf.listOffers.mockResolvedValue(offers);
    render(<Offers params={{}} updateParams={() => {}} openScreen={() => {}} />);
    const table = await screen.findByRole('table', { name: 'Offers' });
    expect(within(table).getByText('Neha Rao')).toBeInTheDocument();
    expect(within(table).queryByText('Arun Kumar')).toBeNull();
    expect(within(table).getByText('₹6,00,000')).toBeInTheDocument();
    expect(within(table).getByText('Accept by 5 Nov 2026')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Waiting/ })).toHaveTextContent('1');
    fireEvent.click(within(table).getByRole('button', { name: /actions/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Withdraw' }));
    await waitFor(() => expect(wf.withdrawOffer).toHaveBeenCalledWith('o1'));
    expect(dialogs.confirmDialog).toHaveBeenCalled();
  });

  it('the closed tab lists withdrawn offers, with nothing to withdraw', async () => {
    wf.listOffers.mockResolvedValue(offers);
    render(<Offers params={{ view: 'closed' }} updateParams={() => {}} openScreen={() => {}} />);
    const table = await screen.findByRole('table', { name: 'Offers' });
    expect(within(table).getByText('Old Offer')).toBeInTheDocument();
    expect(within(table).getByText('Withdrawn')).toBeInTheDocument();
  });
});

describe('Probation review (gap 8)', () => {
  const person = { id: 'e1', name: 'Priya Rao', probationEndDate: '2026-11-15', dateOfJoining: '2026-08-01', userId: 'u-priya', version: 1 };

  it('the manager writes the review; it is saved with the recommendation and the date', async () => {
    wf.getProbation.mockResolvedValue([]);
    render(<ProbationSection person={person} canReview canDecide={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Write review' }));
    const drawer = await screen.findByRole('dialog', { name: /Probation review/ });
    fireEvent.change(within(drawer).getByLabelText('Goals agreed'), { target: { value: 'Run the cutting floor' } });
    fireEvent.change(within(drawer).getByLabelText('What you saw'), { target: { value: 'Reliable' } });
    await pick('Recommendation', 'Extend');
    expect(within(drawer).getByRole('button', { name: 'Save review' })).toBeDisabled();
    typeDate(within(drawer).getByLabelText(/Extend to/), '15/01/2027');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save review' }));
    await waitFor(() => expect(wf.saveProbationReview).toHaveBeenCalledWith('e1', expect.objectContaining({ goals: 'Run the cutting floor', observations: 'Reliable', recommendation: 'EXTEND', newEndDate: '2027-01-15' })));
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('HR sees the review and who wrote it; the recommended row is marked and its date filled in', async () => {
    wf.getProbation.mockResolvedValue([{ id: 'r1', goals: 'Run the floor', observations: 'Reliable', recommendation: 'EXTEND', newEndDate: '2027-01-15', reviewedBy: 'Rahul Manager', updatedAt: '2026-10-30T05:00:00Z', outcome: null }]);
    render(<ProbationSection person={person} canReview canDecide />);
    const review = await screen.findByLabelText('Review');
    expect(review).toHaveTextContent('Extend to 15 Jan 2027');
    expect(review).toHaveTextContent('Rahul Manager');
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByLabelText(/Extend to.*recommended/)).toHaveValue('15 Jan 2027');
    fireEvent.click(screen.getByRole('button', { name: 'Extend' }));
    await waitFor(() => expect(wf.decideProbation).toHaveBeenCalledWith('e1', { outcome: 'EXTEND', newEndDate: '2027-01-15' }));
  });

  it('nobody reviews or decides their own probation', async () => {
    ctx.user = { id: 'u-priya' };
    wf.getProbation.mockResolvedValue([]);
    render(<ProbationSection person={person} canReview canDecide />);
    expect(await screen.findByText('Someone else reviews and decides your own probation.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write review' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });
});

describe('Delegates: one list and one form over the one stand-in table (gap 9, workflow engine 2b)', () => {
  it('lists each delegate once, saying what it hands on; one form names one delegate for yourself', async () => {
    /* The same row comes back from both routes (one table): shown once, as mine. */
    const shared = { id: 's1', managerEmployeeId: 'e-rahul', managerName: 'Rahul Manager', standInName: 'Kavya Iyer', standInEmployeeId: 'e-kavya', fromDate: '2026-10-29', toDate: '2026-11-02', live: true, requestTypes: ['ALL'] };
    time.listStandIns.mockResolvedValue({ today: '2026-10-30', standIns: [shared, { id: 'l1', managerEmployeeId: 'e-asha', managerName: 'Asha Rao', standInName: 'Rahul Manager', fromDate: '2026-11-01', toDate: '2026-11-05', live: false, requestTypes: ['ATTENDANCE', 'LEAVE'] }] });
    /* A People stand-in named before the merge (PEOPLE, or an empty list from an older API): other approvals, not leave. */
    appr.listStandInsFull.mockResolvedValue({ today: '2026-10-30', selfEmployeeId: 'e-rahul', standIns: [shared, { id: 'p0', managerEmployeeId: 'e-rahul', standInName: 'Asha Rao', fromDate: '2026-12-01', toDate: '2026-12-02', live: false, requestTypes: ['PEOPLE'] }] });
    render(<Delegates />);
    const table = await screen.findByRole('table', { name: 'Delegates' });
    await waitFor(() => expect(within(table).getByText('All approvals')).toBeInTheDocument());
    expect(within(table).getByText('Leave and attendance')).toBeInTheDocument();
    expect(within(table).getByText('Other approvals')).toBeInTheDocument();
    expect(within(table).getAllByText('Kavya Iyer')).toHaveLength(1);
    expect(within(table).getByText('Live')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Add delegate/ }));
    await screen.findByRole('dialog', { name: 'Add delegate' });
    await pick('Decides *', /Kavya Iyer/);
    typeDate(screen.getByLabelText('From'), '10/11/2026');
    typeDate(screen.getByLabelText('To'), '14/11/2026');
    expect(screen.getByRole('radio', { name: 'All approvals' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(appr.addStandIn).toHaveBeenCalledWith({ standInEmployeeId: 'e-kavya', fromDate: '2026-11-10', toDate: '2026-11-14', requestTypes: ['ALL'] }));
    expect(time.addStandIn).not.toHaveBeenCalled();
  });

  it('chosen request types for yourself go as one delegate', async () => {
    time.listStandIns.mockResolvedValue({ today: '2026-10-30', standIns: [] });
    appr.listStandInsFull.mockResolvedValue({ today: '2026-10-30', selfEmployeeId: 'e-rahul', standIns: [] });
    render(<Delegates />);
    fireEvent.click(await screen.findByRole('button', { name: /Add delegate/ }));
    await screen.findByRole('dialog', { name: 'Add delegate' });
    await pick('Decides *', /Kavya Iyer/);
    typeDate(screen.getByLabelText('From'), '10/11/2026');
    typeDate(screen.getByLabelText('To'), '14/11/2026');
    fireEvent.click(screen.getByRole('radio', { name: 'Chosen request types' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Leave' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Expense claims' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(appr.addStandIn).toHaveBeenCalledWith({ standInEmployeeId: 'e-kavya', fromDate: '2026-11-10', toDate: '2026-11-14', requestTypes: ['LEAVE', 'EXPENSE_CLAIM'] }));
  });

  it('for another manager, only leave and attendance can be handed on', async () => {
    time.listStandIns.mockResolvedValue({ today: '2026-10-30', standIns: [] });
    appr.listStandInsFull.mockResolvedValue({ today: '2026-10-30', selfEmployeeId: 'e-rahul', standIns: [] });
    render(<Delegates />);
    fireEvent.click(await screen.findByRole('button', { name: /Add delegate/ }));
    await screen.findByRole('dialog', { name: 'Add delegate' });
    await pick('In place of *', /Asha Rao/);
    await pick('Decides *', /Kavya Iyer/);
    expect(screen.getByRole('radio', { name: 'All approvals' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Leave and attendance' })).toBeChecked();
    expect(screen.getByText('Other approvals are handed on by the manager themselves, from their own sign-in.')).toBeInTheDocument();
    typeDate(screen.getByLabelText('From'), '10/11/2026');
    typeDate(screen.getByLabelText('To'), '14/11/2026');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(time.addStandIn).toHaveBeenCalledWith({ managerEmployeeId: 'e-asha', standInEmployeeId: 'e-kavya', fromDate: '2026-11-10', toDate: '2026-11-14', requestTypes: ['LEAVE', 'ATTENDANCE'] }));
    expect(appr.addStandIn).not.toHaveBeenCalled();
  });
});

describe('Delegates: HR with nobody chosen yet', () => {
  it('an empty "In place of" never saves as the person signed in', async () => {
    time.listStandIns.mockResolvedValue({ today: '2026-10-30', standIns: [] });
    appr.listStandInsFull.mockResolvedValue({ today: '2026-10-30', selfEmployeeId: null, standIns: [] });
    render(<Delegates />);
    fireEvent.click(await screen.findByRole('button', { name: /Add delegate/ }));
    await screen.findByRole('dialog', { name: 'Add delegate' });
    await pick('Decides *', /Kavya Iyer/);
    typeDate(screen.getByLabelText('From'), '10/11/2026');
    typeDate(screen.getByLabelText('To'), '14/11/2026');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await pick('In place of *', /Asha Rao/);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(time.addStandIn).toHaveBeenCalledWith({ managerEmployeeId: 'e-asha', standInEmployeeId: 'e-kavya', fromDate: '2026-11-10', toDate: '2026-11-14', requestTypes: ['LEAVE', 'ATTENDANCE'] }));
    expect(appr.addStandIn).not.toHaveBeenCalled();
  });
});

describe('Past imports (gap 14)', () => {
  it('lists imports; undo only within the day, asked first', async () => {
    const now = new Date().toISOString();
    personnel.importBatches.mockResolvedValue([
      { id: 'b1', created: 2, updated: 0, failed: 1, createdAt: now, undoneAt: null, canUndo: true },
      { id: 'b0', created: 5, updated: 0, failed: 0, createdAt: '2026-10-01T05:00:00Z', undoneAt: null, canUndo: false },
    ]);
    render(<ImportHistory canUndo />);
    const list = await screen.findByRole('region', { name: 'Past imports' });
    expect(list).toHaveTextContent('2 added, 1 not imported');
    expect(list).toHaveTextContent('Older than a day: correct people by hand');
    const undo = within(list).getAllByRole('button', { name: 'Undo' });
    expect(undo).toHaveLength(1);
    fireEvent.click(undo[0]);
    await waitFor(() => expect(personnel.undoImport).toHaveBeenCalledWith('b1'));
  });

  it('a role refused the company list sees nothing, and without delete rights there is no Undo', async () => {
    personnel.importBatches.mockRejectedValueOnce(Object.assign(new Error('No'), { status: 403 }));
    const { container } = render(<ImportHistory canUndo />);
    await waitFor(() => expect(personnel.importBatches).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    cleanup();
    personnel.importBatches.mockResolvedValue([{ id: 'b1', created: 2, updated: 0, failed: 0, createdAt: new Date().toISOString(), undoneAt: null, canUndo: true }]);
    render(<ImportHistory canUndo={false} />);
    await screen.findByRole('region', { name: 'Past imports' });
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});

describe('A comment its author deletes (gap 22)', () => {
  it('Delete shows only where the server allows it; the brand reads CLOR', () => {
    const onDelete = vi.fn();
    render(<ActivityTimeline filters={false} events={[
      { id: 'note_1', noteId: '1', type: 'comment', at: '2026-10-30T05:00:00Z', actor: 'Rahul', title: 'Comment', body: 'Mine', canDelete: true },
      { id: 'note_2', noteId: '2', type: 'comment', at: '2026-10-30T05:01:00Z', actor: 'Kavya', title: 'Comment', body: 'Theirs', canDelete: false },
      { id: 'x', type: 'system', at: '2026-10-30T05:02:00Z', title: 'Reader updated' },
    ]} eventAction={(e) => (e.canDelete ? <button type="button" onClick={() => onDelete(e.noteId)}>Delete</button> : null)} />);
    const buttons = screen.getAllByRole('button', { name: 'Delete' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onDelete).toHaveBeenCalledWith('1');
    expect(screen.getByText(/by CLOR/)).toBeInTheDocument();
  });
});

describe('Joining forms not back, and held details to Payroll (gaps 15, 22)', () => {
  const later = new Date(Date.now() + 5 * 86_400_000).toISOString();
  const invites = [
    { id: 'i1', employeeId: 'e1', employeeName: 'Neha Joshi', employeeCode: 'AT-06', channel: 'EMAIL', sentTo: 'neha@example.test', status: 'SENT', expiresAt: later, createdAt: '2026-10-29T21:00:00Z', statutory: null },
    { id: 'i2', employeeId: 'e2', employeeName: 'Old Link', channel: 'EMAIL', sentTo: 'old@example.test', status: 'SENT', expiresAt: '2026-10-01T00:00:00Z', createdAt: '2026-09-20T05:00:00Z', statutory: null },
    { id: 'i3', employeeId: 'e3', employeeName: 'Came Back', channel: 'EMAIL', sentTo: 'back@example.test', status: 'CHECKED', expiresAt: later, createdAt: '2026-10-20T05:00:00Z', statutory: { status: 'HELD' } },
  ];

  it('lists only forms not back, with the link that ran out said so; Payroll on offers to send held details', async () => {
    ctx.apps = ['people', 'payroll'];
    personnel.listInvites.mockResolvedValue(invites);
    render(<Joining params={{ view: 'forms' }} updateParams={() => {}} openScreen={() => {}} />);
    const table = await screen.findByRole('table', { name: 'Forms not back' });
    expect(within(table).getByText('Neha Joshi')).toBeInTheDocument();
    expect(within(table).getByText('Not opened yet')).toBeInTheDocument();
    expect(within(table).getByText('Link ran out')).toBeInTheDocument();
    expect(within(table).queryByText('Came Back')).toBeNull();
    expect(within(table).getByText('30 Oct 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send to Payroll' }));
    await waitFor(() => expect(personnel.sendHeldToPayroll).toHaveBeenCalled());
  });

  it('without Payroll on, nothing is offered to send', async () => {
    personnel.listInvites.mockResolvedValue(invites);
    render(<Joining params={{ view: 'forms' }} updateParams={() => {}} openScreen={() => {}} />);
    await screen.findByRole('table', { name: 'Forms not back' });
    expect(screen.queryByRole('button', { name: 'Send to Payroll' })).toBeNull();
  });

  it('a held set on the record has its own Send to Payroll once Payroll is on', async () => {
    ctx.apps = ['people', 'payroll'];
    render(<JoiningStatutory invite={{ id: 'i3', employeeId: 'e3', statutory: { status: 'HELD', values: { pan: 'ABCDE1234F' } } }} canView canApprove />);
    fireEvent.click(screen.getByRole('button', { name: 'Send to Payroll' }));
    await waitFor(() => expect(personnel.sendHeldToPayroll).toHaveBeenCalled());
    /* The state shown is the server's, read back after the send, not assumed. */
    await waitFor(() => expect(personnel.listEmployeeInvites).toHaveBeenCalledWith('e3'));
    expect(await screen.findByText('Approved and on the Payroll record')).toBeInTheDocument();
  });
});

describe('Plain words where a key showed', () => {
  it('a reminder task note drops its machine marker', () => {
    expect(taskNote('probation:2026-11-04. Confirm, extend or end it on their Employment tab.')).toBe('Confirm, extend or end it on their Employment tab.');
    expect(taskNote('Probation ends 4 Nov 2026. Confirm, extend or end it on their Employment tab.')).toBe('Probation ends 4 Nov 2026. Confirm, extend or end it on their Employment tab.');
    expect(taskNote(null)).toBe('');
  });
});
