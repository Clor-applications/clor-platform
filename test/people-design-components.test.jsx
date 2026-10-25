import React, { useState } from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SearchField from '../packages/ui/src/components/ui/SearchField';
import RecordTabs from '../packages/ui/src/components/ui/RecordTabs';
import Alert from '../packages/ui/src/components/ui/Alert';
import ErrorState, { errorKind } from '../packages/ui/src/components/ui/ErrorState';
import ActivityTimeline from '../packages/ui/src/components/ui/ActivityTimeline';
import DatePicker, { formatDate, parseDate } from '../packages/ui/src/components/ui/DatePicker';
import { PageHeader } from '../packages/ui/src/components/ui/Primitives';

/* People design spec v1 §5 and §5.1: the shared components and the interaction table. */
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('SearchField', () => {
  it('waits for a pause before searching, Enter searches at once, Escape and the clear button empty it', async () => {
    vi.useFakeTimers();
    const onSearch = vi.fn();
    function Host() {
      const [q, setQ] = useState('');
      return <SearchField value={q} onSearch={(v) => { onSearch(v); setQ(v); }} delay={300} label="Search employees" />;
    }
    render(<Host />);
    const box = screen.getByRole('searchbox', { name: 'Search employees' });
    fireEvent.change(box, { target: { value: 'rav' } });
    fireEvent.change(box, { target: { value: 'ravi' } });
    expect(onSearch).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(onSearch).toHaveBeenLastCalledWith('ravi');
    fireEvent.change(box, { target: { value: 'ravi d' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSearch).toHaveBeenLastCalledWith('ravi d');
    act(() => { vi.advanceTimersByTime(300); });
    expect(onSearch).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(onSearch).toHaveBeenLastCalledWith('');
    expect(box.value).toBe('');
  });

  it('does not search on Enter while an IME is composing', () => {
    const onSearch = vi.fn();
    render(<SearchField value="" onSearch={onSearch} />);
    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'राम' } });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(onSearch).not.toHaveBeenCalled();
  });
});

describe('RecordTabs', () => {
  const tabs = [{ key: 'overview', label: 'Overview' }, { key: 'personal', label: 'Personal' }, { key: 'activity', label: 'Activity' }];
  it('is a tablist: arrows, Home and End move and select; one tabpanel names the tab', async () => {
    const user = userEvent.setup();
    function Host() {
      const [tab, setTab] = useState('overview');
      return <RecordTabs tabs={tabs} value={tab} onChange={setTab}><p>{tab} body</p></RecordTabs>;
    }
    render(<Host />);
    const first = screen.getByRole('tab', { name: 'Overview' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    first.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Personal' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Personal' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('activity body');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').filter((t) => t.tabIndex === 0)).toHaveLength(1);
  });
  it('an unknown tab in the address falls back to the first one the viewer may see', () => {
    render(<RecordTabs tabs={tabs} value="statutory" onChange={() => {}}><p>x</p></RecordTabs>);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Alert and ErrorState', () => {
  it('an error alert is announced, others are polite; dismiss works', async () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Alert tone="neg" title="5 employees are missing documents" onDismiss={onDismiss} />);
    expect(screen.getByRole('alert')).toHaveTextContent('5 employees are missing documents');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
    rerender(<Alert tone="warn" title="Pending onboarding" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('tells a lost connection from a server answer, and each status its own way', () => {
    expect(errorKind({ network: true })).toBe('offline');
    expect(errorKind({ status: 401 })).toBe('signedOut');
    expect(errorKind({ status: 403 })).toBe('forbidden');
    expect(errorKind({ status: 404 })).toBe('notFound');
    expect(errorKind({ status: 409 })).toBe('conflict');
    expect(errorKind({ status: 429 })).toBe('tooMany');
    expect(errorKind({ status: 503 })).toBe('unavailable');
    expect(errorKind({ status: 400 })).toBe('failed');
  });

  it('shows a reference on a server failure, Reload on a conflict, and no retry where retrying cannot help', () => {
    const retry = vi.fn();
    const { rerender } = render(<ErrorState error={{ status: 500, requestId: 'req-42' }} onRetry={retry} />);
    expect(screen.getByText('req-42')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalled();
    rerender(<ErrorState error={{ status: 409 }} onRetry={retry} />);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    rerender(<ErrorState error={{ status: 403 }} onRetry={retry} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('You don’t have access to this');
  });
});

describe('ActivityTimeline', () => {
  const events = [
    { id: '1', type: 'update', at: '2026-10-26T05:00:00Z', actor: 'Asha Menon', role: 'HR admin', title: 'Employment updated', changes: [{ field: 'designation', label: 'Designation', before: 'Analyst', after: 'Senior analyst' }] },
    { id: '2', type: 'update', at: '2026-10-26T04:00:00Z', actor: 'Asha Menon', title: 'Personal details updated', changes: [{ field: 'passportNumber', label: 'Passport', redacted: true }] },
    { id: '3', type: 'comment', at: '2026-10-25T04:00:00Z', actor: 'Ravi Das', body: 'Spoke to the manager.' },
    { id: '4', type: 'approve', at: '2026-10-24T04:00:00Z', actor: 'Head', title: 'Promotion approved' },
    { id: '5', type: 'create', at: '2026-10-01T04:00:00Z', actor: null, title: 'Employee created', batch: { id: 'b', size: 40 } },
  ];
  it('shows before and after, says only "changed" for a redacted field, and names the system actor', () => {
    render(<ActivityTimeline events={events} />);
    expect(screen.getByText('Senior analyst')).toBeInTheDocument();
    const redacted = screen.getByText('Passport').closest('li');
    expect(redacted).toHaveTextContent('Passport changed');
    expect(screen.getByText(/by Clor · part of a batch of 40/)).toBeInTheDocument();
  });
  it('filters comments, approvals and changes as separate kinds', async () => {
    const user = userEvent.setup();
    render(<ActivityTimeline events={events} />);
    await user.click(screen.getByRole('radio', { name: 'Comments' }));
    expect(screen.getByText('Spoke to the manager.')).toBeInTheDocument();
    expect(screen.queryByText('Senior analyst')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Approvals' }));
    expect(screen.getByText('Promotion approved')).toBeInTheDocument();
    expect(screen.queryByText('Spoke to the manager.')).toBeNull();
  });
});

describe('DatePicker', () => {
  it('reads Indian day-first dates and ISO, and refuses impossible ones', () => {
    expect(parseDate('12/02/2026')).toBe('2026-02-12');
    expect(parseDate('12-02-2026')).toBe('2026-02-12');
    expect(parseDate('2026-02-12')).toBe('2026-02-12');
    expect(parseDate('12 Feb 2026')).toBe('2026-02-12');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('')).toBe('');
    expect(formatDate('2026-02-12')).toBe('12 Feb 2026');
  });

  it('typed entry is checked against min, and Enter never submits the form around it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e) => e.preventDefault());
    const onChange = vi.fn();
    render(<form onSubmit={onSubmit}><label htmlFor="doj">Date of joining</label><DatePicker id="doj" value="" onChange={onChange} min="2026-01-01" /><button type="submit">Save</button></form>);
    const box = screen.getByLabelText('Date of joining');
    await user.type(box, '12/02/2025');
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('On or after 1 Jan 2026.')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await user.clear(box);
    await user.type(box, '12/02/2026');
    await user.tab();
    expect(onChange).toHaveBeenCalledWith('2026-02-12');
  });

  it('the calendar moves by arrows, picks with Enter, and Escape closes it back to the field', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<><label htmlFor="d">Day</label><DatePicker id="d" value="2026-02-12" onChange={onChange} /></>);
    await user.click(screen.getByRole('button', { name: 'Choose a date' }));
    expect(screen.getByRole('grid', { name: 'February 2026' })).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: '12 Feb 2026' })).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(screen.getByRole('gridcell', { name: '20 Feb 2026' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('2026-02-20');
    expect(screen.queryByRole('grid')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Choose a date' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.getByLabelText('Day')).toHaveFocus();
  });
});

describe('PageHeader breadcrumb', () => {
  it('links back up the trail and marks the current page', async () => {
    const back = vi.fn();
    render(<PageHeader title="Add employee" breadcrumb={[{ label: 'Employees', onClick: back }, { label: 'Add employee' }]} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Employees' }));
    expect(back).toHaveBeenCalled();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Add employee');
    expect(screen.getAllByText('Add employee').some((n) => n.getAttribute('aria-current') === 'page')).toBe(true);
  });
});

describe('Drawer and Modal (spec v1 §5.1)', () => {
  it('a drawer gives focus back to what opened it, and Escape in its date picker closes only the picker', async () => {
    const { default: Drawer } = await import('../packages/ui/src/components/ui/Drawer');
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      const [d, setD] = useState('2026-02-12');
      return (<>
        <button type="button" onClick={() => setOpen(true)}>Open filters</button>
        <Drawer open={open} onClose={() => setOpen(false)} title="Filters">
          <label htmlFor="from">From</label><DatePicker id="from" value={d} onChange={setD} />
        </Drawer>
      </>);
    }
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Open filters' });
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Choose a date' }));
    expect(screen.getByRole('grid')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('with unsaved edits the scrim does not close a drawer, and Escape asks before discarding', async () => {
    const { default: Drawer } = await import('../packages/ui/src/components/ui/Drawer');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const onClose = vi.fn();
    render(<Drawer open onClose={onClose} title="Edit" dirty><input aria-label="Phone" /></Drawer>);
    const scrim = screen.getByRole('dialog', { name: 'Edit' }).parentElement;
    fireEvent.mouseDown(scrim);
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(onClose).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(onClose).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('a modal with unsaved edits ignores a backdrop click; without edits it closes', async () => {
    const { default: Modal } = await import('../packages/ui/src/components/ui/Modal');
    const onClose = vi.fn();
    const { rerender } = render(<Modal title="Change manager" onClose={onClose} dirty footer={<button type="button">Save</button>}><p>x</p></Modal>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement);
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(onClose).not.toHaveBeenCalled();
    rerender(<Modal title="Change manager" onClose={onClose}><p>x</p></Modal>);
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement);
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('DataTable (spec v1 §4.2, §5)', () => {
  const columns = [
    { key: 'name', label: 'Name', sortable: true, always: true },
    { key: 'code', label: 'Employee ID', sortable: true },
    { key: 'department', label: 'Department' },
  ];
  const rows = [{ id: 'a', name: 'Aarav Mehta', code: 'E1', department: 'Product' }, { id: 'b', name: 'Isha Kapoor', code: 'E2', department: 'Design' }];
  it('asks the server to sort, pages 25/50/100, and says what it shows', async () => {
    const { default: DataTable } = await import('../packages/ui/src/components/ui/DataTable');
    const user = userEvent.setup();
    const onSort = vi.fn(); const onPage = vi.fn(); const onPageSize = vi.fn();
    const { rerender } = render(<DataTable columns={columns} rows={rows} sort={null} onSort={onSort} total={248} page={1} pageSize={25} onPage={onPage} onPageSize={onPageSize} />);
    await user.click(screen.getByRole('button', { name: 'Employee ID' }));
    expect(onSort).toHaveBeenLastCalledWith({ key: 'code', dir: 'asc' });
    rerender(<DataTable columns={columns} rows={rows} sort={{ key: 'code', dir: 'asc' }} onSort={onSort} total={248} page={1} pageSize={25} onPage={onPage} onPageSize={onPageSize} />);
    expect(screen.getByRole('columnheader', { name: /Employee ID/ })).toHaveAttribute('aria-sort', 'ascending');
    await user.click(screen.getByRole('button', { name: /Employee ID/ }));
    expect(onSort).toHaveBeenLastCalledWith({ key: 'code', dir: 'desc' });
    expect(screen.getByText('Showing 1–25 of 248 results')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(onPage).toHaveBeenLastCalledWith(3);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '50');
    expect(onPageSize).toHaveBeenLastCalledWith(50);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });

  it('a row click opens the record; the checkbox and the ellipsis menu never do; the menu works by keyboard', async () => {
    const { default: DataTable } = await import('../packages/ui/src/components/ui/DataTable');
    const user = userEvent.setup();
    const onRowClick = vi.fn(); const onSelect = vi.fn(); const edit = vi.fn();
    render(<DataTable columns={columns} rows={rows} selectable selected={new Set()} onSelect={onSelect} onRowClick={onRowClick}
      rowActions={(r) => [{ key: 'view', label: 'View', onSelect: () => onRowClick(r) }, { key: 'edit', label: 'Edit', onSelect: () => edit(r.id) }]} />);
    await user.click(screen.getByRole('button', { name: 'Aarav Mehta' }));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('checkbox', { name: 'Choose Isha Kapoor' }));
    expect(onSelect.mock.calls[0][0].has('b')).toBe(true);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Actions for Isha Kapoor' }));
    expect(screen.getByRole('menuitem', { name: 'View' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(edit).toHaveBeenCalledWith('b');
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('the header box chooses the page; columns can be hidden, but not the one marked always', async () => {
    const { default: DataTable, visibleColumns } = await import('../packages/ui/src/components/ui/DataTable');
    const user = userEvent.setup();
    const onSelect = vi.fn(); const onPrefs = vi.fn();
    render(<DataTable columns={columns} rows={rows} selectable selected={new Set(['a'])} onSelect={onSelect} prefs={{}} onPrefs={onPrefs} />);
    const head = screen.getByRole('checkbox', { name: 'Choose every row on this page' });
    expect(head.indeterminate).toBe(true);
    await user.click(head);
    expect([...onSelect.mock.calls[0][0]].sort()).toEqual(['a', 'b']);
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    expect(screen.getByRole('checkbox', { name: 'Name' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Department' }));
    expect(onPrefs).toHaveBeenLastCalledWith({ hidden: ['department'] });
    expect(visibleColumns(columns, { hidden: ['department', 'name'], order: ['code', 'name'] }).map((c) => c.key)).toEqual(['code', 'name']);
  });
});

describe('useRequest (spec v1 §8 states)', () => {
  it('first load, background refresh that keeps data, slow flag, failure that keeps the last good data, newest wins', async () => {
    const { default: useRequest } = await import('../packages/ui/src/components/ui/useRequest');
    const { renderHook, waitFor } = await import('@testing-library/react');
    let answer;
    let calls = 0;
    const load = vi.fn(() => { calls += 1; return answer(calls); });
    answer = () => Promise.resolve(['one']);
    const { result, rerender } = renderHook(({ q }) => useRequest(load, [q], { slowAfter: 50 }), { initialProps: { q: 'a' } });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual(['one']));

    answer = () => new Promise((r) => setTimeout(() => r(['two']), 120));
    rerender({ q: 'b' });
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    expect(result.current.data).toEqual(['one']);
    await waitFor(() => expect(result.current.slow).toBe(true));
    await waitFor(() => expect(result.current.data).toEqual(['two']));
    expect(result.current.slow).toBe(false);

    answer = () => Promise.reject(Object.assign(new Error('x'), { network: true }));
    rerender({ q: 'c' });
    await waitFor(() => expect(result.current.error?.network).toBe(true));
    expect(result.current.data).toEqual(['two']);

    /* A late answer to an older request never replaces a newer one. */
    answer = (n) => new Promise((r) => setTimeout(() => r([`late-${n}`]), n === calls ? 10 : 80));
    rerender({ q: 'd' });
    rerender({ q: 'e' });
    await new Promise((r) => setTimeout(r, 150));
    expect(result.current.data).toEqual([`late-${calls}`]);
  });
});
