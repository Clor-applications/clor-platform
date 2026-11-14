import { monthBounds, offsetMonth, previousPeriod, priorYearPeriod } from './profitLossModel';
import { formatDateIn } from '@ui/utils/dates';
import { getDecimalPlaces, getNumberLocale } from '@ui/utils/money';

export const displayReportPeriod = range => `${formatDateIn(range.start)} – ${formatDateIn(range.end)}`;
export const compactReportPeriod = range => {
  if (!range?.start || !range?.end) return 'Choose dates';
  return displayReportPeriod(range);
};
export const reportPeriodLines = range => {
  return [displayReportPeriod(range)];
};
export const reportComparisonRanges = (current, type, count, periodMode, month, customRange) => {
  if (type === 'none') return [];
  if (type === 'custom') return [customRange];
  const ranges = [];
  for (let index = 1; index <= count; index += 1) {
    if (type === 'previousYear') ranges.push(priorYearPeriod(ranges[index - 2] || current));
    else if (periodMode === 'month') ranges.push(monthBounds(offsetMonth(month, -index)));
    else ranges.push(previousPeriod(ranges[index - 2] || current));
  }
  return ranges;
};
export const formatReportAmount = value => new Intl.NumberFormat(getNumberLocale(), {
  minimumFractionDigits: getDecimalPlaces(),
  maximumFractionDigits: getDecimalPlaces(),
}).format(Number(value) || 0);
