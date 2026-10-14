import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import ResizableTables from './ResizableTables';

/**
 * Tables size to their content until somebody sizes a column.
 *
 * Every table used to be forced into fixed layout, which shares width out
 * evenly — so a money figure, which never wraps, was painted over the next
 * column on narrow windows.
 */

const Table = () => (
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th>Qty</th>
        <th>Value</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>MS Angle 50mm</td>
        <td>+25 Nos</td>
        <td>₹2,500.00</td>
      </tr>
    </tbody>
  </table>
);

describe('column resizing', () => {
  beforeEach(() => localStorage.clear());

  it('leaves a table nobody has resized in automatic layout, with handles ready', () => {
    const { container } = render(
      <>
        <Table />
        <ResizableTables />
      </>
    );
    const table = container.querySelector('table');
    expect(table.style.tableLayout).toBe('');
    expect(table.dataset.columnResizeReady).toBe('true');
    expect(container.querySelectorAll('.global-column-resizer')).toHaveLength(3);
  });

  it('switches to fixed layout when this table has saved widths', () => {
    // The key ResizableTables derives for the first table on this page.
    const labels = 'Item|Qty|Value';
    const storageKey = `app-table-widths:v1:${`${location.hash || location.pathname}:0:${labels}`.replace(/[^a-z0-9:_-]+/gi, '-').slice(0, 180)}`;
    localStorage.setItem(storageKey, JSON.stringify({ 1: 140 }));

    const { container } = render(
      <>
        <Table />
        <ResizableTables />
      </>
    );
    const table = container.querySelector('table');
    expect(table.style.tableLayout).toBe('fixed');
    expect(container.querySelectorAll('th')[1].style.width).toBe('140px');
  });
});
