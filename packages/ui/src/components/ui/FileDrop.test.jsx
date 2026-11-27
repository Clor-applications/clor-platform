import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FileDrop, { installStrayDropGuard } from './FileDrop';

const pdf = (size = 1000, name = 'note.pdf') => {
  const f = new File(['x'], name, { type: 'application/pdf' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const filesDrag = (files = []) => ({ dataTransfer: { types: ['Files'], files, dropEffect: 'none' } });

function Harness(props) {
  const [file, setFile] = useState(null);
  return <FileDrop label="Document" file={file} onFile={(f) => { props.onFile?.(f); setFile(f); }} accept="application/pdf" maxBytes={2 * 1024 * 1024} hint="PDF, up to 2 MB" {...props} />;
}

describe('FileDrop', () => {
  it('reacts while a file is over it and takes the dropped file as a row', async () => {
    render(<Harness />);
    const zone = screen.getByRole('button', { name: 'Document: choose a file' });
    fireEvent.dragEnter(zone, filesDrag());
    await waitFor(() => expect(zone).toHaveAttribute('data-over'));
    expect(screen.getByText('Release to attach')).toBeInTheDocument();
    fireEvent.drop(zone, filesDrag([pdf(1536)]));
    expect(await screen.findByText('note.pdf')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove note.pdf' })).toBeInTheDocument();
  });

  it('refuses a file over the limit or of the wrong kind, in words, without passing it on', () => {
    const onFile = vi.fn();
    render(<Harness onFile={onFile} />);
    const input = screen.getByLabelText('Document');
    fireEvent.change(input, { target: { files: [pdf(3 * 1024 * 1024, 'big.pdf')] } });
    expect(screen.getByRole('alert')).toHaveTextContent('big.pdf is 3 MB. Files up to 2 MB.');
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.exe', { type: 'application/x-msdownload' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('a.exe is not a kind of file this takes.');
    expect(onFile).not.toHaveBeenCalled();
  });

  it('keeps the file beside a failure and offers Try again', () => {
    const onRetry = vi.fn();
    render(<FileDrop label="Bill" file={pdf()} onFile={() => {}} error="The upload failed." onRetry={onRetry} />);
    expect(screen.getByText('note.pdf')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The upload failed.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('Remove clears the file', () => {
    const onFile = vi.fn();
    render(<FileDrop label="Bill" file={pdf()} onFile={onFile} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove note.pdf' }));
    expect(onFile).toHaveBeenCalledWith(null);
  });
});

describe('installStrayDropGuard', () => {
  it('stops a file let go outside a drop field from opening in the tab', () => {
    const stop = installStrayDropGuard(window);
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    ev.dataTransfer = { types: ['Files'] };
    outside.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);

    const field = document.createElement('div');
    field.setAttribute('data-file-drop', '');
    document.body.appendChild(field);
    const inside = new Event('drop', { bubbles: true, cancelable: true });
    inside.dataTransfer = { types: ['Files'] };
    field.dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(false);
    stop();
    outside.remove();
    field.remove();
  });
});
