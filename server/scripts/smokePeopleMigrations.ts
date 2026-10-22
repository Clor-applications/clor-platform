/** A fresh deployment smoke test; only owns a disposable _test database. */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
const base = new URL(process.env.DATABASE_URL || '');
base.pathname = '/postgres'; base.search = '';
const dbName = `clor_migration_${process.pid}_test`;
const admin = new PrismaClient({ datasources: { db: { url: base.toString() } } });
await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
try {
  for (const [name, schema, file] of [
    ['DATABASE_URL', 'accounting', 'prisma/schema.prisma'],
    ['PAYROLL_DATABASE_URL', 'payroll', 'prisma/payroll/schema.prisma'],
    ['PEOPLE_DATABASE_URL', 'people', 'prisma/people/schema.prisma'],
    ['PLATFORM_DATABASE_URL', 'platform', 'prisma/platform/schema.prisma'],
  ]) {
    const url = new URL(base); url.pathname = `/${dbName}`; url.searchParams.set('schema', schema);
    process.env[name] = url.toString();
    execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', file], { env: process.env, stdio: 'inherit' });
  }
  process.env.DISABLE_RATE_LIMIT = 'true';
  const { buildApp } = await import('../src/app.js');
  const app = buildApp();
  const signup = await request(app).post('/api/auth/signup').send({ email: 'migration.qa@example.com', password: 'Passw0rd!23', name: 'Migration QA' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: 'Migration QA', state: 'Karnataka' }).expect(200);
  const orgId = setup.body.company.orgId;
  const headers = { Authorization: `Bearer ${signup.body.token}`, 'x-org-id': orgId, 'x-branch-id': setup.body.branch.id };
  await request(app).put(`/api/orgs/${orgId}/features`).set(headers).send({ features: { people: true, attendance: true } }).expect(200);
  await request(app).post(`/api/orgs/${orgId}/people/employees`).set(headers).send({ name: 'Migration employee', code: 'MIG-01' }).expect(201);
  await request(app).post(`/api/orgs/${orgId}/people/workspace/announcements`).set(headers).send({ title: 'Migration verified', status: 'PUBLISHED', details: { body: 'Real database write' } }).expect(201);
  await request(app).get(`/api/orgs/${orgId}/people/documents`).set(headers).expect(200);
  await request(app).get(`/api/orgs/${orgId}/attendance/leave/types`).set(headers).expect(200);
  console.log('PASS: fresh migrations → signup → company → employee → announcement → documents → leave.');
} finally {
  const clients = await Promise.all([import('../src/utils/prisma.js'), import('../src/utils/peoplePrisma.js'), import('../src/utils/payrollPrisma.js'), import('../src/utils/platformPrisma.js')]);
  await Promise.all([clients[0].prisma.$disconnect(), clients[1].peoplePrisma.$disconnect(), clients[2].payrollPrisma.$disconnect(), clients[3].platformPrisma.$disconnect()]);
  await admin.$executeRawUnsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`);
  await admin.$disconnect();
}
