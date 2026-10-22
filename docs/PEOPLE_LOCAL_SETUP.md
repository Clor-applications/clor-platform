# People: local setup

Requires Node 22+, npm, and a running local PostgreSQL server with `psql` and
`createdb` on PATH. For an existing server or password-protected database,
configure `server/.env` from `server/.env.example` first.

```
npm install
npm --prefix server install
npm run setup:local
npm run dev
```

`setup:local` preserves an existing environment file, creates `clor_local` only
when needed, generates all four Prisma clients, and applies every migration.
The apps use separate PostgreSQL schemas: accounting, payroll, people, platform.
The Vite proxy reads PORT from server/.env; VITE_API_PROXY_TARGET overrides it.
Open http://127.0.0.1:5173, create an account and company, and enable People.

Do not use the old SQLite URLs or push just the accounting schema. The running
application requires all four datasources. Existing nonempty databases created
with `db push` need an operator-reviewed migration baseline, not a reset.

New People register permissions are explicit resources in Settings → Roles.
New company Owners receive them at setup. Existing Owners must be topped up with
the existing owner-permission deployment script; existing custom roles must be
reviewed and granted the resources they actually need.

The local verification environment for the 22 October repair is a separate
`clor_people_dev` database. Its generated secrets are only in ignored server/.env.
