import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import Drawer from '@ui/components/ui/Drawer';
import Modal from '@ui/components/ui/Modal';
import Toaster from '@ui/components/ui/Toaster';
import { confirmDialog } from '@ui/components/ui/notify';

const escape = (el = document.activeElement || document.body) => fireEvent.keyDown(el, { key: 'Escape' });

describe('one stack of open layers', () => {
  it('Escape on a confirm opened from a dialog closes only the confirm', async () => {
    const onClose = vi.fn();
    render(
      <>
        <Toaster />
        <Modal title="Edit item" onClose={onClose}>
          <p>Body</p>
        </Modal>
      </>
    );
    let answer;
    act(() => {
      answer = confirmDialog({ title: 'Delete item?', confirmLabel: 'Delete' });
    });
    await screen.findByText('Delete item?');
    escape();
    await expect(answer).resolves.toBe(false);
    expect(screen.queryByText('Delete item?')).toBeNull();
    await new Promise((r) => setTimeout(r, 200));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeInTheDocument();
  });

  it('Escape on a dialog opened from a drawer closes only the dialog', async () => {
    const drawerClose = vi.fn();
    const Both = () => {
      const [dialog, setDialog] = useState(true);
      return (
        <Drawer open title="Branch" onClose={drawerClose}>
          {dialog ? (
            <Modal title="Pick a city" onClose={() => setDialog(false)}>
              <button type="button">Pune</button>
            </Modal>
          ) : null}
        </Drawer>
      );
    };
    render(<Both />);
    escape(screen.getByText('Pune'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pick a city' })).toBeNull());
    await new Promise((r) => setTimeout(r, 200));
    expect(drawerClose).not.toHaveBeenCalled();
  });

  it('a dialog tells its owner it closed once', async () => {
    const onClose = vi.fn();
    render(
      <Modal title="Once" onClose={onClose}>
        <p>Body</p>
      </Modal>
    );
    const panel = screen.getByRole('dialog', { name: 'Once' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await new Promise((r) => setTimeout(r, 200));
    fireEvent.animationEnd(panel);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a busy dialog waits for its request before it closes', async () => {
    const onClose = vi.fn();
    render(
      <Modal title="Sending" onClose={onClose} busy>
        <p>Body</p>
      </Modal>
    );
    escape();
    await new Promise((r) => setTimeout(r, 200));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a confirm with an action cannot be cancelled while it runs', async () => {
    render(<Toaster />);
    let finish;
    const action = vi.fn(() => new Promise((r) => { finish = r; }));
    let answer;
    act(() => {
      answer = confirmDialog({ title: 'Mark paid?', confirmLabel: 'Mark paid', tone: 'primary', action });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }));
    expect(await screen.findByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    escape();
    expect(screen.getByText('Mark paid?')).toBeInTheDocument();
    await act(async () => finish());
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByText('Mark paid?')).toBeNull();
  });

  it('the code prompt shows it is checking until the server answers', async () => {
    render(<Toaster />);
    let got;
    const detail = { message: 'This needs your code.', resolve: (v) => { got = v; } };
    act(() => {
      window.dispatchEvent(new CustomEvent('clor:step-up', { detail }));
    });
    const input = await screen.findByLabelText('Code from your authenticator app');
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm code' }));
    expect(got).toBe('123456');
    expect(await screen.findByRole('button', { name: 'Checking…' })).toBeDisabled();
    escape(input);
    expect(screen.getByText('This needs your code.')).toBeInTheDocument();
    act(() => detail.settle('ok'));
    await waitFor(() => expect(screen.queryByText('This needs your code.')).toBeNull());
  });

  it('Tab stays inside the confirm', async () => {
    render(<Toaster />);
    act(() => {
      confirmDialog({ title: 'Remove?', confirmLabel: 'Remove' });
    });
    const remove = await screen.findByRole('button', { name: 'Remove' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();
    remove.focus();
    fireEvent.keyDown(remove, { key: 'Tab' });
    expect(cancel).toHaveFocus();
  });
});
