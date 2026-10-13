import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SettingsView } from '../../App';

/**
 * Settings → Organisation → Company Profile, read then edit.
 *
 * Branches and Warehouses — the two entries directly below it — each show the
 * record and open a form only when asked. Company Profile opened straight into
 * a form with every field live and a Save button, so there was no screen that
 * simply said what the company *is*, and the fields were one stray keystroke
 * away from being changed by someone who only meant to look.
 */

const company = {
  id: 'c1',
  name: 'Sunrise Traders',
  gstin: '29AABCU9603R1ZJ',
  profile: {
    companySettings: {
      legalName: 'Sunrise Traders Pvt Ltd',
      entityType: 'Pvt Ltd',
      officialEmail: 'hello@sunrise.example',
      regAddress1: '12 MG Road',
      regCity: 'Bengaluru',
      regStateCode: 'Karnataka',
      regPincode: '560001',
    },
  },
};

const renderScreen = () =>
  render(
    <SettingsView db={{ companies: [company] }} setDb={() => {}} currentCompany={company} initialTab="company" showSidebar={false} />
  );

describe('Company Profile', () => {
  it('opens on the record, not on a form', () => {
    renderScreen();

    // The values are stated…
    expect(screen.getByText('Sunrise Traders Pvt Ltd')).toBeInTheDocument();
    expect(screen.getByText('29AABCU9603R1ZJ')).toBeInTheDocument();

    // …and nothing is editable until asked.
    expect(screen.queryByLabelText(/Legal Company Name/i)).toBeNull();
    expect(document.querySelectorAll('input').length).toBe(0);
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
  });

  it('opens the form on Edit, carrying the stored values in', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: /edit/i }));

    const inputs = [...document.querySelectorAll('input')];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.some((i) => i.value === 'Sunrise Traders Pvt Ltd')).toBe(true);
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
  });

  /*
   * Cancel is the whole point of a read view: a look that changed nothing has
   * to be leaveable without a save.
   */
  it('returns to the record on Cancel, leaving nothing editable', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: /edit/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(document.querySelectorAll('input').length).toBe(0);
    expect(screen.getByText('Sunrise Traders Pvt Ltd')).toBeInTheDocument();
  });
});

describe('Company Profile actions', () => {
  const second = { id: 'c2', name: 'Moonrise Exports', profile: {} };

  it('does not repeat the active company summary inside the profile', () => {
    render(
      <SettingsView
        db={{ companies: [company, second] }}
        setDb={() => {}}
        currentCompany={company}
        initialTab="company"
        showSidebar={false}
      />
    );
    expect(screen.queryByText(/Active company · 2 in this book/)).toBeNull();
  });

  it('keeps company creation and switching out of the profile content', () => {
    render(
      <SettingsView
        db={{ companies: [company, second] }}
        setDb={() => {}}
        currentCompany={company}
        initialTab="company"
        showSidebar={false}
        onOpenCompanyList={() => {}}
        onAddCompany={() => {}}
      />
    );
    expect(screen.queryByRole('button', { name: /switch company/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add company/i })).toBeNull();
  });
});
