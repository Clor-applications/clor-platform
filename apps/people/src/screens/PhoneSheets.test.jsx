import React from 'react';
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Drawer from '@ui/components/ui/Drawer';

/*
 * Design audit, 4 Nov 2026, blocker 7: on a phone a People drawer is a bottom sheet with its actions in a sticky
 * footer, in thumb reach: the primary and one secondary half and half, anything else behind a ⋮. At desktop width
 * nothing moves.
 */
const setWidth = (phone) => {
  window.matchMedia = vi.fn((q) => ({ matches: phone && /max-width: 639px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
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

  /* Review of #128: the menu is portalled out of the sheet, so Escape there closed the whole sheet. */
  it('Escape in the ⋮ menu closes the menu, not the sheet', async () => {
    setWidth(true);
    const onClose = vi.fn();
    render(<Drawer open title="Leave" onClose={onClose} more={[{ key: 'w', label: 'Withdraw', onSelect: () => {} }]} actions={<button type="button" className="ui-btn ui-btn-primary">Approve</button>}><p>Body</p></Drawer>);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const item = screen.getByRole('menuitem', { name: 'Withdraw' });
    fireEvent.keyDown(item, { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 250));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('menuitem', { name: 'Withdraw' })).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('is a phone sheet below 640px only, where the sheet shape, the grabber and DataTable cards start', () => {
    /* At 700px the query for 639px does not match: a side panel with its actions in the head. */
    setWidth(false);
    render(sheet());
    expect(screen.getByRole('dialog').className).not.toMatch(/ui-drawer-sheet/);
    expect(readFileSync('packages/ui/src/components/ui/Drawer.jsx', 'utf8')).toMatch(/const PHONE = '\(max-width: 639px\)';/);
  });

  it('drawers that use footer= keep Save above the home indicator', () => {
    expect(readFileSync('packages/ui/src/index.css', 'utf8')).toMatch(/\.ui-drawer-footer \{[^}]*padding: 0\.75rem 1\.25rem calc\(0\.75rem \+ env\(safe-area-inset-bottom\)\);/);
  });

  it('does not pull the data table into every drawer', () => {
    expect(readFileSync('packages/ui/src/components/ui/Drawer.jsx', 'utf8')).not.toMatch(/from '\.\/DataTable'/);
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
