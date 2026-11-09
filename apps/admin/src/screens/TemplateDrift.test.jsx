import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TemplateDrift from './TemplateDrift';

/* A stock role someone changed is left alone when its template moves on (owner, 8 Nov 2026); the screen says how it differs. */
const modules = [
  { key: 'PEOPLE', label: 'People', resources: [{ key: 'Policies', label: 'Policies', actions: ['VIEW'] }, { key: 'Privacy', label: 'Privacy', actions: ['VIEW'] }] },
];

describe('how a stock role differs from its template', () => {
  it('names what the template gives that the role lacks, and what the role has besides, and offers to match', () => {
    const onMatch = vi.fn();
    render(<TemplateDrift modules={modules} onMatch={onMatch} template={{ key: 'HR_MANAGER', label: 'HR Manager', matches: false, missing: ['PEOPLE::Policies::VIEW'], extra: ['PEOPLE::Privacy::VIEW'] }} />);
    const note = screen.getByRole('note', { name: 'Differs from the HR Manager template' });
    expect(note.textContent).toContain('The template also gives');
    expect(note.textContent).toContain('Policies');
    expect(note.textContent).toContain('This role also has');
    fireEvent.click(screen.getByRole('button', { name: 'Match the template' }));
    expect(onMatch).toHaveBeenCalledTimes(1);
  });

  it('says nothing for a role that matches, or one that is no template', () => {
    const { container, rerender } = render(<TemplateDrift modules={modules} template={{ key: 'VIEWER', label: 'Viewer', matches: true, missing: [], extra: [] }} />);
    expect(container.textContent).toBe('');
    rerender(<TemplateDrift modules={modules} template={null} />);
    expect(container.textContent).toBe('');
  });

  it('shortens a long list', () => {
    const many = Array.from({ length: 7 }, (_, i) => `PEOPLE::Thing ${i}::VIEW`);
    render(<TemplateDrift modules={modules} template={{ key: 'VIEWER', label: 'Viewer', matches: false, missing: many, extra: [] }} />);
    expect(screen.getByRole('note').textContent).toContain('and 3 more');
  });
});
