import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SettingsWorkspace from './SettingsWorkspace';

describe('SettingsWorkspace', () => {
  it('keeps the complete settings index beside the selected setting content', () => {
    const onNavigate = vi.fn();
    render(
      <SettingsWorkspace activeKey="settingsTax" can={() => true} isEnabled={() => true} onNavigate={onNavigate}>
        <div>GST settings form</div>
      </SettingsWorkspace>
    );

    expect(screen.getByRole('heading', { name: 'Tax & Compliance' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'GST' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('GST settings form')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));
    expect(onNavigate).toHaveBeenCalledWith('settingsUsers');
  });

  it('provides an exit from the dedicated settings workspace', () => {
    const onExit = vi.fn();
    render(
      <SettingsWorkspace activeKey="settingsTax" can={() => true} isEnabled={() => true} onNavigate={() => {}} onExit={onExit}>
        <div>GST settings form</div>
      </SettingsWorkspace>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to application' }));
    expect(onExit).toHaveBeenCalledOnce();
  });
});
