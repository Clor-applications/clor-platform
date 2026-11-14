import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import CodeNumberingSettings from './CodeNumberingSettings';

vi.mock('@platform/http', () => ({ apiFetch: vi.fn(async () => ({ partyCodeSettings: {}, counters: [] })) }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { error: vi.fn(), success: vi.fn() } }));

beforeEach(() => localStorage.setItem('activeOrgId', 'org-1'));

it('lets the operator type any next number within the selected digit width', async () => {
  await act(async () => { render(<CodeNumberingSettings db={{ branches: [], customers: [], vendors: [] }} setDb={vi.fn()} currentCompany={{ id: 'company-1', profile: { backendCompanyId: 'org-1' } }} />); });
  fireEvent.change(screen.getByText('Number of digits').nextSibling, { target: { value: '3' } });
  const input = screen.getByText('Next number').nextSibling;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '201' } });
  expect(input.value).toBe('201');
  fireEvent.blur(input);
  expect(input.value).toBe('201');
  expect(screen.getByText('CUST-201')).toBeTruthy();
});
