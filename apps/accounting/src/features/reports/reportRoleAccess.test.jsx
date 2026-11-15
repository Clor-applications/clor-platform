import { describe, expect, it } from 'vitest';
import { reportSidebarItems, reportViewPermission } from './ReportsWorkspace';

describe('report role access', () => {
  it('shows only report groups and statements granted to a role', () => {
    const allowed = new Set(['REPORTS::Purchase Reports::VIEW', 'REPORTS::Balance Sheet::VIEW']);
    const items = reportSidebarItems(() => true, (permission) => allowed.has(permission));
    const labels = items.filter((item) => item.type !== 'subgroup').map((item) => item.label);
    expect(labels).toEqual(['Purchases', 'Balance Sheet']);
  });

  it('keeps statutory reports separate from the rest of the GST group', () => {
    expect(reportViewPermission({ name: 'GSTR-1', bucketKey: 'gst' })).toBe('REPORTS::GSTR-1::VIEW');
    expect(reportViewPermission({ name: 'GST Sales Register', bucketKey: 'gst' })).toBe('REPORTS::GST Reports::VIEW');
  });
});
