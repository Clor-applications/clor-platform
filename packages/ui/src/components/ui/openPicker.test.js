import { describe, it, expect, vi, afterEach } from 'vitest';
import { openPickerOnClick } from './TipLayer';

afterEach(() => { delete document.documentElement.dataset.palette; });

describe('date boxes open their calendar on click', () => {
  it('opens a date box, leaves text boxes and Books alone', () => {
    const date = document.createElement('input'); date.type = 'date'; date.showPicker = vi.fn();
    const text = document.createElement('input'); text.type = 'text'; text.showPicker = vi.fn();
    openPickerOnClick({ target: date });
    openPickerOnClick({ target: text });
    expect(date.showPicker).toHaveBeenCalledTimes(1);
    expect(text.showPicker).not.toHaveBeenCalled();
    document.documentElement.dataset.palette = 'indigo';
    openPickerOnClick({ target: date });
    expect(date.showPicker).toHaveBeenCalledTimes(1);
  });
  it('survives a browser that refuses', () => {
    const date = document.createElement('input'); date.type = 'date'; date.showPicker = () => { throw new Error('NotAllowed'); };
    expect(() => openPickerOnClick({ target: date })).not.toThrow();
  });
});
