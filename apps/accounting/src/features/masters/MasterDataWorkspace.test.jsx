import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MasterDataWorkspace from './MasterDataWorkspace';

describe('MasterDataWorkspace', () => {
  it('uses a dedicated master-data sidebar and supports navigation and exit', () => {
    const onNavigate = vi.fn();
    const onExit = vi.fn();

    render(
      <MasterDataWorkspace
        activeKey="items"
        onNavigate={onNavigate}
        onExit={onExit}
      >
        <div>Item page</div>
      </MasterDataWorkspace>,
    );

    expect(screen.getByRole('heading', { name: 'Master Data' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Master Data navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Organisation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Companies' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Item List' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Item page')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Units' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to application' }));

    expect(onNavigate).toHaveBeenCalledWith('uoms');
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('removes unavailable masters from its sidebar', () => {
    render(
      <MasterDataWorkspace
        activeKey="items"
        can={(permission) => !permission.includes('GST Rates')}
        isEnabled={(feature) => feature !== 'priceLists' && feature !== 'companyGroups'}
        onNavigate={() => {}}
      >
        <div />
      </MasterDataWorkspace>,
    );

    expect(screen.queryByRole('button', { name: 'Companies' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Price Lists' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'GST Rates' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Item List' })).toBeInTheDocument();
  });

  it('shows TDS and TCS rate masters only when their features are enabled', () => {
    const { rerender } = render(
      <MasterDataWorkspace activeKey="tdsRates" isEnabled={(feature) => feature === 'tds'} onNavigate={() => {}}>
        <div />
      </MasterDataWorkspace>,
    );
    expect(screen.getByRole('button', { name: 'TDS Rates' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'TCS Rates' })).toBeNull();

    rerender(
      <MasterDataWorkspace activeKey="tcsRates" isEnabled={(feature) => feature === 'tcs'} onNavigate={() => {}}>
        <div />
      </MasterDataWorkspace>,
    );
    expect(screen.queryByRole('button', { name: 'TDS Rates' })).toBeNull();
    expect(screen.getByRole('button', { name: 'TCS Rates' })).toBeInTheDocument();
  });
});
