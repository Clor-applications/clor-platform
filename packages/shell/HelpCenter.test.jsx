import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import HelpCenter from './HelpCenter';

afterEach(cleanup);

describe('Help centre', () => {
  it('finds a how-to by a word people search with, and opens it', () => {
    render(<HelpCenter initialTopic="welcome" onOpen={vi.fn()} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search help' }), { target: { value: 'missed punch' } });
    const nav = screen.getByRole('navigation', { name: 'Help topics' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Fix a missed punch' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Fix a missed punch' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'The employee asks' })).toBeInTheDocument();
  });

  it('opens the screen an article names, in its app', () => {
    const onOpen = vi.fn();
    render(<HelpCenter initialTopic="connect-reader" onOpen={onOpen} apps={['admin', 'attendance', 'people']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open All readers' }));
    expect(onOpen).toHaveBeenCalledWith('attendance', 'readers');
    fireEvent.click(screen.getByRole('button', { name: 'Open Readers in People' }));
    expect(onOpen).toHaveBeenLastCalledWith('people', 'readers');
  });

  it('leaves out a link to an app the company does not have', () => {
    render(<HelpCenter initialTopic="holidays" onOpen={vi.fn()} apps={['admin', 'people']} />);
    expect(screen.queryByRole('button', { name: 'Open Holidays' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Holidays in People' })).toBeInTheDocument();
  });

  it('says so when nothing matches', () => {
    render(<HelpCenter onOpen={vi.fn()} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search help' }), { target: { value: 'zzzz' } });
    expect(screen.getByText('Nothing matches “zzzz”.')).toBeInTheDocument();
  });
});
