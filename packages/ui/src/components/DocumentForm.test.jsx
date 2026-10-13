import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AmountInWordsBand } from './DocumentForm';

describe('AmountInWordsBand', () => {
  /*
   * The words print on a GST invoice and earn their place. The numeral beside
   * them did not: it repeated the Total in the column above and the running
   * total pinned at the foot, so the same figure sat on screen three times.
   */
  it('writes the amount out and does not restate it as a figure', () => {
    render(<AmountInWordsBand words="Rupees Two Thousand Nine Hundred Fifty Only" />);
    expect(screen.getByText(/Rupees Two Thousand Nine Hundred Fifty Only/)).toBeInTheDocument();
    expect(screen.queryByText(/Total payable/i)).toBeNull();
    expect(screen.queryByText(/2,950/)).toBeNull();
  });
});
