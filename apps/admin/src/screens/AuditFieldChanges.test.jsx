import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

/*
 * The edit log's before and after values on the audit trail: an entry with a diff folds under "N fields
 * changed" and opens to one "Field  old → new" row per field; masked values read "hidden", never the mask.
 */
vi.mock('@platform/admin/audit', () => ({ listAudit: vi.fn(), listAuditFacets: vi.fn() }));
vi.mock('@platform/context', () => ({ hasApp: () => true }));

const { FieldChanges } = await import('./AuditTrail');

describe('FieldChanges', () => {
  it('opens to one row per field, with nested settings and lists in words', () => {
    render(
      <FieldChanges
        changes={{
          name: { from: 'Clerks', to: 'Senior clerks' },
          permissions: { from: ['PEOPLE::Employees::VIEW'], to: ['PEOPLE::Employees::EDIT', 'PEOPLE::Employees::VIEW'] },
          'marks.graceMinutes': { from: 10, to: 15 },
          clientSecretEnc: { from: '[hidden]', to: '[hidden]' },
          description: { from: null, to: 'Front office' },
        }}
      />
    );
    const summary = screen.getByText('5 fields changed');
    fireEvent.click(summary);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    expect(rows[0].textContent).toBe('NameClerks→Senior clerks');
    expect(rows[1].textContent).toContain('PEOPLE::Employees::EDIT, PEOPLE::Employees::VIEW');
    expect(rows[2].textContent).toBe('Marks · Grace minutes10→15');
    expect(rows[3].textContent).toBe('Client secret enchidden→hidden');
    expect(rows[4].textContent).toBe('Description—→Front office');
    expect(document.body.textContent).not.toContain('[hidden]');
  });

  it('names the one field when only one changed, and shows nothing without a diff', () => {
    const { container, rerender } = render(<FieldChanges changes={{ designation: { from: 'Clerk', to: 'Lead' } }} />);
    expect(screen.getByText('1 field changed: Designation')).toBeTruthy();
    rerender(<FieldChanges changes={null} />);
    expect(container.textContent).toBe('');
    rerender(<FieldChanges changes={{ odd: 'not a diff' }} />);
    expect(container.textContent).toBe('');
  });
});
