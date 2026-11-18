import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SectionJump, ScrollTop, firstEmptyField, isExternalHref, markExternalLinks, openingFocus,
  pageTitle, saveTarget, setShellTitle, useCtrlSave, usePageTitle,
} from './round61';
import CopyWord from '../components/ui/CopyWord';

afterEach(() => { cleanup(); delete document.documentElement.dataset.palette; document.body.innerHTML = ''; });

describe('round 61: tab names (tabtitle A)', () => {
  it('puts the page first, then the app', () => {
    expect(pageTitle({ page: 'Employees', app: 'People' })).toBe('Employees · People · CLOR');
    expect(pageTitle({ page: 'Employees', app: 'People', own: 'Ravi Kumar' })).toBe('Ravi Kumar · People · CLOR');
    expect(pageTitle({})).toBe('CLOR');
  });

  it('a record names the tab while it is open, then the page comes back', () => {
    setShellTitle('Employees', 'People');
    expect(document.title).toBe('Employees · People · CLOR');
    const { unmount } = renderHook(() => usePageTitle('Ravi Kumar'));
    expect(document.title).toBe('Ravi Kumar · People · CLOR');
    unmount();
    expect(document.title).toBe('Employees · People · CLOR');
  });

  it('leaves Books alone', () => {
    document.title = 'Books';
    document.documentElement.dataset.palette = 'indigo';
    setShellTitle('Invoices', 'Books');
    expect(document.title).toBe('Books');
  });
});

describe('round 61: links that leave CLOR (externallink A)', () => {
  const here = { host: 'people.clor.in' };
  it('knows an outside link from a CLOR one', () => {
    expect(isExternalHref('https://www.epfindia.gov.in/', here)).toBe(true);
    expect(isExternalHref('https://payroll.clor.in/x', here)).toBe(false);
    expect(isExternalHref('#/people', here)).toBe(false);
    expect(isExternalHref('/help', here)).toBe(false);
  });

  it('marks outside links but not buttons', () => {
    document.body.innerHTML = '<main><a href="https://www.epfindia.gov.in/">EPFO portal</a><a class="ui-btn" href="https://x.example/">Go</a><a href="#/a">In</a></main>';
    markExternalLinks(document.body);
    const [a, b, c] = document.querySelectorAll('a');
    expect(a.dataset.external).toBe('');
    expect(b.dataset.external).toBeUndefined();
    expect(c.dataset.external).toBeUndefined();
  });
});

describe('round 61: Ctrl+S saves the open form (ctrlsave A)', () => {
  it('clicks the Save of the form the cursor is in', () => {
    const onSave = vi.fn((e) => e.preventDefault());
    render(<form onSubmit={onSave}><input aria-label="Name" /><button type="submit">Save</button></form>);
    renderHook(() => useCtrlSave(() => {}));
    screen.getByLabelText('Name').focus();
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('never sends or approves: a form whose button is not a save is left alone, with a word why', () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    const told = vi.fn();
    render(<form onSubmit={onSubmit}><input aria-label="Note" /><button type="submit">Send</button></form>);
    renderHook(() => useCtrlSave(told));
    screen.getByLabelText('Note').focus();
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(told).toHaveBeenCalledWith('Send');
  });

  it('finds the only Save on the page when no form has the cursor', () => {
    const click = vi.fn();
    render(<main><button type="button" onClick={click}>Save changes</button><button type="button">Cancel</button></main>);
    expect(saveTarget().button.textContent).toBe('Save changes');
  });

  it('does nothing in Books', () => {
    document.documentElement.dataset.palette = 'indigo';
    const told = vi.fn();
    renderHook(() => useCtrlSave(told));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(told).not.toHaveBeenCalled();
  });
});

describe('round 61: the cursor starts in the first empty field (focusfirst A)', () => {
  it('skips filled, read-only and picker fields', () => {
    document.body.innerHTML = '<div id="p"><input value="x" /><input readonly /><input role="combobox" /><input id="want" /><textarea></textarea></div>';
    expect(firstEmptyField(document.getElementById('p')).id).toBe('want');
  });

  it('data-autofocus still wins', () => {
    document.body.innerHTML = '<div id="p"><input id="a" /><button id="b" data-autofocus>Go</button></div>';
    expect(openingFocus(document.getElementById('p')).id).toBe('b');
  });

  it('not on a touch phone', () => {
    const mm = window.matchMedia;
    window.matchMedia = () => ({ matches: true });
    document.body.innerHTML = '<div id="p"><input id="a" /></div>';
    expect(openingFocus(document.getElementById('p'))).toBeNull();
    window.matchMedia = mm;
  });
});

describe('round 61: back to the top (scrolltop A)', () => {
  it('shows "Top" after two screens of scrolling and scrolls up', () => {
    const to = vi.fn();
    window.scrollTo = to;
    render(<ScrollTop />);
    expect(screen.queryByRole('button', { name: /Top/ })).toBeNull();
    act(() => { window.scrollY = window.innerHeight * 3; window.dispatchEvent(new Event('scroll')); });
    fireEvent.click(screen.getByRole('button', { name: /Top/ }));
    expect(to).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    act(() => { window.scrollY = 0; window.dispatchEvent(new Event('scroll')); });
  });
});

describe('round 61: sections on the right (sectionjump A)', () => {
  it('lists the page sections when there are four or more', () => {
    render(<SectionJump><h2>Default shift</h2><h2>Late arrivals</h2><h2>Readers</h2><h2>Who approves</h2></SectionJump>);
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    expect(nav.querySelectorAll('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Late arrivals' })).toBeTruthy();
  });

  it('stays out of the way on a short page', () => {
    render(<SectionJump><h2>One</h2><h2>Two</h2></SectionJump>);
    expect(screen.queryByRole('navigation', { name: 'On this page' })).toBeNull();
  });
});

describe('round 61: copy icon (copyvalue A)', () => {
  it('an icon, "Copied" after', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
    render(<p><span>EMP104</span><CopyWord value="EMP104" what="employee ID" /></p>);
    const b = screen.getByRole('button', { name: 'Copy employee ID' });
    expect(b.textContent).toBe('');
    await act(async () => { fireEvent.click(b); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('EMP104');
    expect(screen.getByText('Copied')).toBeTruthy();
  });
});
