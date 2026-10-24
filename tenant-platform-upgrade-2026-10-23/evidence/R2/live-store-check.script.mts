const { fileStore, keyFor } = await import(process.cwd() + '/src/services/fileStore.ts');
const s = fileStore();
const org = `livecheck-${Date.now()}`, other = `livecheck-other-${Date.now()}`;
const key = keyFor(org, 'employee-documents', 'probe');
const bytes = Buffer.from('%PDF-1.4\n% clor r2 live check\n%%EOF\n');
const out: Record<string, unknown> = { store: s?.name };
await s.put(org, key, bytes, 'application/pdf'); out.put = 'ok';
const got = await s.get(org, key); out.getSame = !!got && got.equals(bytes);
out.list = await s.list(org);
try { await s.get(other, key); out.crossCompany = 'ALLOWED (bad)'; } catch (e: any) { out.crossCompany = 'refused: ' + e.message; }
out.missing = await s.get(org, keyFor(org, 'employee-documents', 'nope'));
out.deleted = await s.deleteAll(org);
out.listAfter = await s.list(org);
console.log(JSON.stringify(out, null, 1));
