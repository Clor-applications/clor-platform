import { useEffect, useState } from 'react';

import Modal from './Modal';

/**
 * What the keyboard does, written down.
 *
 * The application has had Excel's keys for a while — a row on Ctrl+=, the
 * arrows walking a column, Ctrl+; for today's date — and nobody could have
 * known: they were in the source and in nothing a person could open. A
 * shortcut that cannot be discovered is a shortcut that does not exist.
 *
 * The keys are the same on both platforms, and only the symbols differ: what
 * this shows as ⌘ on a Mac it shows as Ctrl on Windows, because that is what is
 * printed on the key somebody is looking for.
 */

const isMac = () =>
  typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '');

export const GROUPS = [
  {
    name: 'Vouchers',
    keys: [
      { combo: ['F8'], does: 'Sales invoice' },
      { combo: ['F9'], does: 'Purchase bill' },
      { combo: ['F6'], does: 'Receipt' },
      { combo: ['F7'], does: 'Journal' },
      { combo: ['F4'], does: 'Contra — cash and bank' },
      { combo: ['Alt', 'P'], does: 'Payment — F5 belongs to the browser' },
    ],
  },
  {
    name: 'Anywhere',
    keys: [
      { combo: ['mod', 'K'], does: 'Search invoices, customers and items' },
      { combo: ['mod', '/'], does: 'The same search, from the keyboard' },
      { combo: ['Alt', 'I'], does: 'New invoice' },
      { combo: ['Alt', 'C'], does: 'New credit note' },
      { combo: ['Alt', 'D'], does: 'Home' },
      { combo: ['?'], does: 'This list' },
    ],
  },
  {
    name: 'In a document',
    keys: [
      { combo: ['mod', 'S'], does: 'Save' },
      { combo: ['mod', 'Enter'], does: 'Save and post' },
      { combo: ['mod', 'A'], does: 'Accept — Tally\u2019s, outside a text field' },
      { combo: ['mod', ';'], does: "Today's date, into the date field you are in" },
      { combo: ['Esc'], does: 'Leave without saving' },
    ],
  },
  {
    name: 'In a list',
    keys: [
      { combo: ['Tab'], does: 'Into the rows — one stop for the whole table' },
      { combo: ['↑', '↓'], does: 'The row above or below' },
      { combo: ['Home', 'End'], does: 'The first or last row' },
      { combo: ['Enter'], does: 'Open the row you are on' },
    ],
  },
  {
    name: 'In the lines',
    keys: [
      { combo: ['mod', '='], does: 'Add a line' },
      { combo: ['mod', 'D'], does: 'Copy the line you are on' },
      { combo: ['mod', 'Delete'], does: 'Remove the line you are on' },
      { combo: ['Alt', 'D'], does: 'The same, as Tally spells it' },
      { combo: ['Tab'], does: 'Next field — from the last one, a new line' },
      { combo: ['↑', '↓'], does: 'The same column, a row up or down' },
      { combo: ['←', '→'], does: 'The next field, once the caret is at the end' },
    ],
  },
];

/** ⌘ on a Mac, Ctrl on Windows — whatever is printed on the key. */
export const label = (key, mac = isMac()) => {
  if (key === 'mod') return mac ? '⌘' : 'Ctrl';
  if (key === 'Alt') return mac ? '⌥' : 'Alt';
  if (key === 'Delete') return mac ? '⌫' : 'Del';
  if (key === 'Enter') return mac ? '↩' : 'Enter';
  return key;
};

const Key = ({ children }) => (
  <kbd
    /* 6px is the keycap exception in DESIGN.md: on a 24px cap 8px reads as a lozenge, not a key. */
    className="ui-mono inline-grid h-6 min-w-6 place-items-center rounded-md border px-1.5 text-xs"
    style={{ borderColor: 'rgb(var(--border-strong))', backgroundColor: 'rgb(var(--surface-sunken))' }}
  >
    {children}
  </kbd>
);

export default function ShortcutSheet({ open, onClose }) {
  const mac = isMac();
  if (!open) return null;

  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} maxWidthClass="max-w-2xl">
      <div className="grid gap-6 sm:grid-cols-2">
        {GROUPS.map((group) => (
          <section key={group.name}>
            <h3 className="ui-t-label">{group.name}</h3>
            <dl className="mt-2 space-y-2">
              {group.keys.map((k) => (
                <div key={k.does} className="flex items-start justify-between gap-3">
                  <dt className="ui-muted min-w-0 text-sm">{k.does}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {k.combo.map((part) => (
                      <Key key={part}>{label(part, mac)}</Key>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}

/** Opens the sheet on `?`, which is free everywhere a field is not focused. */
export function useShortcutSheet() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      /* Not while somebody is typing one — a question mark belongs in the
         narration field it was typed into. */
      const typing =
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { open, setOpen };
}
