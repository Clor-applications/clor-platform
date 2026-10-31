import React, { useEffect, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { PermissionContext } from './context';
import { WriteGuard } from './WriteGuard';

const perms = (loading, list = []) => ({ loading, error: '', isAdmin: false, permissions: new Set(list), roles: [] });

/** A screen that counts its mounts and holds what was typed, like a half-filled form. */
let mounts = 0;
let saves = 0;
function Screen() {
  const [text, setText] = useState('');
  useEffect(() => { mounts += 1; }, []);
  return (
    <>
      <input aria-label="Reason" value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" className="ui-btn ui-btn-primary" onClick={() => { saves += 1; }}>Save</button>
    </>
  );
}

const at = (value) => (
  <PermissionContext.Provider value={value}>
    <WriteGuard permission="ATTENDANCE::My Attendance::VIEW">
      <Screen />
    </WriteGuard>
  </PermissionContext.Provider>
);

/*
 * The permissions answer arriving after the screen opened used to swap the
 * bare screen for a wrapped one, so React built the screen again: every
 * screen mounted twice, and a slow answer wiped what the person had typed.
 */
it('keeps the screen, and what was typed, when the permissions arrive', () => {
  mounts = 0;
  const { rerender } = render(at(perms(true)));
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'School admission' } });

  rerender(at(perms(false, ['ATTENDANCE::My Attendance::CREATE'])));
  expect(mounts).toBe(1);
  expect(screen.getByLabelText('Reason')).toHaveValue('School admission');
});

it('keeps the screen when it turns out to be read-only, and says so', () => {
  mounts = 0;
  const { rerender } = render(at(perms(true)));
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Typed' } });

  rerender(at(perms(false, ['ATTENDANCE::My Attendance::VIEW'])));
  expect(mounts).toBe(1);
  expect(screen.getByLabelText('Reason')).toHaveValue('Typed');
  expect(screen.getByRole('status')).toHaveTextContent(/View only/);

  /* The kept screen is guarded too: its primary button is stopped before its own handler runs. */
  saves = 0;
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(saves).toBe(0);
});

it('lets the primary button through while permissions load and when the person may write', () => {
  saves = 0;
  const { rerender } = render(at(perms(true)));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  rerender(at(perms(false, ['ATTENDANCE::My Attendance::CREATE'])));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(saves).toBe(2);
});
