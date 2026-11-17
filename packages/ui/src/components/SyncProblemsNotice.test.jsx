import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SyncProblemsNotice, { syncProblemWords } from './SyncProblemsNotice';

describe('the warning when the books here are not whole', () => {
  it('shows nothing when everything loaded', () => {
    const { container } = render(<SyncProblemsNotice problems={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(render(<SyncProblemsNotice />).container).toBeEmptyDOMElement();
  });

  it('names what did not load and says not to file', () => {
    render(<SyncProblemsNotice problems={[{ what: 'receipts', kind: 'failed' }, { what: 'bills', kind: 'failed' }, { what: 'receipts', kind: 'failed' }]} />);
    expect(screen.getByText('These figures may be short')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Receipts and bills did not load. Reports and returns on this page add up only what has loaded, so do not file from them yet.');
  });

  it('says which lists were too long to read whole', () => {
    expect(syncProblemWords([{ what: 'invoices', kind: 'short' }])).toBe('Invoices are too many to read in full here.');
    expect(syncProblemWords([{ what: 'bills', kind: 'failed' }, { what: 'invoices', kind: 'short' }, { what: 'expenses', kind: 'short' }, { what: 'credit notes', kind: 'short' }])).toBe(
      'Bills did not load; invoices, expenses and credit notes are too many to read in full here.',
    );
  });
});
