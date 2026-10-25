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
