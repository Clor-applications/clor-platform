import { render, screen } from '@testing-library/react';
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
});
