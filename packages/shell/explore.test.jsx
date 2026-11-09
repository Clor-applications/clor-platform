import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const exchange = vi.hoisted(() => vi.fn());
vi.mock('@platform/auth', () => ({ exploreExchange: (t) => exchange(t) }));

import { ExploreEnded, ExploreLanding, ExploreNotice } from './Explore';
import { isExplorePath } from './exploreLink';

describe('Explore in the shell', () => {
  it('says it is a sample company, with the days left and the way to a demo', () => {
    render(<ExploreNotice explore={{ daysLeft: 12 }} demoUrl="https://clor.in/demo" />);
    expect(screen.getByRole('status')).toHaveTextContent('You’re looking at a sample company. Nothing you change is saved.');
    expect(screen.getByText('12 days left')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a demo' })).toHaveAttribute('href', 'https://clor.in/demo');
  });

  it('draws nothing outside Explore', () => {
    const { container } = render(<ExploreNotice explore={null} demoUrl="https://clor.in/demo" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says an ended link has ended, in plain words, with a demo link', () => {
    render(<ExploreEnded demoUrl="https://clor.in/demo" />);
    expect(screen.getByRole('heading', { name: 'This link has ended' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a demo' })).toHaveAttribute('href', 'https://clor.in/demo');
  });

  it('takes the token out of the address, and shows the ended page when the server says so', async () => {
    window.history.replaceState(null, '', '/explore?t=old-token-0123456789&app=payroll');
    expect(isExplorePath()).toBe(true);
    exchange.mockRejectedValue(Object.assign(new Error('This link has ended.'), { status: 410, code: 'EXPLORE_ENDED' }));
    render(<ExploreLanding demoUrl="https://clor.in/demo" />);
    expect(window.location.search).toBe('');
    expect(await screen.findByRole('heading', { name: 'This link has ended' })).toBeInTheDocument();
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange).toHaveBeenCalledWith('old-token-0123456789');
  });

  it('asks somebody already signed in before it replaces their sign-in, and stays put on no', async () => {
    vi.resetModules();
    const { ExploreLanding: Landing } = await import('./Explore');
    window.history.replaceState(null, '', '/explore?t=ask-token-0123456789&app=people');
    exchange.mockReset();
    const signOut = vi.fn();
    render(<Landing demoUrl="https://clor.in/demo" signedIn={{ company: 'Kave Foods', name: 'Asha Rao' }} signOut={signOut} />);
    expect(window.location.search).toBe('');
    expect(screen.getByText(/You’re signed in to Kave Foods as Asha Rao\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Stay in Kave Foods' })).toHaveAttribute('href', '/');
    expect(exchange).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('signs out here first, then opens the sample company, when they say yes', async () => {
    vi.resetModules();
    const { ExploreLanding: Landing } = await import('./Explore');
    window.history.replaceState(null, '', '/explore?t=yes-token-0123456789&app=people');
    exchange.mockReset();
    const order = [];
    const signOut = vi.fn(async () => { order.push('signOut'); });
    exchange.mockImplementation(async () => {
      order.push('exchange');
      throw Object.assign(new Error('This link has ended.'), { status: 410, code: 'EXPLORE_ENDED' });
    });
    render(<Landing demoUrl="https://clor.in/demo" signedIn={{ company: 'Kave Foods', name: 'Asha Rao' }} signOut={signOut} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the sample company' }));
    expect(await screen.findByRole('heading', { name: 'This link has ended' })).toBeInTheDocument();
    await waitFor(() => expect(order).toEqual(['signOut', 'exchange']));
    expect(exchange).toHaveBeenCalledWith('yes-token-0123456789');
  });

  it('waits for this browser’s own session before trading the link', async () => {
    vi.resetModules();
    const { ExploreLanding: Landing } = await import('./Explore');
    window.history.replaceState(null, '', '/explore?t=wait-token-0123456789');
    exchange.mockReset();
    render(<Landing demoUrl="https://clor.in/demo" restoring />);
    expect(screen.getByText('Opening the sample company…')).toBeInTheDocument();
    expect(exchange).not.toHaveBeenCalled();
  });
});
