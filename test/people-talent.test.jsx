import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * Talent (docs/people/design-v1/TALENT-DECISIONS.md; audit 30 Oct 2026 gaps 1, 2, 11): the
 * screens run on /people/talent/*, not the retired register; each offers only what the grant
 * allows; every Talent notice opens a screen that exists; the employee app shows My goals.
 */
const talent = vi.hoisted(() => ({
  listOpenings: vi.fn(), getOpening: vi.fn(), setApplyLink: vi.fn(), setOpeningStatus: vi.fn(), createOpening: vi.fn(),
  listCandidates: vi.fn(), getCandidate: vi.fn(), moveCandidate: vi.fn(), addCandidate: vi.fn(), giveFeedback: vi.fn(), interviewers: vi.fn(async () => []),
  listInterviews: vi.fn(), listPlans: vi.fn(), listCycles: vi.fn(), getCycle: vi.fn(), writeManager: vi.fn(), listGoals: vi.fn(), expiringCertificates: vi.fn(), listTrainings: vi.fn(),
}));
const portal = vi.hoisted(() => ({ getGrowth: vi.fn(), checkInGoal: vi.fn(async () => ({})), writeSelfReview: vi.fn(async () => ({})), acknowledgeReview: vi.fn(async () => ({})) }));
vi.mock('../apps/people/src/api/talent', async (orig) => ({ ...(await orig()), ...talent }));
vi.mock('../apps/attendance/src/portal/portalApi', async (orig) => ({ ...(await orig()), ...portal }));
vi.mock('@ui/personnel/api', async (orig) => ({ ...(await orig()), listAllEmployees: vi.fn(async () => ({ employees: [] })) }));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { PermissionContext } from '../packages/ui/src/permissions/context';
import Candidates from '../apps/people/src/talent/Candidates';
import Openings from '../apps/people/src/talent/Openings';
import Interviews from '../apps/people/src/talent/Interviews';
import Reviews from '../apps/people/src/talent/Reviews';
import Trainings from '../apps/people/src/talent/Trainings';
import Plans from '../apps/people/src/talent/Plans';
import Goals from '../apps/people/src/talent/Goals';
import MyGrowth from '../apps/attendance/src/portal/MyGrowth';
import { peopleApp } from '../apps/people/manifest.jsx';
import { WORKSPACE_CONFIG } from '../apps/people/src/screens/workspaceConfig';

const withPerms = (keys, ui) => <PermissionContext.Provider value={{ permissions: new Set(keys), isAdmin: false }}>{ui}</PermissionContext.Provider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const meera = { id: 'c1', name: 'Meera K', email: 'meera@example.com', phone: '9800000001', source: 'REFERRAL', stage: 'INTERVIEW', stageAt: '2026-10-20T05:00:00Z', openingId: 'o1', openingTitle: 'Accountant', resume: null, resumeUrl: null };
const opening = { id: 'o1', title: 'Accountant', status: 'OPEN', places: 1, active: 1, hired: 0, departmentName: 'Finance', applyOpen: false, stages: {} };

describe('Talent runs on its own routes, and the register is retired for it', () => {
  it('the register keeps only announcements, events, help desk, assets and benefits', () => {
    for (const kind of ['recruitment', 'candidates', 'performance', 'learning']) expect(WORKSPACE_CONFIG[kind], kind).toBeUndefined();
    const src = readFileSync('apps/people/src/api/workspace.js', 'utf8');
    expect(src).not.toMatch(/hireCandidate/);
  });

  it('Talent screens and the side panels never call /people/workspace for hiring, goals or training', () => {
    for (const f of ['apps/people/src/panels.jsx', 'apps/people/manifest.jsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/registerPanel\('(recruitment|candidates|performance|learning)'\)|register\('(recruitment|candidates|performance|learning)'\)/);
    }
  });

  it('every Talent notice names a People screen that exists', () => {
    const files = ['hiring.ts', 'growth.ts', 'training.ts'].map((f) => `server/src/services/people/talent/${f}`).concat('server/src/services/people/offers.ts', 'server/src/services/people/home.ts');
    const screens = new Set();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/app: 'people', screen: '([a-zA-Z]+)'/g)) screens.add(m[1]);
    for (const m of readFileSync('server/src/services/people/home.ts', 'utf8').matchAll(/key: 'candidates'[^}]*screen: '([a-zA-Z]+)'/g)) screens.add(m[1]);
    expect([...screens]).toEqual(expect.arrayContaining(['recruitment', 'candidates', 'interviews', 'reviews', 'learning']));
    for (const s of screens) expect(peopleApp.screens[s], s).toBeTruthy();
  });

  it('Talent sits on the rail as Hiring and Performance, gated by the module switches', () => {
    /* Two rail sections since the R&D hand-off (14 Nov 2026). */
    const itemsOf = (key) => peopleApp.modules.find((m) => m.key === key).groups.flatMap((g) => g.items);
    /* Refer someone is the primary action on Referrals (People plan, 8 Nov 2026), not a menu entry; its address stays. */
    expect(itemsOf('hiring')).toEqual(['recruitment', 'candidates', 'interviews', 'referrals']);
    expect(itemsOf('performance')).toEqual(['performance', 'reviews', 'oneOnOnes', 'plans', 'learning']);
    const nav = Object.fromEntries(peopleApp.nav.map((i) => [i.key, i]));
    for (const k of ['recruitment', 'candidates', 'interviews', 'referrals', 'referMe']) expect(nav[k].feature, k).toBe('peopleHiring');
    expect(nav.referMe.parent).toBe('referrals');
    /* Referrals: HR's list needs Recruitment; anyone who works here may refer (the server finds their record). */
    expect(nav.referrals.permission).toBe('PEOPLE::Recruitment::VIEW');
    expect(nav.referMe.permission).toBeUndefined();
    for (const k of ['performance', 'reviews', 'oneOnOnes', 'plans', 'learning']) expect(nav[k].feature, k).toBe('peoplePerformance');
    /* Anyone can be asked to interview or manage someone: these two need no right of their own. */
    expect(nav.interviews.permission).toBeUndefined();
    expect(nav.oneOnOnes.permission).toBeUndefined();
  });
});

describe('Candidates', () => {
  const list = { rows: [meera], total: 1, counts: { open: 1, INTERVIEW: 1 } };

  it('a viewer sees the pipeline but no Add and no move', async () => {
    talent.listOpenings.mockResolvedValue([opening]);
    talent.listCandidates.mockResolvedValue(list);
    render(withPerms(['PEOPLE::Recruitment::VIEW'], <Candidates />));
    expect(await screen.findAllByText('Meera K')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Add candidate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it('with Edit, a row moves to another stage from its menu', async () => {
    const user = userEvent.setup();
    talent.listOpenings.mockResolvedValue([opening]);
    talent.listCandidates.mockResolvedValue(list);
    talent.moveCandidate.mockResolvedValue({ ok: true });
    render(withPerms(['PEOPLE::Recruitment::VIEW', 'PEOPLE::Recruitment::CREATE', 'PEOPLE::Recruitment::EDIT'], <Candidates />));
    expect(await screen.findByRole('button', { name: /Add candidate/ })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /Actions for/ })[0]);
    await user.click(screen.getByRole('menuitem', { name: 'Move to offer' }));
    await waitFor(() => expect(talent.moveCandidate).toHaveBeenCalledWith('c1', 'OFFER'));
  });

  it('opened from a notice about one opening, it lists that opening only', async () => {
    talent.listOpenings.mockResolvedValue([opening]);
    talent.listCandidates.mockResolvedValue(list);
    render(withPerms(['PEOPLE::Recruitment::VIEW'], <Candidates params={{ opening: 'o1' }} />));
    await screen.findAllByText('Meera K');
    expect(talent.listCandidates).toHaveBeenCalledWith(expect.objectContaining({ openingId: 'o1' }));
  });

  it('a candidate opened by id shows the next step as the one primary action', async () => {
    talent.listOpenings.mockResolvedValue([opening]);
    talent.listCandidates.mockResolvedValue(list);
    talent.getCandidate.mockResolvedValue({ candidate: meera, timeline: [], interviews: [], offers: [] });
    render(withPerms(['PEOPLE::Recruitment::VIEW', 'PEOPLE::Recruitment::EDIT', 'PEOPLE::Documents::CREATE', 'PEOPLE::Employees::CREATE'], <Candidates params={{ id: 'c1' }} />));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('button', { name: 'Send an offer' })).toHaveClass('ui-btn-primary');
    expect(within(dialog).getByRole('button', { name: 'Not taken forward' })).toBeInTheDocument();
  });
});

describe('Job openings', () => {
  it('makes an apply link and shows it once, to copy', async () => {
    const user = userEvent.setup();
    talent.listOpenings.mockResolvedValue([opening]);
    talent.getOpening.mockResolvedValue(opening);
    talent.setApplyLink.mockResolvedValue({ applyOpen: true, link: 'http://127.0.0.1:5190/api/people/apply/abc' });
    render(withPerms(['PEOPLE::Recruitment::VIEW', 'PEOPLE::Recruitment::EDIT'], <Openings params={{ id: 'o1' }} />));
    await user.click(await screen.findByRole('button', { name: 'Make a link' }));
    expect(await screen.findByDisplayValue('http://127.0.0.1:5190/api/people/apply/abc')).toBeInTheDocument();
    expect(talent.setApplyLink).toHaveBeenCalledWith('o1', true);
  });

  it('a manager who may only ask sees Ask for an opening, not New opening', async () => {
    talent.listOpenings.mockResolvedValue([]);
    render(withPerms(['PEOPLE::Recruitment::VIEW', 'PEOPLE::Recruitment::CREATE'], <Openings />));
    expect((await screen.findAllByRole('button', { name: /Ask for an opening/ })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /New opening/ })).not.toBeInTheDocument();
  });
});

describe('Interviews', () => {
  it('an interviewer opens the interview from its notice and gives feedback', async () => {
    const user = userEvent.setup();
    talent.listInterviews.mockResolvedValue({ hr: false, interviews: [{ id: 'i1', at: '2026-10-30T05:30:00Z', minutes: 45, mode: 'VIDEO', status: 'SCHEDULED', candidate: { id: 'c1', name: 'Meera K', stage: 'INTERVIEW' }, openingTitle: 'Accountant', interviewers: ['Ira'], mine: true, owesFeedback: true }] });
    talent.getCandidate.mockResolvedValue({ candidate: { ...meera, email: null, phone: null }, timeline: [], offers: [], interviews: [{ id: 'i1', at: '2026-10-30T05:30:00Z', minutes: 45, mode: 'VIDEO', status: 'SCHEDULED', interviewers: [{ id: 'u1', name: 'Ira', gave: false }], mineToGive: true, feedback: [], feedbackHidden: true }] });
    talent.giveFeedback.mockResolvedValue({ ok: true });
    render(withPerms([], <Interviews params={{ id: 'i1' }} />));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Accountant', { exact: false });
    expect(within(dialog).queryByText('meera@example.com')).not.toBeInTheDocument();
    expect(await within(dialog).findByText(/You see it once you give yours/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Give my feedback' }));
    await user.click(await screen.findByText('Strong yes'));
    await user.click(screen.getByRole('button', { name: 'Give feedback' }));
    await waitFor(() => expect(talent.giveFeedback).toHaveBeenCalledWith('i1', { recommendation: 'STRONG_YES', notes: null }));
  });
});

describe('Links to something no longer there', () => {
  it('an interview cancelled since its notice says so, instead of doing nothing', async () => {
    talent.listInterviews.mockResolvedValue({ hr: false, interviews: [] });
    render(withPerms([], <Interviews params={{ id: 'gone' }} />));
    expect(await screen.findByText(/This interview was cancelled or has moved/)).toBeInTheDocument();
    expect(talent.listInterviews).toHaveBeenCalledWith({ when: 'all' });
  });

  it('a decided plan opens from its link even though it is off the Running tab', async () => {
    const plan = { id: 'p1', status: 'COMPLETED', employee: { name: 'Priya' }, manager: { name: 'Rahul' }, startDate: '2026-07-01', endDate: '2026-09-30', reason: 'Late closes', expectations: 'Close by the 5th', outcomeNote: 'Met', notes: [] };
    talent.listPlans.mockImplementation(async ({ status }) => ({ plans: status === 'all' ? [plan] : [], me: null, reports: [], hr: true }));
    render(withPerms(['PEOPLE::Performance::VIEW'], <Plans params={{ id: 'p1' }} />));
    expect(await screen.findByRole('dialog', { name: 'Plan: Priya' })).toBeInTheDocument();
  });
});

describe('Growth offers only what the person may do', () => {
  it('New plan is for HR or someone with reports, not every viewer', async () => {
    talent.listPlans.mockResolvedValue({ plans: [], me: { id: 'e9', name: 'Arjun' }, reports: [], hr: false });
    render(withPerms(['PEOPLE::Performance::VIEW'], <Plans />));
    await screen.findByText('No plans running');
    expect(screen.queryByRole('button', { name: /New plan/ })).not.toBeInTheDocument();
    cleanup();
    talent.listPlans.mockResolvedValue({ plans: [], me: { id: 'e2', name: 'Rahul' }, reports: [{ id: 'e3', name: 'Priya' }], hr: false });
    render(withPerms(['PEOPLE::Performance::VIEW'], <Plans />));
    expect(await screen.findByRole('button', { name: /New plan/ })).toBeInTheDocument();
  });

  it('without the directory, a new goal is for the viewer themselves', async () => {
    const user = userEvent.setup();
    talent.listGoals.mockResolvedValue({ goals: [], me: { id: 'e9', name: 'Arjun Rao', code: 'AT-4' }, reports: [], hr: false });
    render(withPerms(['PEOPLE::Performance::VIEW'], <Goals />));
    await user.click((await screen.findAllByRole('button', { name: /New goal/ }))[0]);
    expect(await screen.findByRole('combobox', { name: 'Person *' })).toHaveTextContent('Arjun Rao (AT-4)');
  });
});

describe('Reviews', () => {
  it('a manager opens the cycle from the notice and sees the reviews that are theirs to write', async () => {
    talent.listCycles.mockResolvedValue({ hr: false, cycles: [] });
    talent.getCycle.mockResolvedValue({ cycle: { id: 'y1', name: '2026–27 annual review', status: 'OPEN', periodFrom: '2026-04-01', periodTo: '2027-03-31' }, reviews: [{ id: 'r1', employee: { id: 'e1', name: 'Priya' }, department: 'Sales', manager: { id: 'e2', name: 'Rahul' }, mineToWrite: true, own: false, selfAt: null, managerAt: null }] });
    render(withPerms(['PEOPLE::Performance::VIEW'], <Reviews params={{ id: 'y1' }} />));
    expect(await screen.findByText('One review is yours to write.')).toBeInTheDocument();
    expect(screen.getAllByText('Yours to write').length).toBeGreaterThan(0);
    /* Moving the cycle is HR's. */
    expect(screen.queryByRole('button', { name: 'Start calibration' })).not.toBeInTheDocument();
  });
});

describe('Training', () => {
  it('opens on expiring certificates from the renewal notice', async () => {
    talent.expiringCertificates.mockResolvedValue([{ id: 's1', trainingId: 't1', trainingTitle: 'Fire safety', employee: { name: 'Arjun' }, completedOn: '2025-11-01', expiresOn: '2026-11-01', expiringSoon: true, expired: false }]);
    render(withPerms(['PEOPLE::Learning::VIEW'], <Trainings params={{ view: 'expiring' }} />));
    expect((await screen.findAllByText('Arjun')).length).toBeGreaterThan(0);
    expect(talent.listTrainings).not.toHaveBeenCalled();
  });
});

describe('My goals in the employee app', () => {
  const growth = {
    on: true,
    goals: [{ id: 'g1', title: 'Close 20 new accounts', measure: 'Signed orders', dueDate: '2027-03-31', progress: 40, health: 'ON_TRACK', status: 'ACTIVE' }],
    reviews: [
      { id: 'r1', cycle: '2026–27 annual review', period: '2026-04-01 – 2027-03-31', canWriteSelf: true, selfAt: null, shared: false },
      { id: 'r0', cycle: '2025–26 annual review', period: '2025-04-01 – 2026-03-31', canWriteSelf: false, selfAt: '2026-03-10T05:00:00Z', shared: true, finalRating: 4, managerText: 'Strong year.', acknowledgedAt: null },
    ],
    plans: [], oneOnOnes: [], trainings: [],
  };

  it('checks in on a goal, writes the self-review, and marks a shared review as read', async () => {
    const user = userEvent.setup();
    portal.getGrowth.mockResolvedValue(growth);
    render(<MyGrowth guard={(p) => p} />);
    expect(await screen.findByText('Close 20 new accounts')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check in' }));
    await user.clear(screen.getByLabelText('Progress (%)'));
    await user.type(screen.getByLabelText('Progress (%)'), '55');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(portal.checkInGoal).toHaveBeenCalledWith('g1', { progress: 55, health: 'ON_TRACK', note: null }));

    await user.click(await screen.findByRole('button', { name: 'Write my self-review' }));
    await user.selectOptions(screen.getByLabelText('How did the period go?'), '4');
    await user.type(screen.getByLabelText('What you did and what you want to work on'), 'Opened Mysuru.');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(portal.writeSelfReview).toHaveBeenCalledWith('r1', { selfRating: 4, selfText: 'Opened Mysuru.' }));

    expect(screen.getByText('Strong year.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I have read it' }));
    await waitFor(() => expect(portal.acknowledgeReview).toHaveBeenCalledWith('r0'));
  });

  it('says nothing while the company has Performance off', async () => {
    portal.getGrowth.mockResolvedValue({ on: false, goals: [], reviews: [], plans: [], oneOnOnes: [], trainings: [] });
    const { container } = render(<MyGrowth guard={(p) => p} />);
    await waitFor(() => expect(portal.getGrowth).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
