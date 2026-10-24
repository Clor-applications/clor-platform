# Current Architecture Baseline

## Source-observed layers

- Public hosts and shells: Accounting, Payroll, Attendance and People are named in the shell catalog; marketing and platform hosts exist separately.
- One Express application mounts user auth, SSO, tenant product routes, employee portal, billing operator routes, external API, device ingress, SCIM, public share/pay routes, and agent routes.
- Platform middleware authenticates JWT/session state, resolves organization membership, validates branch/warehouse access, and establishes the tenant database context.
- Four generated Prisma clients exist: Accounting, Platform, People and Payroll.
- Background schedulers run in the same Node process as the HTTP server.
- Source deployment definitions include Render, Docker Compose, Google Cloud Build and GitHub Actions. Source presence does not prove the currently deployed path.

## Trust boundaries requiring separate evidence

| Boundary | Source evidence | Current confidence | Missing proof |
|---|---|---|---|
| Cloudflare to API | edge secret middleware and proxy build files | Medium | Live DNS, Worker routes, secret binding, bypass test |
| Browser/mobile to API | CORS allowlist, JWT/session checks | Medium | Live origin list and mobile release behavior |
| User to organization | membership-derived tenant middleware | High in source | Full negative role matrix against deployed data |
| API to databases | four Prisma clients and RLS wrapper | High in source | Physical database separation, applied policies, runtime role privileges |
| Employee portal to tenant | dedicated portal auth and tenant scope | Medium | Cross-company portal tests and session revocation evidence |
| Devices/agents/API keys | route-specific credentials | Medium | Credential rotation, tenant binding, replay and disable tests |
| Schedulers to tenant data | leases and service-specific filters | Low/Medium | Exhaustive job query audit and multi-instance runtime evidence |
| Object/file storage | code references and private storage intent | Low | Bucket policy, tenant keying, signed URL and malware controls |

## Route inventory result

The generated inventory found 662 declared HTTP endpoints:

- 551 routes inherit normal human authentication plus tenant context.
- 18 routes are on known non-human/token ingress mounts.
- 2 routes are normal authenticated global routes.
- 2 routes are public token routes.
- 89 routes require manual classification because their routers intentionally mix login, SSO, portal, public API, share, billing, or conditional guards.

The inventory is a discovery tool. A route is not approved merely because a middleware name was detected.

