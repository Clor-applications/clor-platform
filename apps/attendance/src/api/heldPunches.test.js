import { beforeEach, expect, it, vi } from 'vitest';

import { decideHeldPunches, getHeldPunches } from './attendance';
import { apiFetch } from '@platform/http';

/* Final review of #144: what the held-punch calls send, so a field the screen sets is never dropped on the way. */
vi.mock('@platform/http', () => ({ API_BASE: '', apiFetch: vi.fn(() => Promise.resolve({})) }));
vi.mock('@platform/context', () => ({ requireOrgId: () => 'org1' }));

beforeEach(() => vi.clearAllMocks());

it('Count all sends the minutes to move the punches back by', async () => {
  await decideHeldPunches({ action: 'release', deviceId: 'd1', month: '2026-10', shiftMinutes: 20 });
  expect(apiFetch).toHaveBeenCalledWith('/orgs/org1/attendance/held-punches/bulk', expect.objectContaining({ method: 'POST', body: { action: 'release', deviceId: 'd1', month: '2026-10', shiftMinutes: 20 } }));
});

it('counted as recorded, or a discard, sends no shift', async () => {
  await decideHeldPunches({ action: 'discard', deviceId: 'd1' });
  expect(apiFetch).toHaveBeenCalledWith('/orgs/org1/attendance/held-punches/bulk', expect.objectContaining({ body: { action: 'discard', deviceId: 'd1', month: null } }));
});

it('asks for one month only when given one', async () => {
  await getHeldPunches('2026-10');
  expect(apiFetch).toHaveBeenCalledWith('/orgs/org1/attendance/held-punches?month=2026-10', expect.anything());
});
