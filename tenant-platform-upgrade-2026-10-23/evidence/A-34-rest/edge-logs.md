# A-34 — tokens in URL paths and edge logs (Batch 11, 2026-10-24)

## Which routes carry a token in the path
Found with a route grep (`server/src/routes`), five:

| Route | Who calls it | Can it move to a header? |
|---|---|---|
| `GET /api/public/invoice/:token` | a customer's browser (reminder link) | no: it is a link |
| `GET/POST /pay/:token[/claim]` | a customer's browser (UPI page) | no: it is a link |
| `POST /ingest/:token` | generic HTTP push from a reader vendor | vendor-configured URL |
| `ANY /matrix/:token/...` | Matrix COSEC readers | device firmware sets only the URL |
| `POST /hikvision/:token` | Hikvision terminals | device firmware sets only the URL |

## What the app writes down
Before: `safeUrl` (access log, Error Reporting context) took out only the share-link token.
After: all five are logged as `/<prefix>/[token]` (`credentialLeftovers.test.ts`, path-tokens-before/after.txt).
Note: `/pay`, `/ingest`, `/matrix`, `/hikvision` are mounted before the access log, so they reach
only the error reporter today; both now redact them.

## What the edge writes down (read-only inspection, Cloudflare connector)
- Worker `clor-api-proxy` (source read from the account): forwards the request, sets X-Forwarded-*,
  replaces `x-clor-edge`; no `console.*`, no cache API, no bindings.
- `deploy/cloudflare/api-proxy/wrangler.toml`: no `[observability]` block, so Workers Logs are off
  unless switched on in the dashboard (not visible to this connector — owner to confirm).
- Cloudflare HTTP analytics / Security events record request paths for the zone. Not readable here.
- Cloud Run's request log (`httpRequest.requestUrl`) records the full path for every request. The
  app cannot redact it.

## So
Path tokens still reach Cloud Run's request log and Cloudflare analytics. What limits the harm:
the tokens are stored only as hashes, are in the credential registry (pause / rotate / revoke,
Batch 5), and links expire (A-32). Owner actions (LIVE, not doable from code):
1. Confirm Workers Logs stay off for `clor-api-proxy`, or add `[observability] enabled = false`.
2. Restrict who can read Cloud Run request logs (Logs Viewer on the project), or add a log
   exclusion / sink that drops `httpRequest.requestUrl` for the five prefixes.
