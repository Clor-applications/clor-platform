import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SettingsHub from './SettingsHub';

describe('SettingsHub', () => {
  const renderHub = (props = {}) => render(<SettingsHub can={() => true} isEnabled={() => true} onOpenSetting={vi.fn()} {...props} />);

  it('uses the reports-style category workspace', () => {
    renderHub();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Settings navigation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Organisation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Company Profile/ })).toBeInTheDocument();
  });

  it('uses category names as headings and puts their settings below them', () => {
    const onOpenSetting = vi.fn();
    renderHub({ onOpenSetting });
    expect(screen.queryByRole('button', { name: 'Tax & Compliance' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Tax & Compliance' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^GST/ }));
    expect(onOpenSetting).toHaveBeenCalledWith('settingsTax');
  });

  it('searches every category and opens the selected setting', () => {
    const onOpenSetting = vi.fn();
    renderHub({ onOpenSetting });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search all settings' }), { target: { value: 'password' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Login & Security/ }).at(-1));
    expect(onOpenSetting).toHaveBeenCalledWith('settingsSecurity');
  });

  it('leaves the dedicated settings workspace through its own header', () => {
    const onExit = vi.fn();
    renderHub({ onExit });
    fireEvent.click(screen.getByRole('button', { name: 'Back to application' }));
    expect(onExit).toHaveBeenCalledOnce();
  });
});
