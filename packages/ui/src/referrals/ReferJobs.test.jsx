import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import ReferJobs from './ReferJobs';

/*
 * Jobs and referrals for someone who works here (employee app Me → Jobs, People → Refer
 * someone): the jobs open to them with the bonus, the refer form (a contact is needed; the
 * server's polite refusal of a duplicate is shown as it is said), the share link with WhatsApp,
 * and my referrals in plain words with my bonus; nothing when the company has jobs off.
 */
const job = { id: 'o1', title: 'Sales executive', places: 2, department: 'Sales', where: 'Pune', description: 'Field sales in Pune.', canRefer: true, canApply: true, applied: false, bonus: 5000, bonusAfter: 'once they finish probation', postedAt: '2026-10-29T10:00:00Z' };
const data = (over = {}) => ({
  on: true,
  jobs: [job],
  referrals: [
    { id: 'r1', name: 'Priya Shah', job: 'Sales executive', status: 'Interviewing', referredAt: '2026-10-20T10:00:00Z', via: 'FORM', bonus: { amount: 5000, status: 'NONE', words: 'If they join and stay', dueOn: null, note: null } },
    { id: 'r2', name: 'Anil Rao', job: 'Sales executive', status: 'Not taken forward', referredAt: '2026-10-21T10:00:00Z', via: 'LINK', bonus: null },
  ],
  applications: [],
  ...over,
});
const apiWith = (over = {}) => ({ load: vi.fn().mockResolvedValue(data()), refer: vi.fn().mockResolvedValue({ referral: { id: 'r9' } }), link: vi.fn().mockResolvedValue({ link: 'https://app.example/api/people/refer/abc', shareText: 'We are hiring: Sales executive. Apply here: https://app.example/api/people/refer/abc' }), apply: vi.fn().mockResolvedValue({}), ...over });

it('lists the jobs open to me with the bonus, and my referrals in plain words', async () => {
  render(<ReferJobs api={apiWith()} />);
  expect(await screen.findByText('Sales executive', { selector: 'span' })).toBeTruthy();
  expect(screen.getByText('Sales · Pune · 2 places')).toBeTruthy();
  expect(screen.getAllByText('₹5,000').length).toBeGreaterThan(0);
  expect(screen.getByText('Priya Shah')).toBeTruthy();
  expect(screen.getByText('Interviewing')).toBeTruthy();
  expect(screen.getByText('Not taken forward')).toBeTruthy();
  expect(screen.getByText('If they join and stay')).toBeTruthy();
});

it('asks for a phone or e-mail, sends the referral with the résumé left out, and thanks me', async () => {
  const api = apiWith();
  render(<ReferJobs api={api} />);
  fireEvent.click(await screen.findByRole('button', { name: /Sales executive/ }));
  expect(screen.getByText(/Referral bonus/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Refer someone' }));
  fireEvent.change(screen.getByLabelText('Their name *'), { target: { value: 'Kiran' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send referral' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/phone number or e-mail/);
  expect(api.refer).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '98555 55555' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send referral' }));
  await waitFor(() => expect(api.refer).toHaveBeenCalledWith(expect.objectContaining({ openingId: 'o1', name: 'Kiran', phone: '98555 55555', email: null, resume: null })));
  expect((await screen.findByRole('status')).textContent).toMatch(/Kiran is with HR for Sales executive/);
  expect(api.load).toHaveBeenCalledTimes(2);
});

it('shows the server’s polite refusal of someone already referred', async () => {
  const api = apiWith({ refer: vi.fn().mockRejectedValue(Object.assign(new Error('Someone already referred this person in the last six months, so the first referral stands.'), { status: 409 })) });
  render(<ReferJobs api={api} />);
  fireEvent.click(await screen.findByRole('button', { name: /Sales executive/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Refer someone' }));
  fireEvent.change(screen.getByLabelText('Their name *'), { target: { value: 'Priya' } });
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'priya@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send referral' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/first referral stands/);
});

it('makes my link and offers WhatsApp and Copy', async () => {
  const api = apiWith();
  render(<ReferJobs api={api} />);
  fireEvent.click(await screen.findByRole('button', { name: /Sales executive/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Share my link' }));
  const wa = await screen.findByRole('link', { name: 'Send on WhatsApp' });
  expect(wa.getAttribute('href')).toBe(`https://wa.me/?text=${encodeURIComponent('We are hiring: Sales executive. Apply here: https://app.example/api/people/refer/abc')}`);
  expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  expect(api.link).toHaveBeenCalledWith('o1');
});

it('applies myself where HR allows it', async () => {
  const api = apiWith();
  render(<ReferJobs api={api} />);
  fireEvent.click(await screen.findByRole('button', { name: /Sales executive/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply myself' }));
  fireEvent.change(screen.getByLabelText('Why you want this job'), { target: { value: 'I know the area' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(api.apply).toHaveBeenCalledWith({ openingId: 'o1', note: 'I know the area' }));
});

it('shows nothing when jobs are off, nothing when empty in the app, and a plain line for a sign-in with no record', async () => {
  const { container, unmount } = render(<ReferJobs api={apiWith({ load: vi.fn().mockResolvedValue({ on: false, jobs: [], referrals: [], applications: [] }) })} />);
  await waitFor(() => expect(container.textContent).toBe(''));
  unmount();
  const empty = render(<ReferJobs hideWhenEmpty api={apiWith({ load: vi.fn().mockResolvedValue(data({ jobs: [], referrals: [] })) })} />);
  await waitFor(() => expect(empty.container.textContent).toBe(''));
  empty.unmount();
  render(<ReferJobs api={apiWith({ load: vi.fn().mockResolvedValue({ employee: false, jobs: [], referrals: [], applications: [] }) })} />);
  expect(await screen.findByText(/not linked to an employee record/)).toBeTruthy();
});
