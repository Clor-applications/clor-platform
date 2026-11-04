import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Drawer from '@ui/components/ui/Drawer';

/*
 * Design audit, 4 Nov 2026, blocker 7: on a phone a People drawer is a bottom sheet with its actions in a sticky
 * footer, in thumb reach: the primary and one secondary half and half, anything else behind a ⋮. At desktop width
 * nothing moves.
 */
const setWidth = (phone) => {
  window.matchMedia = vi.fn((q) => ({ matches: phone && /max-width: 767px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
};
const sheet = (props = {}) => (
  <Drawer open title="Priya Sharma: Casual leave" onClose={() => {}}
    more={[{ key: 'withdraw', label: 'Withdraw', onSelect: props.onWithdraw || (() => {}) }, { key: 'change', label: 'Change', onSelect: () => {} }]}
    actions={<><button type="button" className="ui-btn ui-btn-secondary">Reject</button><button type="button" className="ui-btn ui-btn-primary">Approve</button></>}>
    <p>Dates</p>
  </Drawer>
);

describe('People drawers on a phone', () => {
  const real = window.matchMedia;
  beforeEach(() => { document.documentElement.dataset.palette = 'sky'; });
  afterEach(() => { window.matchMedia = real; delete document.documentElement.dataset.palette; });

  it('puts Reject and Approve in a footer under the content, and the rest behind a ⋮', () => {
    setWidth(true);
    const onWithdraw = vi.fn();
    render(sheet({ onWithdraw }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toMatch(/ui-drawer-sheet/);
    const footer = dialog.querySelector('.ui-sheet-actions');
    expect(footer).toBeTruthy();
    /* The footer comes after the body, so it sits at the bottom of the sheet. */
    expect(screen.getByText('Dates').compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(footer).getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(within(footer).getByRole('button', { name: 'Reject' })).toBeTruthy();
    expect(dialog.querySelector('.ui-sheet-head').textContent).not.toMatch(/Approve|Reject|Withdraw/);
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
    fireEvent.click(within(footer).getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Withdraw' }));
    expect(onWithdraw).toHaveBeenCalled();
  });

  it('keeps every action in the head at desktop width', () => {
    setWidth(false);
    render(sheet());
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('.ui-sheet-actions')).toBeNull();
    const head = dialog.querySelector('.ui-sheet-head');
    for (const name of ['Withdraw', 'Change', 'Reject', 'Approve']) expect(within(head).getByRole('button', { name })).toBeTruthy();
  });

  it('leaves other apps alone: no sky palette, no sheet footer', () => {
    delete document.documentElement.dataset.palette;
    setWidth(true);
    render(sheet());
    expect(screen.getByRole('dialog').querySelector('.ui-sheet-actions')).toBeNull();
  });
});
