import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/**
 * "Download the template" on People's and Attendance's import screens.
 *
 * The file comes from the server (services/importTemplates.ts): the headings
 * the importer reads, one example row, and a note row for each column. It is
 * made from the importer's own column list, so the template and the import
 * cannot come to disagree. Read it back with `skipComments` (utils/csv.js,
 * utils/xlsx.js) so the note rows are left out.
 */
export const getImportTemplate = (kind) =>
  apiFetch(`/orgs/${encodeURIComponent(orgId())}/import-templates/${encodeURIComponent(kind)}`, { asText: true, skipWarehouseHeader: true });

/** Saves the template for one kind of import as a CSV file. */
export async function downloadImportTemplate(kind, fileName) {
  const text = String(await getImportTemplate(kind));
  /* The byte-order mark is lost when the response is read as text; Excel needs it to read the file as UTF-8. */
  const blob = new Blob([text.startsWith('\ufeff') ? text : `\ufeff${text}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(fileName || `CLOR ${kind} import template`).replace(/[\\/:*?"<>|]+/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
