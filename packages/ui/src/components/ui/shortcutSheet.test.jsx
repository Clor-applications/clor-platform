import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ShortcutSheet, { GROUPS, label, useShortcutSheet } from './ShortcutSheet';

/**
 * A shortcut that cannot be discovered is a shortcut that does not exist.
 *
 * The keys had been there a while — a row on Ctrl+=, the arrows walking a
 * column, Ctrl+; for today — in the source and in nothing anybody could open.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const keysSource = readFileSync(join(HERE, 'useDocumentFormKeys.js'), 'utf8');

const Harness = () => {
  const sheet = useShortcutSheet();
  return (
    <>
      <input aria-label="narration" />
      <ShortcutSheet open={sheet.open} onClose={() => sheet.setOpen(false)} />
    </>
  );
};

describe('the sheet', () => {
  it('opens on ?', () => {
    render(<Harness />);
    expect(screen.queryByText('Keyboard shortcuts')).toBeNull();
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();
  });

  it('stays shut while somebody is typing one', () => {
    render(<Harness />);
    const field = screen.getByLabelText('narration');
    field.focus();
    fireEvent.keyDown(window, { key: '?' });
    /* A question mark belongs in the narration it was typed into. */
    expect(screen.queryByText('Keyboard shortcuts')).toBeNull();
  });
});

describe('the keys are named as the platform prints them', () => {
  it('says Cmd on a Mac and Ctrl on Windows', () => {
    expect(label('mod', true)).toBe('⌘');
    expect(label('mod', false)).toBe('Ctrl');
    expect(label('Alt', true)).toBe('⌥');
    expect(label('Alt', false)).toBe('Alt');
    expect(label('Delete', false)).toBe('Del');
  });

  it('leaves a plain key alone on both', () => {
    for (const mac of [true, false]) {
      expect(label('Tab', mac)).toBe('Tab');
      expect(label('↑', mac)).toBe('↑');
    }
  });
});

describe('what it lists is what the application does', () => {
  /*
   * Stated against the handler rather than against a screenshot: a sheet that
   * promises a key nothing implements is worse than no sheet.
   */
  it('names only combinations the document keys handle', () => {
    const source = keysSource;
    const inLines = GROUPS.find((g) => g.name === 'In the lines').keys.map((k) => k.combo.join('+'));
    expect(inLines).toContain('mod+=');
    expect(source).toMatch(/key === '=' \|\| key === '\+'/);
    expect(source).toMatch(/key === 'd'/);
    expect(source).toMatch(/e\.key === 'Delete' \|\| e\.key === 'Backspace'/);
  });

  it('names the date key the document form really implements', () => {
    const source = keysSource;
    const doc = GROUPS.find((g) => g.name === 'In a document').keys.map((k) => k.combo.join('+'));
    expect(doc).toContain('mod+;');
    expect(source).toMatch(/e\.key === ';'/);
  });
});
