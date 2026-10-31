import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import PlanDrawer from './Plan';

/* The leaving plan's header reads the latest leaving, not the list row it was opened from (QA on #81). */
const api = vi.hoisted(() => ({
  OWNER_WORD: { HR: 'HR' },
  leavingExtras: vi.fn(),
  leavingPreview: vi.fn(async () => null),
  startPlan: vi.fn(),
  orgUsers: vi.fn(async () => []),
  withOwner: (u) => u,
}));
vi.mock('./api', () => api);
vi.mock('@ui/personnel/api', () => ({ getChecklist: vi.fn(async () => ({ leaving: { tasks: [], done: 0, total: 0 } })) }));
vi.mock('@platform/context', () => ({ hasApp: () => false, orgId: () => 'org1' }));

const row = { id: 'e1', name: 'Vikram Kumar', dateOfLeaving: '2026-11-20', stageLabel: 'On notice' };

it('right after "They stay", the open plan says they are staying, not "On notice"', async () => {
  api.leavingExtras.mockResolvedValue({ person: { id: 'e1', name: 'Vikram Kumar', status: 'ACTIVE', dateOfLeaving: null }, clearance: { leaving: false, lines: [], totals: null, open: 0, found: null }, finalPay: null, interview: null, canEdit: true });
  render(<PlanDrawer row={row} kind="LEAVING" canEdit onClose={() => {}} />);
  expect(await screen.findByText('Staying on: the leaving was withdrawn')).toBeTruthy();
  expect(screen.queryByText(/On notice/)).toBeNull();
  /* And nothing of a leaving is offered: no "Start it now", no final pay. */
  expect(screen.getByText(/They stay\. The leaving was withdrawn/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Start it now' })).toBeNull();
  expect(screen.queryByText(/No leaving plan yet/)).toBeNull();
});

it('a moved last day shows the new day', async () => {
  api.leavingExtras.mockResolvedValue({ person: { id: 'e1', name: 'Vikram Kumar', status: 'ON_NOTICE', dateOfLeaving: '2026-12-04' }, clearance: { leaving: true, lines: [], totals: null, open: 0, found: null }, finalPay: null, interview: null, canEdit: true });
  render(<PlanDrawer row={row} kind="LEAVING" canEdit onClose={() => {}} />);
  expect(await screen.findByText('Last day 4 Dec 2026')).toBeTruthy();
});
