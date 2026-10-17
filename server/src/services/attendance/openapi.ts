/**
 * The public API, described once (OpenAPI 3.0) and served at /v1/openapi.json
 * for tools, and as a plain page at /v1/docs for people. Written by hand from
 * the routes in routes/publicApi.ts, so a new endpoint is a new entry here —
 * which is also the reminder to document it.
 */

const auth = [{ bearer: [] }, { apiKey: [] }];
const q = (name: string, description: string, schema: Record<string, unknown> = { type: 'string' }, required = false) => ({ name, in: 'query', description, required, schema });
const p = (name: string, description: string) => ({ name, in: 'path', required: true, description, schema: { type: 'string' } });
const okJson = (description: string, schema: Record<string, unknown>) => ({ 200: { description, content: { 'application/json': { schema } } } });
const obj = (properties: Record<string, unknown>, required?: string[]) => ({ type: 'object', properties, ...(required ? { required } : {}) });
const arr = (items: Record<string, unknown>) => ({ type: 'array', items });
const str = { type: 'string' };
const num = { type: 'number' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const nstr = { type: 'string', nullable: true };
const date = { type: 'string', format: 'date', example: '2026-10-17' };
const time = { type: 'string', example: '2026-10-17 09:05:12', description: 'Indian Standard Time' };

const Employee = obj({ id: str, code: nstr, name: str, department: nstr, designation: nstr, status: { type: 'string', enum: ['ACTIVE', 'ON_NOTICE', 'LEFT', 'SUSPENDED'] }, dateOfJoining: nstr, dateOfLeaving: nstr, readerId: nstr, workEmail: nstr, updatedAt: { type: 'string', format: 'date-time' } });
const Day = obj({ employeeId: str, employeeCode: nstr, date, status: str, checkIn: nstr, checkOut: nstr, workedMinutes: int, lateMinutes: int, earlyOutMinutes: int, overtimeMinutes: int, overtimeApproved: bool, validated: bool, source: str, updatedAt: { type: 'string', format: 'date-time' } });
const Punch = obj({ readerId: str, employeeId: nstr, time, direction: nstr, verifyMode: int, reader: str, countedOn: nstr });
const Leave = obj({ id: str, employeeId: str, employeeCode: nstr, employeeName: nstr, leaveType: nstr, isPaid: bool, fromDate: date, toDate: date, days: num, status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] }, reason: str, reviewNote: nstr });
const Cursor = { next_cursor: { ...nstr, description: 'Pass back as `cursor` for the next page; null when there is no more.' } };

export const OPENAPI = {
  openapi: '3.0.3',
  info: {
    title: 'CLOR Attendance API',
    version: '2',
    description:
      'Attendance, employees and leave for one company, for an HRMS, payroll or middleware. Send the API key as `Authorization: Bearer clor_…` (or `X-API-Key`). Times are Indian Standard Time. 120 calls a minute per key. Writes may carry an `Idempotency-Key` header: the same key repeated returns the first answer (`Idempotency-Replayed: true`). Lists that take `updated_since` page with `cursor`.',
  },
  servers: [{ url: 'https://api.clor.in/v1' }],
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' }, apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
    schemas: { Employee, Day, Punch, Leave },
  },
  security: auth,
  paths: {
    '/ping': { get: { summary: 'Check the key', responses: okJson('The key, its company and scopes', obj({ ok: bool, orgId: str, key: str, scopes: arr(str) })) } },
    '/employees': {
      get: {
        summary: 'Employees',
        description: 'Scope employees:read. Everyone, or only those changed since a time, in pages.',
        parameters: [q('updated_since', 'ISO date-time; only employees changed since then', { type: 'string', format: 'date-time' }), q('cursor', 'From a previous page'), q('limit', '1–500, default 200', int)],
        responses: okJson('Employees', obj({ employees: arr({ $ref: '#/components/schemas/Employee' }), ...Cursor })),
      },
      post: {
        summary: 'Add or update an employee by code',
        description: 'Scope employees:write. The code identifies the person: an unknown code adds them, a known one updates them (your HRMS is the master). Someone set to LEFT is removed from every reader.',
        requestBody: { required: true, content: { 'application/json': { schema: obj({ code: str, name: str, department: nstr, designation: nstr, dateOfJoining: date, dateOfLeaving: { ...date, nullable: true }, status: str, workEmail: nstr, readerId: { ...nstr, description: 'The ID enrolled on readers, when not the code' } }, ['code']) } } },
        responses: { ...okJson('Updated', obj({ employee: { $ref: '#/components/schemas/Employee' }, created: bool })), 201: { description: 'Added' } },
      },
    },
    '/employees/{code}': {
      patch: { summary: 'Change some of an employee’s details', description: 'Scope employees:write.', parameters: [p('code', 'Employee code')], requestBody: { required: true, content: { 'application/json': { schema: obj({ name: str, department: nstr, designation: nstr, dateOfJoining: date, dateOfLeaving: { ...date, nullable: true }, status: str, workEmail: nstr, readerId: nstr }) } } }, responses: okJson('Updated', obj({ employee: { $ref: '#/components/schemas/Employee' } })) },
    },
    '/attendance/days': {
      get: {
        summary: 'Days',
        description: 'Scope attendance:read. A date range (≤ 92 days), or everything changed since a time, in pages.',
        parameters: [q('from', 'YYYY-MM-DD'), q('to', 'YYYY-MM-DD'), q('updated_since', 'ISO date-time', { type: 'string', format: 'date-time' }), q('cursor', 'From a previous page'), q('limit', '1–1000, default 500', int)],
        responses: okJson('Days', obj({ from: date, to: date, days: arr({ $ref: '#/components/schemas/Day' }), ...Cursor })),
      },
    },
    '/attendance/punches': {
      get: { summary: 'Punches in a date range', description: 'Scope attendance:read. ≤ 92 days, ≤ 20 000 punches.', parameters: [q('from', 'YYYY-MM-DD'), q('to', 'YYYY-MM-DD')], responses: okJson('Punches', obj({ punches: arr({ $ref: '#/components/schemas/Punch' }) })) },
      post: {
        summary: 'Send punches',
        description: 'Scope punches:write. From other readers, turnstiles or apps; ≤ 500 per call; duplicates dropped.',
        requestBody: { required: true, content: { 'application/json': { schema: obj({ punches: arr(obj({ employee_code: str, timestamp: time, direction: { type: 'string', enum: ['in', 'out'] }, verify_mode: str }, ['employee_code', 'timestamp'])) }) } } },
        responses: okJson('What was taken', obj({ received: int, accepted: int, added: int, duplicates: int, rejected: int, errors: arr(str) })),
      },
    },
    '/attendance/summary': { get: { summary: 'Month summary per person', description: 'Scope attendance:read.', parameters: [q('month', 'YYYY-MM')], responses: okJson('Rows', obj({ month: str, days: int, rows: arr({ type: 'object' }) })) } },
    '/attendance/months': { get: { summary: 'Which months are closed for payroll', description: 'Scope attendance:read.', parameters: [q('year', 'YYYY, default this year')], responses: okJson('Months', obj({ months: arr(obj({ month: str, closed: bool })) })) } },
    '/attendance/shifts': {
      get: { summary: 'Who is on which shift, per day', description: 'Scope attendance:read. ≤ 31 days.', parameters: [q('from', 'YYYY-MM-DD'), q('to', 'YYYY-MM-DD'), q('employee_code', 'One person')], responses: okJson('Shifts', obj({ shifts: arr(obj({ employeeId: str, employeeCode: nstr, date, shift: nstr, start: nstr, end: nstr, weeklyOff: bool, holiday: nstr })) })) },
    },
    '/readers': { get: { summary: 'Readers and their state', description: 'Scope readers:read.', responses: okJson('Readers', obj({ readers: arr(obj({ id: str, name: str, serialNumber: str, driver: str, online: bool, lastSeenAt: nstr, areaId: nstr, punchesToday: int })) })) } },
    '/leave/types': { get: { summary: 'Leave types', description: 'Scope leave:read.', responses: okJson('Types', obj({ types: arr(obj({ id: str, name: str, code: nstr, isPaid: bool, annualDays: num, accrual: str, carryForwardMax: { ...num, nullable: true } })) })) } },
    '/leave/balances': { get: { summary: 'Leave balances for a year', description: 'Scope leave:read.', parameters: [q('year', 'YYYY, default this year'), q('employee_code', 'One person')], responses: okJson('Balances', obj({ year: int, rows: arr({ type: 'object' }) })) } },
    '/leave/requests': {
      get: { summary: 'Leave requests', description: 'Scope leave:read.', parameters: [q('from', 'YYYY-MM-DD'), q('to', 'YYYY-MM-DD'), q('status', 'PENDING | APPROVED | REJECTED | CANCELLED'), q('employee_code', 'One person')], responses: okJson('Requests', obj({ requests: arr({ $ref: '#/components/schemas/Leave' }) })) },
      post: {
        summary: 'Ask for leave on somebody’s behalf',
        description: 'Scope leave:write. Lands as PENDING, like a request from the portal.',
        requestBody: { required: true, content: { 'application/json': { schema: obj({ employee_code: str, leave_type: { type: 'string', description: 'Type code or name' }, from: date, to: date, reason: str }, ['employee_code', 'leave_type', 'from', 'to', 'reason']) } } },
        responses: { 201: { description: 'Created', content: { 'application/json': { schema: obj({ request: { $ref: '#/components/schemas/Leave' } }) } } } },
      },
    },
    '/leave/requests/{id}/approve': { post: { summary: 'Approve a pending request', description: 'Scope leave:write. The same checks as in CLOR: balance, worked days, closed months.', parameters: [p('id', 'Request id')], requestBody: { content: { 'application/json': { schema: obj({ note: str }) } } }, responses: okJson('Approved', obj({ request: { $ref: '#/components/schemas/Leave' } })) } },
    '/leave/requests/{id}/reject': { post: { summary: 'Reject a pending request', description: 'Scope leave:write.', parameters: [p('id', 'Request id')], requestBody: { content: { 'application/json': { schema: obj({ note: str }) } } }, responses: okJson('Rejected', obj({ request: { $ref: '#/components/schemas/Leave' } })) } },
  },
  'x-webhooks': {
    description: 'CLOR calls your URL with POST JSON { event, orgId, sentAt, data } and headers X-Clor-Event, X-Clor-Delivery, X-Clor-Attempt, X-Clor-Timestamp and X-Clor-Signature (sha256= HMAC-SHA256 of the raw body with the webhook secret). Failed deliveries are retried after 1, 5, 30, 120 and 720 minutes.',
    events: ['punch', 'day', 'employee.created', 'employee.updated', 'employee.left', 'leave.requested', 'leave.approved', 'leave.rejected', 'leave.cancelled', 'correction.approved', 'month.closed', 'month.reopened', 'reader.offline', 'reader.online'],
  },
};

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** Escaped, with `code` spans for the backticks the descriptions use. */
const prose = (v: unknown) => esc(v).replace(/`([^`]+)`/g, '<code>$1</code>');

/** A readable page of the same spec: one block per endpoint, no scripts, no outside files. */
export function docsHtml(spec: typeof OPENAPI) {
  const rows: string[] = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods as Record<string, any>)) {
      const params = (op.parameters || []).map((x: any) => `<li><code>${esc(x.name)}</code> <span class="m">${esc(x.in)}${x.required ? ', required' : ''}</span> — ${esc(x.description)}</li>`).join('');
      const body = op.requestBody?.content?.['application/json']?.schema?.properties
        ? `<p class="h">Body</p><ul>${Object.entries(op.requestBody.content['application/json'].schema.properties).map(([k, v]: any) => `<li><code>${esc(k)}</code>${(op.requestBody.content['application/json'].schema.required || []).includes(k) ? ' <span class="m">required</span>' : ''}${v.description ? ` — ${esc(v.description)}` : v.enum ? ` — ${esc(v.enum.join(' | '))}` : ''}</li>`).join('')}</ul>`
        : '';
      rows.push(`<section><h3><span class="v ${method}">${method.toUpperCase()}</span> <code>${esc(path)}</code></h3><p><strong>${esc(op.summary)}</strong>${op.description ? ` — ${esc(op.description)}` : ''}</p>${params ? `<p class="h">Parameters</p><ul>${params}</ul>` : ''}${body}</section>`);
    }
  }
  const wh = spec['x-webhooks'];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(spec.info.title)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px;color:#1b1b1b}h1{font-size:24px}h3{font-size:16px;margin:0 0 4px}section{padding:14px 0;border-top:1px solid #ddd}code{font-family:ui-monospace,Menlo,monospace;font-size:13px;background:#f4f4f4;padding:1px 4px;border-radius:3px}.v{display:inline-block;min-width:52px;text-align:center;font-size:12px;font-weight:700;border-radius:3px;padding:1px 6px;color:#fff;background:#555}.get{background:#2e7d32}.post{background:#1565c0}.patch{background:#ef6c00}.h{margin:8px 0 2px;font-weight:600;font-size:13px}.m{color:#666;font-size:12px}ul{margin:0 0 0 18px;padding:0}p{margin:4px 0}a{color:#1565c0}</style></head><body>
<h1>${esc(spec.info.title)}</h1><p>${prose(spec.info.description)}</p><p>Machine-readable: <a href="/v1/openapi.json">/v1/openapi.json</a>. Base address <code>${esc(spec.servers[0].url)}</code>.</p>
${rows.join('')}
<section><h3>Webhooks</h3><p>${prose(wh.description)}</p><p class="h">Events</p><p>${wh.events.map((e) => `<code>${esc(e)}</code>`).join(' ')}</p></section>
</body></html>`;
}
