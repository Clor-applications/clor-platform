import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Button, useDoneFlash } from './Primitives';

/**
 * The shared button states (DESIGN.md, Buttons): loading keeps the label and
 * refuses a second press; done says "Saved" for a moment and goes back.
 */
const Plus = (props) => <svg data-testid="icon" {...props} />;

describe('Button loading', () => {
  it('sets aria-busy, keeps the label as its name, and ignores clicks', () => {
    const onClick = vi.fn();
    render(<Button variant="primary" loading onClick={onClick}>Save</Button>);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b).toHaveAttribute('aria-busy', 'true');
    expect(b).toHaveAttribute('data-state', 'loading');
    expect(b).not.toBeDisabled();
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('refuses a second submit of its form while loading', () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    render(<form onSubmit={onSubmit}><Button type="submit" variant="primary" loading>Save</Button></form>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('draws the spinner in the icon slot, so the width holds', () => {
    const { container } = render(<Button icon={Plus} loading>Add</Button>);
    expect(container.querySelector('.ui-btn-icon .ui-btn-spinner')).not.toBeNull();
    expect(screen.queryByTestId('icon')).toBeNull();
  });

  it('clicks through again once it stops loading', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button loading onClick={onClick}>Send</Button>);
    rerender(<Button loading={false} onClick={onClick}>Send</Button>);
    const b = screen.getByRole('button', { name: 'Send' });
    expect(b).not.toHaveAttribute('aria-busy');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Button done', () => {
  const Saver = () => {
    const [done, flash] = useDoneFlash(1500);
    return <Button variant="primary" done={done} onClick={flash}>Save</Button>;
  };

  it('says Saved with a tick for about 1.5s, announced, then goes back', () => {
    vi.useFakeTimers();
    try {
      render(<Saver />);
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      const b = screen.getByRole('button', { name: 'Saved' });
      expect(b).toHaveAttribute('data-state', 'done');
      expect(screen.getByRole('status')).toHaveTextContent('Saved');
      act(() => { vi.advanceTimersByTime(1499); });
      expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(2); });
      expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('data-state');
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes its own word', () => {
    render(<Button icon={Plus} done doneLabel="Added">Add</Button>);
    expect(screen.getByRole('button', { name: 'Added' })).toBeInTheDocument();
  });
});

describe('button state styles', () => {
  const css = readFileSync('packages/ui/src/index.css', 'utf8');
  const people = readFileSync('packages/ui/src/people.css', 'utf8');

  it('blocks clicks without the disabled look', () => {
    expect(css).toMatch(/\.ui-btn\[aria-busy='true'\],\s*\.ui-btn\[data-state='loading'\] \{\s*pointer-events: none;\s*\}/);
  });

  it('breathes instead of spinning under reduced motion, past the global freeze', () => {
    const block = css.slice(css.indexOf('Less motion: the ring stops turning'));
    expect(block).toMatch(/animation: ui-btn-pulse [^;]*infinite !important/);
  });

  it('in People, gives labelled button icons marigold but never icon-only or danger buttons', () => {
    expect(people).toMatch(/--btn-icon: 245 166 35;/);
    const at = people.indexOf('--btn-icon-color: rgb(var(--btn-icon))');
    const rule = people.slice(people.lastIndexOf('\n:root', at), at);
    expect(rule).toContain(':not(.ui-btn-icon-only, [data-icon-only])');
    expect(rule).not.toContain('ui-btn-danger');
    expect(rule).toContain("[data-palette='sky']");
  });
});
