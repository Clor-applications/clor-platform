import { notify } from '@ui/components/ui/notify';
import { getEvidence } from '../api/attendance';

/**
 * Everything behind one person's days for a period, as one workbook: the
 * days, every punch with where it came from, each correction with who asked
 * and who decided, every change with before and after, leave, closed months
 * and the audit trail. For a dispute, an inspector, or a labour court.
 */
const border = { borderColor: '#E2E8F0', borderStyle: 'thin' };
const cell = (v) => ({ value: v === null || v === undefined ? '' : String(v), type: String, wrap: true, ...border });
const head = (v) => ({ value: String(v), type: String, fontWeight: 'bold', backgroundColor: '#F1F5F9', ...border });
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const STATUS = { PRESENT: 'Present', HALF_DAY: 'Half day', ABSENT: 'Absent', ON_LEAVE: 'On leave', HOLIDAY: 'Holiday', WEEKLY_OFF: 'Weekly off' };
const mins = (m) => (m ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : '');

const sheet = (name, columns, rows) => ({
  sheet: name,
  stickyRowsCount: 1,
  columns: columns.map(([, label, w]) => ({ width: w || Math.max(12, Math.min(40, label.length + 6)) })),
  data: [columns.map(([, label]) => head(label)), ...rows.map((r) => columns.map(([key]) => cell(typeof key === 'function' ? key(r) : r[key])))],
});

export async function downloadEvidence(employeeId, from, to) {
  try {
    const e = await getEvidence(employeeId, from, to);
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const summary = [
      ['Employee', `${e.employee.name}${e.employee.code ? ` (${e.employee.code})` : ''}`],
      ['Reader ID', e.employee.devicePin || ''],
      ['Department', e.employee.department || ''],
      ['Period', `${e.period.from} to ${e.period.to}`],
      ['Days recorded', String(e.days.length)],
      ['Punches', String(e.punches.length)],
      ['Corrections', String(e.corrections.length)],
      ['Changes to days', String(e.history.length)],
      ['Months closed', e.monthsClosed.map((m) => `${m.month} (${when(m.at)}, ${m.by})`).join('; ') || 'None'],
      ['Generated', when(e.generatedAt)],
    ];
    const sheets = [
      { sheet: 'Summary', columns: [{ width: 22 }, { width: 60 }], data: [[{ value: 'Attendance evidence', type: String, fontWeight: 'bold', fontSize: 14 }], ...summary.map(([k, v]) => [head(k), cell(v)])] },
      sheet('Days', [['date', 'Date'], [(r) => STATUS[r.status] || r.status, 'Status'], ['in', 'In'], ['out', 'Out'], [(r) => mins(r.workedMinutes), 'Worked'], ['lateMinutes', 'Late (min)'], ['earlyOutMinutes', 'Early out (min)'], [(r) => mins(r.overtimeMinutes), 'Overtime'], [(r) => (r.overtimeApproved ? 'Yes' : 'No'), 'Overtime approved'], ['source', 'Set by'], [(r) => (r.validated ? `Yes, ${r.validatedBy || ''}` : 'No'), 'Validated'], ['note', 'Note', 30]], e.days),
      sheet('Punches', [['local', 'Time', 20], ['kind', 'Direction'], ['source', 'Where'], ['readerId', 'Reader ID'], ['shiftDate', 'Shift day'], [(r) => (r.latitude != null ? `${r.latitude}, ${r.longitude}` : ''), 'Location', 24]], e.punches),
      sheet('Corrections', [['date', 'Day'], [(r) => `${r.before.in || '—'}–${r.before.out || '—'}`, 'Before'], [(r) => `${r.requested.in || '—'}–${r.requested.out || '—'}`, 'Asked for'], ['reason', 'Reason', 36], ['status', 'Decision'], ['askedBy', 'Asked by'], [(r) => when(r.askedAt), 'Asked on', 20], ['managerApprovedBy', 'Manager'], ['decidedBy', 'Decided by'], [(r) => when(r.decidedAt), 'Decided on', 20], ['note', 'Note', 30]], e.corrections),
      sheet('History', [['date', 'Day'], [(r) => when(r.at), 'When', 20], ['action', 'What'], ['by', 'By'], [(r) => r.changes.map((c) => `${c.field}: ${c.before ?? '—'} → ${c.after ?? '—'}`).join('; '), 'Changes', 60], ['reason', 'Why', 40]], e.history),
      sheet('Leave', [['from', 'From'], ['to', 'To'], ['days', 'Days'], ['status', 'Status'], ['reason', 'Reason', 36], ['decidedBy', 'Decided by'], [(r) => when(r.decidedAt), 'Decided on', 20]], e.leave),
      sheet('Audit', [[(r) => when(r.at), 'When', 20], ['action', 'Action'], ['message', 'What', 60], ['by', 'By']], e.audit),
    ];
    const book = writeXlsxFile(sheets, { fontFamily: 'Inter', fontSize: 10 });
    await book.toFile(`Attendance evidence ${e.employee.code || e.employee.name} ${from} to ${to}.xlsx`);
    notify.success('Evidence workbook downloaded.');
  } catch (err) {
    notify.error(String(err?.message || 'Could not build the evidence workbook.'));
  }
}
