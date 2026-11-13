import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui/personnel/api', () => ({ importContractors: vi.fn(), importEmployees: vi.fn() }));
vi.mock('../api/attendance', () => ({ importAssignments: vi.fn(), importHolidays: vi.fn(), importLeaveBalances: vi.fn(), importLeaveHistory: vi.fn(), importRecords: vi.fn() }));

import { KINDS, columnsOf } from './DataImport';
import { matchColumns } from '@ui/utils/importColumns';
import { parseCsv } from '@ui/utils/csv';
import { IMPORT_FIELDS } from '@ui/personnel/Employees';
/* The server's list of what each importer reads, which the downloaded templates are made from. Plain data, no imports. */
import { IMPORT_TEMPLATES, templateCsv } from '../../../../server/src/services/importTemplates.ts';

const template = (kind) => IMPORT_TEMPLATES.find((t) => t.kind === kind);

describe('Import data and its templates', () => {
  it('offers a template for every kind, with the same columns the screen reads', () => {
    for (const kind of KINDS) {
      const t = template(kind.id);
      expect(t, kind.id).toBeTruthy();
      expect(kind.columns.map((c) => c.key), kind.id).toEqual(t.columns.map((c) => c.key));
    }
  });

  it('reads a downloaded template back: every heading matched, the notes left out, the example row kept', () => {
    for (const kind of KINDS) {
      const t = template(kind.id);
      const { headers, rows } = parseCsv(templateCsv(t), { skipComments: true });
      const mapping = matchColumns(headers, columnsOf(kind));
      expect(mapping.size, kind.id).toBe(t.columns.length);
      expect(rows).toHaveLength(1);
    }
  });

  it('People’s employee import knows every column of the employees template', () => {
    const fields = new Set(IMPORT_FIELDS.map((f) => f.key));
    for (const c of template('employees').columns) expect(fields.has(c.key), c.key).toBe(true);
  });
});
