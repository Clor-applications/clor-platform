import { Download, FileText, Table2 } from 'lucide-react';

import { exportRows } from '../ListToolbar';
import { exportListPdf } from '../../utils/listPdf';
import { exportListXlsx } from '../../utils/listXlsx';

/**
 * Every list exports the same three ways.
 *
 * The invoice list asked which format; everywhere else the Export entry wrote a
 * CSV and said nothing about it. So the same act had two different meanings
 * depending on which screen you were standing on, and a person who wanted the
 * bills as a PDF had no way to say so — CSV was the answer whether or not it
 * was the question.
 *
 * One entry, three formats behind it. Listed flat they push everything else in
 * the menu below the fold and make a four-item menu read as six.
 */
export const EXPORT_FORMATS = [
  { key: 'pdf', label: 'PDF', Icon: FileText },
  { key: 'xlsx', label: 'Excel', Icon: Table2 },
  { key: 'csv', label: 'CSV', Icon: Download },
];

/** The `moreItems` entry: one row that opens the three. */
export const exportMenuItem = (label = 'Export', key = 'export') => ({
  key,
  label,
  Icon: Download,
  children: EXPORT_FORMATS.map((f) => ({ key: `${key}:${f.key}`, label: f.label, Icon: f.Icon })),
});

/** `export:xlsx` → `xlsx`, and anything else → null, so a menu handler can bail. */
export const exportFormatFromKey = (menuKey, key = 'export') => {
  const k = String(menuKey || '');
  return k.startsWith(`${key}:`) ? k.slice(key.length + 1) : null;
};

/**
 * Write the list out in the chosen format.
 *
 * Same rows and columns the screen is showing, never a fresh query — an export
 * that quietly widens the filter produces a file that disagrees with the screen
 * it came from, and whoever is holding it cannot tell which is right.
 */
export const runListExport = ({
  format,
  fileName,
  columns,
  rows,
  label = 'rows',
  title = '',
  subtitle = '',
  sheetName = '',
  footNote = '',
}) => {
  const common = { fileName, columns, rows };
  if (format === 'pdf') {
    exportListPdf({
      ...common,
      title: title || fileName,
      subtitle,
      footNote: footNote || `${Array.isArray(rows) ? rows.length : 0} ${label} · exported from CLOR`,
    });
    return;
  }
  if (format === 'xlsx') {
    exportListXlsx({ ...common, subtitle, sheetName: sheetName || title || fileName });
    return;
  }
  exportRows({ ...common, label });
};

export default exportMenuItem;
