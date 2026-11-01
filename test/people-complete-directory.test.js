import { beforeEach, expect, it, vi } from 'vitest';
import { listAllEmployees } from '../packages/ui/src/personnel/api';
import { apiFetch } from '@platform/http';
vi.mock('@platform/http', () => ({ apiFetch: vi.fn() }));
vi.mock('@platform/context', () => ({ orgId: () => 'company', requireOrgId: () => 'company' }));
beforeEach(() => apiFetch.mockReset());
it('includes employees beyond the first API page in reports and pickers', async () => {
  const first = Array.from({ length: 500 }, (_, i) => ({ id: `employee-${i}` }));
  apiFetch.mockResolvedValueOnce({ employees: first, total: 501 }).mockResolvedValueOnce({ employees: [{ id: 'employee-500' }], total: 501 });
  const directory = await listAllEmployees();
  expect(directory.employees).toHaveLength(501);
  expect(directory.employees.at(-1).id).toBe('employee-500');
  expect(apiFetch.mock.calls[1][0]).toContain('offset=500');
});
it('fails a report if any page fails instead of exporting a partial directory', async () => {
  apiFetch.mockResolvedValueOnce({ employees: Array.from({ length: 500 }, (_, i) => ({ id: i })), total: 501 }).mockRejectedValueOnce(new Error('Page unavailable'));
  await expect(listAllEmployees()).rejects.toThrow('Page unavailable');
});
