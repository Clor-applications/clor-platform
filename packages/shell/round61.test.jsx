import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ScreenHelp, { guideForScreen } from './ScreenHelp';
import { GUIDES } from './helpGuides';
import Toaster from '@ui/components/ui/Toaster';
import { confirmDialog } from '@ui/components/ui/notify';

afterEach(cleanup);

describe('round 61: "How this works" for the screen (pagehelp A)', () => {
  it('finds the how-to written for a screen, by its main or other screen', () => {
    const inv = GUIDES.find((g) => g.open?.screen === 'invitations');
    expect(guideForScreen('admin', 'invitations')).toBe(inv);
    const alt = GUIDES.find((g) => g.alt);
    expect(guideForScreen(alt.alt.app, alt.alt.screen)).toBeTruthy();
    expect(guideForScreen('people', 'no-such-screen')).toBeNull();
  });

  it('opens the article in a side panel, with a way to the Help centre', () => {
    const toCentre = vi.fn();
    render(<ScreenHelp appId="admin" screen="invitations" onOpenHelpCentre={toCentre} />);
    fireEvent.click(screen.getByRole('button', { name: 'How this works ›' }));
    expect(screen.getByText('Send an invitation')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open in Help centre' }));
    expect(toCentre).toHaveBeenCalledWith('invite');
  });

  it('draws nothing where there is no how-to', () => {
    const { container } = render(<ScreenHelp appId="people" screen="no-such-screen" />);
    expect(container.textContent).toBe('');
  });
});

describe('round 61: leaving with unsaved changes (unsavedleave A)', () => {
  it('Stay is the main button and has the focus; Leave is the quiet one', async () => {
    render(<Toaster />);
    let answer;
    const p = confirmDialog({ title: 'Leave without saving?', message: 'You have unsaved changes on this page.', confirmLabel: 'Leave', cancelLabel: 'Stay', stayFirst: true });
    p.then((v) => { answer = v; });
    const stay = await screen.findByRole('button', { name: 'Stay' });
    expect(stay.className).toContain('ui-btn-primary');
    expect(screen.getByRole('button', { name: 'Leave' }).className).toContain('ui-btn-secondary');
    fireEvent.click(stay);
    await p;
    expect(answer).toBe(false);
  });
});
