import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import Automations from './Automations';
import ExitQuestions from './ExitQuestions';
import { codeOf } from './exitAnswerCode';

/*
 * Settings → Automations and Settings → Exit interview (WORKFLOW-GAP-RESEARCH 4.7, 4.9): switches that
 * save at once, a number in its sentence, what is set elsewhere linked there, a read-only view for a
 * role that may not change them; the questions with one main reason and a keeping period.
 */
const api = vi.hoisted(() => ({
  getAutomations: vi.fn(),
  saveAutomations: vi.fn(),
  getExitQuestions: vi.fn(),
  saveExitQuestions: vi.fn(),
  resetExitQuestions: vi.fn(),
}));
vi.mock('../api/engagement', () => api);
vi.mock('@platform/context', () => ({ orgId: () => 'org1' }));
const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@ui/components/ui/notify', () => dialogs);

const row = (over) => ({ group: 'Joining and leaving', on: false, n: null, range: null, defaultOn: false, managedIn: null, when: 'Every morning', lastRun: null, lastChecked: null, nextRun: null, ...over });
const AUTOS = [
  row({ key: 'taskDigest', sentence: 'Send each task owner a morning list of joining and leaving tasks due or late', on: true, defaultOn: true, when: 'Every morning from 9', lastRun: { on: '2026-10-29', count: 2, recipients: ['Meera Shah', 'Arun Rao'] }, nextRun: 'Every morning from 9' }),
  row({ key: 'probationEnds', sentence: 'Tell HR when probation ends in {n} days, and on the day', on: true, n: 14, range: { min: 1, max: 60 }, when: 'Once a day', nextRun: 'Once a day' }),
  row({ key: 'birthdays', group: 'Celebrations and holidays', sentence: 'Tell the team on someone’s birthday' }),
  row({ key: 'missingPunch', group: 'Leave and attendance', sentence: 'Remind people who forgot to punch, and give managers the list', on: true, managedIn: { screen: 'attendanceRules', label: 'Attendance rules' }, when: 'Every hour' }),
];

beforeEach(() => {
  vi.clearAllMocks();
  api.getAutomations.mockResolvedValue({ automations: AUTOS, canEdit: true });
});

it('automations: groups of plain sentences; what already ran says when it last sent and to whom', async () => {
  render(<Automations />);
  expect(await screen.findByRole('heading', { name: 'Joining and leaving' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Celebrations and holidays' })).toBeTruthy();
  expect(screen.getByText(/Last sent .*2: Meera Shah, Arun Rao/)).toBeTruthy();
  expect(screen.getByRole('switch', { name: 'Tell the team on someone’s birthday' }).getAttribute('aria-checked')).toBe('false');
});

it('automations: a switch saves at once; the number saves when the field is left', async () => {
  api.saveAutomations.mockImplementation(async (patch) => ({ automations: AUTOS.map((a) => (patch[a.key] ? { ...a, ...patch[a.key] } : a)) }));
  render(<Automations />);
  fireEvent.click(await screen.findByRole('switch', { name: 'Tell the team on someone’s birthday' }));
  await waitFor(() => expect(api.saveAutomations).toHaveBeenCalledWith({ birthdays: { on: true } }));
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Tell the team on someone’s birthday' }).getAttribute('aria-checked')).toBe('true'));
  const days = screen.getByRole('spinbutton', { name: /probation ends in/ });
  fireEvent.change(days, { target: { value: '15' } });
  fireEvent.blur(days);
  await waitFor(() => expect(api.saveAutomations).toHaveBeenCalledWith({ probationEnds: { n: 15 } }));
  /* Out of range: refused before it is sent. */
  fireEvent.change(screen.getByRole('spinbutton', { name: /probation ends in/ }), { target: { value: '90' } });
  fireEvent.blur(screen.getByRole('spinbutton', { name: /probation ends in/ }));
  expect(dialogs.notify.error).toHaveBeenCalledWith('Choose 1 to 60 days.');
  expect(api.saveAutomations).toHaveBeenCalledTimes(2);
});

it('automations: one set under Attendance rules links there and cannot be switched here', async () => {
  const openScreen = vi.fn();
  render(<Automations openScreen={openScreen} />);
  const sw = await screen.findByRole('switch', { name: /forgot to punch/ });
  expect(sw.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Attendance rules' }));
  expect(openScreen).toHaveBeenCalledWith('attendanceRules');
});

it('automations: read only for a role that may not change them', async () => {
  api.getAutomations.mockResolvedValue({ automations: AUTOS, canEdit: false });
  render(<Automations />);
  expect(await screen.findByText('HR changes these.')).toBeTruthy();
  expect(screen.getAllByRole('switch').every((s) => s.disabled)).toBe(true);
  expect(screen.queryByRole('spinbutton')).toBeNull();
});

const QUESTIONS = [
  { key: 'reason', text: 'What is the main reason you are leaving?', kind: 'REASON', options: [{ code: 'PAY', label: 'Better pay elsewhere' }, { code: 'GROWTH', label: 'Career growth' }] },
  { key: 'keptYou', text: 'What would have made you stay?', kind: 'TEXT' },
];

it('exit questions: the main reason stays; a question is added and saved with its answers kept by code', async () => {
  api.getExitQuestions.mockResolvedValue({ questions: QUESTIONS, keepMonths: 24, custom: false, canEdit: true });
  api.saveExitQuestions.mockImplementation(async (b) => ({ ...b, custom: true, canEdit: true }));
  render(<ExitQuestions />);
  const save = await screen.findByRole('button', { name: 'Save' });
  expect(save.disabled).toBe(true);
  expect(screen.getByText('Question 1: the main reason')).toBeTruthy();
  /* Only the other questions can be removed. */
  expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Answers to choose from, one per line'), { target: { value: 'Better pay elsewhere\nCareer growth\nMoving city' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
  const third = screen.getByText('Question 3').closest('label');
  fireEvent.change(within(third).getByRole('combobox', { hidden: true }) || within(third).getByRole('textbox'), { target: { value: 'Was your notice period fair?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.saveExitQuestions).toHaveBeenCalled());
  const body = api.saveExitQuestions.mock.calls[0][0];
  expect(body.keepMonths).toBe(24);
  expect(body.questions[0].options).toEqual([{ code: 'PAY', label: 'Better pay elsewhere' }, { code: 'GROWTH', label: 'Career growth' }, { code: 'MOVING_CITY', label: 'Moving city' }]);
  expect(body.questions[2]).toMatchObject({ kind: 'TEXT', text: 'Was your notice period fair?' });
});

it('exit questions: a refusal from the server is shown; read only without the right', async () => {
  api.getExitQuestions.mockResolvedValue({ questions: QUESTIONS, keepMonths: 24, custom: true, canEdit: true });
  api.saveExitQuestions.mockRejectedValue(new Error('Keep one question for the main reason: the report counts it.'));
  render(<ExitQuestions />);
  fireEvent.change(await screen.findByDisplayValue('24'), { target: { value: '12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toMatch(/main reason/);
});

it('answers in another script each get their own code; a label already saved keeps its code', () => {
  const a = codeOf('बेहतर वेतन');
  const b = codeOf('करियर में बढ़त');
  expect(a).not.toBe(b);
  expect(a).toMatch(/^[A-Z0-9_]{1,24}$/);
  expect(a).not.toBe('OTHER');
  expect(codeOf('बेहतर वेतन')).toBe(a);
  expect(codeOf('Better pay')).toBe('BETTER_PAY');
  expect(codeOf('बेहतर वेतन', [{ code: 'PAY', label: 'बेहतर वेतन' }])).toBe('PAY');
});

it('a role that may only read sees no last-run line, and is not told "nothing sent"', async () => {
  api.getAutomations.mockResolvedValue({ canEdit: false, automations: [row({ key: 'birthdays', group: 'Celebrations', sentence: 'Tell the team on someone’s birthday', on: true, lastRun: null, when: 'Every morning' })] });
  render(<Automations />);
  await screen.findByText('Tell the team on someone’s birthday');
  expect(screen.queryByText(/Nothing sent yet/)).toBeNull();
  expect(screen.queryByText(/Last sent/)).toBeNull();
  expect(screen.getByRole('switch').disabled).toBe(true);
});

it('automations sit on the page ground, not in a card; each switch is a 44px target', async () => {
  api.getAutomations.mockResolvedValue({ canEdit: true, automations: [row({ key: 'birthdays', group: 'Celebrations', sentence: 'Tell the team on someone’s birthday', on: true, lastRun: null, when: 'Every morning' })] });
  const { container } = render(<Automations />);
  await screen.findByText('Tell the team on someone’s birthday');
  expect(container.querySelector('.ui-record-section, .ui-card')).toBeNull();
  expect(screen.getByRole('switch').className).toMatch(/\bh-11\b/);
});
