import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import ListHeader, { FilterTabs, ListEmpty, SegmentedControl } from './ListHeader';

/*
 * People plan 8 Nov 2026, §3 rule 2 and step 3: one list header, breadcrumb
 * to title to one primary top right, toolbar, then tabs with counts. The
 * primary is drawn once; an empty state under it offers a secondary.
 */
it('draws the breadcrumb, the title, one line and exactly one primary, then the toolbar, then the tabs', () => {
  render(
    <ListHeader module="People" section="Joining & leaving" title="Offers" description="Every offer sent with an accept link."
      secondary={<button type="button" className="ui-btn ui-btn-secondary">Export</button>}
      primary={{ label: 'Make an offer', onClick: () => {} }}
      toolbar={<input aria-label="Search offers" />}
      tabs={[{ key: 'open', label: 'Waiting', count: 3, tone: 'warn' }, { key: 'all', label: 'All', count: 0 }]} tab="open" onTab={() => {}} />,
  );
  const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getAllByRole('listitem').map((li) => li.textContent);
  expect(crumbs).toEqual(['People', 'Joining & leaving', 'Offers']);
  expect(screen.getByRole('heading', { level: 1, name: 'Offers' })).toBeTruthy();
  expect(screen.getByText('Every offer sent with an accept link.')).toBeTruthy();
  expect(document.querySelectorAll('.ui-btn-primary')).toHaveLength(1);
  /* Order on the page: title row, toolbar, tabs. */
  const header = screen.getByRole('banner');
  const order = [...header.querySelectorAll('h1, input, [role="tablist"]')].map((el) => el.tagName + (el.getAttribute('role') || ''));
  expect(order).toEqual(['H1', 'INPUT', 'DIVtablist']);
  /* A tab carries its count; a count of nought is not drawn. */
  expect(within(screen.getByRole('tab', { name: /Waiting/ })).getByText('3').className).toContain('ui-tab-count');
  expect(screen.getByRole('tab', { name: 'All' }).textContent).toBe('All');
});

it('the primary can be a ready element, and a header with no primary draws none', () => {
  const { unmount } = render(<ListHeader title="Tasks" primary={<button type="button" className="ui-btn ui-btn-primary" aria-busy="true">Saving</button>} />);
  expect(document.querySelectorAll('.ui-btn-primary')).toHaveLength(1);
  unmount();
  render(<ListHeader title="Tasks" description="Every step, whose it is and when it is due." />);
  expect(document.querySelectorAll('.ui-btn-primary')).toHaveLength(0);
  expect(screen.getByText('Every step, whose it is and when it is due.')).toBeTruthy();
});

it('an empty state under the header says its sentence and offers a secondary, never a second primary', () => {
  render(
    <>
      <ListHeader title="Documents" primary={{ label: 'New document', onClick: () => {} }} />
      <ListEmpty title="No documents yet" description="Documents added on a person's record are listed with who may see them." routes={[{ label: 'New document', onSelect: () => {} }]} />
    </>,
  );
  expect(screen.getByText("Documents added on a person's record are listed with who may see them.")).toBeTruthy();
  const buttons = screen.getAllByRole('button', { name: 'New document' });
  expect(buttons).toHaveLength(2);
  expect(buttons.filter((b) => b.className.includes('ui-btn-primary'))).toHaveLength(1);
  expect(buttons.filter((b) => b.className.includes('ui-btn-secondary'))).toHaveLength(1);
});

it('tabs answer a click with their key, and the segmented switch is a radio group with one chosen', () => {
  const onChange = vi.fn();
  render(<FilterTabs label="Leave" tabs={[{ key: 'PENDING', label: 'Waiting', count: 2 }, { key: 'all', label: 'All' }]} value="PENDING" onChange={onChange} />);
  fireEvent.click(screen.getByRole('tab', { name: 'All' }));
  expect(onChange).toHaveBeenCalledWith('all');
  expect(screen.getByRole('tab', { name: /Waiting/ }).getAttribute('aria-selected')).toBe('true');

  const onView = vi.fn();
  render(<SegmentedControl label="View" options={[{ key: 'day', label: 'Day' }, { key: 'month', label: 'Month' }]} value="day" onChange={onView} />);
  const group = screen.getByRole('radiogroup', { name: 'View' });
  expect(within(group).getByRole('radio', { name: 'Day' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(within(group).getByRole('radio', { name: 'Month' }));
  expect(onView).toHaveBeenCalledWith('month');
});
