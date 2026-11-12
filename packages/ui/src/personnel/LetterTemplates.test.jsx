import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import LetterTemplates from './LetterTemplates';

/*
 * The Letters screen says which letters CLOR issues by itself, and when, and
 * who signs them (People plan 8 Nov 2026, step 6).
 */
const api = vi.hoisted(() => ({
  getLetterTemplates: vi.fn(),
  getLetterTemplateVersions: vi.fn(async () => []),
  saveLetterTemplate: vi.fn(),
  saveLetterSettings: vi.fn(),
}));
vi.mock('./api', () => api);
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());

const template = (kind, over = {}) => ({ id: null, kind, name: kind, body: 'Dear {{name}}', version: 0, active: true, builtIn: true, fields: ['name'], extra: ['signatory'], ...over });
const DATA = {
  templates: [template('APPOINTMENT', { id: 't1', version: 2, builtIn: false }), template('EMPLOYMENT')],
  kinds: [{ kind: 'APPOINTMENT', label: 'Appointment letter', issuedWhen: 'someone joins' }, { kind: 'EMPLOYMENT', label: 'Employment certificate', issuedWhen: null }],
  mergeFields: ['name'],
  signatory: '',
};

it('says the company’s appointment letter goes out by itself when someone joins, and saves who signs', async () => {
  api.getLetterTemplates.mockResolvedValue(DATA);
  api.saveLetterSettings.mockResolvedValue({ signatory: 'Meera Shah, HR Manager' });
  render(<LetterTemplates />);
  expect(await screen.findByText('Version 2 is in use. CLOR issues it by itself when someone joins.')).toBeTruthy();
  expect(screen.getByText(/Until then, CLOR leaves letters that need a signature for HR to issue by hand/)).toBeTruthy();
  const save = screen.getByRole('button', { name: 'Save' });
  expect(save.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Signed by'), { target: { value: 'Meera Shah, HR Manager' } });
  fireEvent.click(save);
  await vi.waitFor(() => expect(api.saveLetterSettings).toHaveBeenCalledWith({ signatory: 'Meera Shah, HR Manager' }));
});
