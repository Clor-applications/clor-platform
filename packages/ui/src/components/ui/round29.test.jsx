import React from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({ props: null }));
vi.mock('sonner', () => ({
  Toaster: (props) => {
    seen.props = props;
    return null;
  },
  toast: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import Toaster from './Toaster';
import JoinLeaveBars from '../../timeOff/JoinLeaveBars';
import ReportChart from '../../../../../apps/people/src/components/ReportChart';

afterEach(() => {
  delete document.documentElement.dataset.palette;
});

describe('round 29: several messages at once (toaststack A)', () => {
  it('stands three open, newest in front, outside Books', () => {
    render(<Toaster />);
    expect(seen.props.visibleToasts).toBe(3);
    expect(seen.props.expand).toBe(true);
  });

  it('leaves Books with its collapsed pile of five', () => {
    document.documentElement.dataset.palette = 'indigo';
    render(<Toaster />);
    expect(seen.props.visibleToasts).toBe(5);
    expect(seen.props.expand).toBe(false);
  });
});

describe('round 29: a chart with nothing to show yet (chartempty C)', () => {
  it('draws no report chart when every value is zero', () => {
    const chart = { kind: 'stacked', categories: ['Jan', 'Feb'], series: [{ label: 'Overtime', values: [0, 0] }] };
    const { container } = render(<ReportChart chart={chart} label="Overtime cost" />);
    expect(container.firstChild).toBeNull();
  });

  it('still draws it once there is a figure', () => {
    const chart = { kind: 'stacked', categories: ['Jan', 'Feb'], series: [{ label: 'Overtime', values: [0, 3] }] };
    const { getByRole } = render(<ReportChart chart={chart} label="Overtime cost" />);
    expect(getByRole('img', { name: /Overtime cost/ })).toBeInTheDocument();
  });

  it('draws no joined-and-left chart when nobody joined or left', () => {
    const { container } = render(<JoinLeaveBars rows={[{ label: 'Jan', joiners: 0, leavers: 0 }]} />);
    expect(container.firstChild).toBeNull();
  });
});
