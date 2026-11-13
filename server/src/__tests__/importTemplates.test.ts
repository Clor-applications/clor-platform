import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The import templates of People and Attendance (services/importTemplates.ts):
 * a template downloaded from CLOR goes straight back in. Each one is read the
 * way the import screens read a file (the web CSV reader, note rows left out)
 * and its example row is sent to the importer it belongs to; then each needed
 * column is blanked in turn, and the importer has to refuse the row.
 */
const { buildApp } = await import('../app.js');
const { IMPORT_TEMPLATES, exampleRow, importTemplate, templateCsv } = await import('../services/importTemplates.js');
const { importRow } = await import('../routes/people.js');

/* The reader the import screens use (packages/ui/src/utils/csv.js); plain JavaScript, loaded by path so the server's types stay out of it. */
const here = path.dirname(fileURLToPath(import.meta.url));
const csvReader = pathToFileURL(path.resolve(here, '../../../packages/ui/src/utils/csv.js')).href;
const { parseCsv } = (await import(/* @vite-ignore */ csvReader)) as { parseCsv: (text: string, o?: { skipComments?: boolean }) => { headers: string[]; rows: Record<string, string>[] } };

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const post = (c: Ctx, p: string, b: unknown) => request(app).post(`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any);

let c: Ctx;
beforeAll(async () => {
  const email = `tpl.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Template Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  /* What the example rows name: the shift and the leave type. The person (E-001) comes in with the employees template itself. */
  await post(c, '/attendance/shifts', { name: 'General', startTime: '09:00', endTime: '18:00' }).expect(201);
  await post(c, '/attendance/leave/types', { name: 'Casual', annualDays: 12 }).expect(201);
}, 60_000);

/** The template as the screen gets it, read as the screen reads a file. */
async function fetched(kind: string) {
  const res = await request(app).get(`/api/orgs/${c.orgId}/import-templates/${kind}`).set(at(c)).expect(200);
  expect(res.headers['content-type']).toMatch(/text\/csv/);
  expect(res.headers['content-disposition']).toMatch(/attachment; filename="CLOR .* import template\.csv"/);
  return parseCsv(res.text, { skipComments: true });
}

describe('import templates', () => {
  it('carries the headings, one example row, and a note for every column', () => {
    for (const t of IMPORT_TEMPLATES) {
      const csv = templateCsv(t);
      expect(csv.startsWith('﻿')).toBe(true);
      const all = parseCsv(csv);
      /* Unfiltered, the first row is a note: the screens must ask for the notes to be left out. */
      expect(all.headers[0]).toMatch(/^# CLOR import template/);
      const read = parseCsv(csv, { skipComments: true });
      expect(read.headers).toEqual(t.columns.map((col) => col.key));
      expect(read.rows).toEqual([exampleRow(t)]);
      for (const col of t.columns) expect(csv).toContain(`# ${col.key} = ${col.label}${col.required ? ' (needed)' : ''}.`);
      expect(new Set(t.columns.map((col) => col.key)).size).toBe(t.columns.length);
    }
  });

  it('names only columns the employee importer reads', () => {
    const reads = new Set(Object.keys(importRow.shape));
    for (const col of importTemplate('employees')!.columns) expect(reads.has(col.key), col.key).toBe(true);
  });

  it('refuses a kind it does not have, and anyone not signed in', async () => {
    await request(app).get(`/api/orgs/${c.orgId}/import-templates/payslips`).set(at(c)).expect(404);
    await request(app).get(`/api/orgs/${c.orgId}/import-templates/employees`).expect(401);
  });

  /* Employees first, and for real: the other templates' example rows are about E-001. */
  it('employees: the example row imports, and a row without a name does not', async () => {
    const t = importTemplate('employees')!;
    const { headers, rows } = await fetched('employees');
    expect(headers).toEqual(t.columns.map((col) => col.key));
    const check = (await post(c, t.importer, { rows, dryRun: true }).expect(200)).body;
    expect(check).toMatchObject({ imported: 1, failed: 0 });
    const noName = (await post(c, t.importer, { rows: [{ ...rows[0], name: '' }], dryRun: true }).expect(200)).body;
    expect(noName).toMatchObject({ imported: 0, failed: 1 });
    const done = (await post(c, t.importer, { rows }).expect(200)).body;
    expect(done).toMatchObject({ imported: 1, failed: 0 });
    const list = (await request(app).get(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).expect(200)).body;
    const asha = (list.employees || list).find((e: any) => e.code === 'E-001');
    expect(asha).toMatchObject({ name: 'Asha Rao', department: 'Finance', designation: 'Accountant', gender: 'FEMALE', dateOfJoining: '2026-04-01' });
  });

  for (const kind of ['records', 'holidays', 'assignments', 'leaveBalances', 'leaveHistory', 'contractors']) {
    it(`${kind}: the example row is accepted, and each needed column is needed`, async () => {
      const t = importTemplate(kind)!;
      const { headers, rows } = await fetched(kind);
      expect(headers).toEqual(t.columns.map((col) => col.key));
      expect(rows).toHaveLength(1);
      const check = (await post(c, t.importer, { rows, dryRun: true }).expect(200)).body;
      expect(check, JSON.stringify(check.results)).toMatchObject({ dryRun: true, imported: 1, failed: 0 });
      for (const col of t.columns.filter((x) => x.required)) {
        const without = (await post(c, t.importer, { rows: [{ ...rows[0], [col.key]: '' }], dryRun: true }).expect(200)).body;
        expect(without, `${kind} without ${col.key}`).toMatchObject({ imported: 0, failed: 1 });
      }
    });
  }
});
