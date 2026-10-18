import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { sendTemplate } from '../mailer.js';
import { istDate } from './compute.js';

/**
 * Reports that go out by e-mail on their own.
 *
 * Every fifteen minutes the due schedules are found: the hour (IST) has
 * arrived, the day matches the cadence, and nothing was sent in this slot
 * yet. The period is implied: a daily report covers yesterday, a weekly one
 * the seven days ending yesterday, a monthly one the month just ended — the
 * same filters a person would type on the morning after. The report is
 * built by the same code the screen uses (routes/attendanceReports.ts) and
 * sent as a table in the mail, text first so it always renders.
 */
export type Schedule = { id: string; accountId: string; orgId: string; reportId: string; paramsJson: string; cadence: string; dayOfWeek: number | null; dayOfMonth: number | null; hour: number; recipients: string; enabled: boolean; lastSentAt: Date | null };

const IST = 330 * 60_000;
const istParts = (now: Date) => {
  const d = new Date(now.getTime() + IST);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours(), dow: ((d.getUTCDay() + 6) % 7) + 1, dom: d.getUTCDate() };
};

/** The slot a schedule belongs to right now — the same value all through the hour, so one send per slot. */
export function slotOf(s: Pick<Schedule, 'cadence' | 'dayOfWeek' | 'dayOfMonth' | 'hour'>, now: Date): string | null {
  const t = istParts(now);
  if (t.hour < s.hour) return null;
  if (s.cadence === 'WEEKLY' && t.dow !== (s.dayOfWeek || 1)) return null;
  if (s.cadence === 'MONTHLY' && t.dom !== (s.dayOfMonth || 1)) return null;
  return t.date;
}

export const dueNow = (s: Schedule, now: Date) => {
  if (!s.enabled) return false;
  const slot = slotOf(s, now);
  if (!slot) return false;
  return !s.lastSentAt || istDate(s.lastSentAt) < slot;
};

/** What the report should cover, given when it runs. */
export function periodFor(s: Pick<Schedule, 'cadence'>, now: Date) {
  const t = istParts(now);
  const back = (days: number) => new Date(Date.parse(`${t.date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  if (s.cadence === 'MONTHLY') {
    const [y, m] = t.date.slice(0, 7).split('-').map(Number);
    const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
    return { month: prev, date: back(1), from: `${prev}-01`, to: new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10) };
  }
  if (s.cadence === 'WEEKLY') return { month: back(1).slice(0, 7), date: back(1), from: back(7), to: back(1) };
  return { month: back(1).slice(0, 7), date: back(1), from: back(1), to: back(1) };
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderReportHtml(r: { title: string; period: string; columns: Array<{ key: string; label: string; align?: string }>; rows: any[]; totals?: any; notes?: string[] }, companyName: string) {
  const al = (c: { align?: string }) => (c.align === 'end' ? 'right' : c.align === 'center' ? 'center' : 'left');
  const head = r.columns.map((c) => `<th style="text-align:${al(c)};border:1px solid #ccc;padding:4px 6px;background:#f3f3f3">${esc(c.label)}</th>`).join('');
  const body = r.rows.slice(0, 2000).map((row) => `<tr>${r.columns.map((c) => `<td style="text-align:${al(c)};border:1px solid #ddd;padding:3px 6px">${esc(row[c.key])}</td>`).join('')}</tr>`).join('');
  const totals = r.totals ? `<tr>${r.columns.map((c) => `<td style="border:1px solid #ddd;padding:3px 6px;font-weight:600">${esc(r.totals[c.key] ?? '')}</td>`).join('')}</tr>` : '';
  const notes = (r.notes || []).map((n) => `<p style="color:#555;font-size:12px">${esc(n)}</p>`).join('');
  return `<div style="font:13px system-ui,sans-serif;color:#111"><h2 style="margin:0 0 2px">${esc(r.title)}</h2><p style="margin:0 0 10px;color:#555">${esc(r.period)} · ${esc(companyName)}</p><table style="border-collapse:collapse">${head ? `<thead><tr>${head}</tr></thead>` : ''}<tbody>${body}${totals}</tbody></table>${r.rows.length > 2000 ? '<p>Showing the first 2,000 rows.</p>' : ''}${notes}</div>`;
}

const summaryOf = (r: { rows: any[]; totals?: any }) => {
  const t = r.totals ? Object.values(r.totals).filter((v) => typeof v === 'string' && /\d/.test(v)).slice(0, 3).join(' · ') : '';
  return `${r.rows.length} row${r.rows.length === 1 ? '' : 's'}${t ? ` — ${t}` : ''}.`;
};

/** Build and send one schedule now. Records the outcome on the schedule; never throws. */
export async function runSchedule(s: Schedule, build: (reportId: string, accountId: string, orgId: string, q: any) => Promise<any>, now = new Date()) {
  try {
    const params = { ...(JSON.parse(s.paramsJson || '{}') as Record<string, string>), ...periodFor(s, now) };
    const report = await build(s.reportId, s.accountId, s.orgId, params);
    const org = await platformPrisma.org.findUnique({ where: { id: s.orgId }, select: { name: true } });
    const html = renderReportHtml(report, org?.name || '');
    const to = s.recipients.split(/[,\s;]+/).map((x) => x.trim()).filter((x) => /.+@.+\..+/.test(x));
    if (!to.length) throw new Error('No valid recipient address');
    for (const addr of to) {
      await sendTemplate({ templateKey: 'reports.scheduled', to: addr, accountId: s.accountId, orgId: s.orgId, data: { reportTitle: report.title, period: report.period, companyName: org?.name || '', summary: summaryOf(report) }, html, relatedType: 'ReportSchedule', relatedId: s.id, transactional: true });
    }
    await peoplePrisma.reportSchedule.update({ where: { id: s.id }, data: { lastSentAt: now, lastError: null } });
    return { ok: true, sent: to.length, rows: report.rows.length };
  } catch (e: any) {
    await peoplePrisma.reportSchedule.update({ where: { id: s.id }, data: { lastError: String(e?.message || e).slice(0, 500) } }).catch(() => {});
    return { ok: false, sent: 0, error: String(e?.message || e) };
  }
}

export async function runDueSchedules(build: (reportId: string, accountId: string, orgId: string, q: any) => Promise<any>, now = new Date()) {
  const rows = await peoplePrisma.reportSchedule.findMany({ where: { enabled: true } });
  let n = 0;
  for (const s of rows) if (dueNow(s, now)) { await runSchedule(s, build, now); n += 1; }
  return n;
}

export function startReportSchedules(build: (reportId: string, accountId: string, orgId: string, q: any) => Promise<any>, { intervalMs = 15 * 60_000, startupDelayMs = 120_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () => runDueSchedules(build).catch((e) => console.error('[reports] schedules failed:', e instanceof Error ? e.message : e)); // eslint-disable-line no-console
  const t = setTimeout(() => { tick(); const i = setInterval(tick, intervalMs); i.unref?.(); }, startupDelayMs);
  t.unref?.();
  return () => clearTimeout(t);
}
