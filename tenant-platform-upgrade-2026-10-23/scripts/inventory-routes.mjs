import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const src = path.join(root, 'server/src');
const appFile = path.join(src, 'app.ts');
const routeDir = path.join(src, 'routes');
const out = path.resolve(import.meta.dirname, '..', 'evidence/route-inventory.csv');

const app = fs.readFileSync(appFile, 'utf8');
const imports = new Map();
for (const match of app.matchAll(/import\s+\{([^}]+)\}\s+from\s+'\.\/routes\/([^']+)\.js'/g)) {
  for (const name of match[1].split(',').map((part) => part.trim().split(/\s+as\s+/).at(-1)).filter(Boolean)) {
    imports.set(name, `${match[2]}.ts`);
  }
}

const mounts = new Map();
for (const match of app.matchAll(/app\.use\(\s*'([^']+)'\s*,[\s\S]{0,500}?\b([A-Za-z][A-Za-z0-9]*Router)\b\s*[,)]/g)) {
  if (imports.has(match[2])) mounts.set(match[2], match[1]);
}

const csv = [['method', 'mount', 'path', 'full_path', 'router', 'source', 'line', 'declared_guards', 'classification']];
for (const file of fs.readdirSync(routeDir).filter((name) => name.endsWith('.ts')).sort()) {
  const body = fs.readFileSync(path.join(routeDir, file), 'utf8');
  const routerNames = [...body.matchAll(/export\s+const\s+([A-Za-z][A-Za-z0-9]*Router)\s*=\s*Router\(\)/g)].map((m) => m[1]);
  for (const router of routerNames) {
    const mount = mounts.get(router) ?? '(not-mounted-directly)';
    const escaped = router.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}\\.(get|post|put|patch|delete)\\(\\s*([\\\`'\"])(.*?)\\2`, 'gs');
    const firstRoute = body.search(new RegExp(`${escaped}\\.(?:get|post|put|patch|delete)\\(`));
    const setup = firstRoute < 0 ? body : body.slice(0, firstRoute);
    const routerUse = [...setup.matchAll(new RegExp(`${escaped}\\.use\\(([^;]+)\\);`, 'gs'))].map((m) => m[1]).join(' ');
    for (const match of body.matchAll(re)) {
      const method = match[1].toUpperCase();
      const routePath = match[3];
      const line = body.slice(0, match.index).split('\n').length;
      const callEnd = body.indexOf('async', match.index);
      const declared = body.slice(match.index, callEnd === -1 ? match.index + 700 : Math.min(callEnd, match.index + 1400));
      const guards = [...new Set((`${routerUse} ${declared}`.match(/requireAuth|requireTenantContext|requirePlatformOperator|requirePortalAuth|requireApiKey|can\([^)]*\)|[A-Z][A-Z_]+_(?:VIEW|EDIT|APPROVE)/g) ?? []))].join(' | ');
      const full = mount === '/' ? routePath : `${mount.replace(/\/$/, '')}/${routePath.replace(/^\//, '')}`;
      let classification = 'REVIEW';
      if (guards.includes('requirePortalAuth')) classification = 'EMPLOYEE_PORTAL';
      else if (guards.includes('requirePlatformOperator')) classification = 'PLATFORM_OPERATOR';
      else if (guards.includes('requireAuth') && guards.includes('requireTenantContext')) classification = 'HUMAN_TENANT';
      else if (guards.includes('requireAuth')) classification = 'HUMAN_GLOBAL';
      else if (['/iclock', '/ingest', '/matrix', '/hikvision', '/scim/v2', '/agent/v1', '/v1'].includes(mount)) classification = 'NON_HUMAN_OR_TOKEN';
      else if (['/pay'].includes(mount)) classification = 'PUBLIC_TOKEN';
      csv.push([method, mount, routePath, full, router, `server/src/routes/${file}`, String(line), guards, classification]);
    }
  }
}

const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${csv.map((row) => row.map(quote).join(',')).join('\n')}\n`);
const counts = csv.slice(1).reduce((acc, row) => {
  acc[row[8]] = (acc[row[8]] ?? 0) + 1;
  return acc;
}, {});
console.log(JSON.stringify({ output: path.relative(root, out), routes: csv.length - 1, classifications: counts }, null, 2));
