import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { useTreeKeys } from './useTreeKeys';

/** The outline's keyboard: one tab stop, arrows to walk, → / ← to open, close and go up, Enter to open, letters to jump. */
const Tree = ({ onOpen }) => {
  const [closed, setClosed] = useState(new Set());
  const { ref, onKeyDown, onFocus } = useTreeKeys({
    onExpand: (id) => setClosed((s) => { const n = new Set(s); n.delete(id); return n; }),
    onCollapse: (id) => setClosed((s) => new Set(s).add(id)),
    onOpen,
  });
  const item = (id, label, kids) => (
    <li key={id} role="treeitem" tabIndex={-1} data-id={id} data-label={label} data-opens="1" aria-label={label} aria-expanded={kids ? !closed.has(id) : undefined}>
      {label}
      {kids && !closed.has(id) ? <ul role="group">{kids}</ul> : null}
    </li>
  );
  return (
    <>
      <button type="button">Before</button>
      <ul ref={ref} role="tree" aria-label="Org" onKeyDown={onKeyDown} onFocus={onFocus}>
        {item('a', 'Asha', [item('b', 'Bala'), item('c', 'Chitra')])}
        {item('d', 'Dev')}
      </ul>
    </>
  );
};

describe('useTreeKeys', () => {
  it('walks, opens, closes, jumps and opens a record', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<Tree onOpen={onOpen} />);
    const row = (name) => screen.getByRole('treeitem', { name });
    await user.click(screen.getByText('Before'));
    await user.tab();
    expect(row('Asha')).toHaveFocus();
    expect(screen.getAllByRole('treeitem').filter((x) => x.tabIndex === 0)).toHaveLength(1);
    await user.keyboard('{ArrowDown}');
    expect(row('Bala')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(row('Asha')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(row('Asha')).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{ArrowDown}');
    expect(row('Dev')).toHaveFocus();
    await user.keyboard('{Home}{ArrowRight}');
    expect(row('Asha')).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowRight}');
    expect(row('Bala')).toHaveFocus();
    await user.keyboard('c');
    expect(row('Chitra')).toHaveFocus();
    await user.keyboard('{End}{Enter}');
    expect(onOpen).toHaveBeenCalledWith('d');
  });
});
