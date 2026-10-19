# CLOR on-site connector

A single Node file that runs inside a customer's network and does what the
cloud cannot reach: pulls LAN-only readers, posts Tally vouchers to Tally's
HTTP port, and syncs Active Directory / LDAP users into CLOR over SCIM.

Built with `npm run agent:build` (esbuild bundles `agent/src` together with
the cloud's own pull drivers from `src/services/attendance/pull`), served by
the API at `GET /agent/v1/download`, and run as:

    node clor-agent.cjs --install --token clora_…   # registers a service (systemd / launchd / Task Scheduler), token kept in clor-agent.json
    node clor-agent.cjs --token clora_… --once      # one round, for trying it

It updates itself from `/agent/v1/download` when CLOR reports a newer version (`--no-update` to stop that),
and only to a file whose Ed25519 signature (`/agent/v1/download.sig`, made by
`npm run agent:sign`, see DEPLOY.md) checks out against the public key in
`agent/src/signing.ts`; otherwise it logs why and keeps running what it has.

Punches CLOR cannot take when they are read (no internet, a timeout, 5xx,
429) go into `clor-agent-spool.jsonl` beside the state file and are sent again,
oldest first, at the start of every round (`agent/src/spool.ts`; at most 50,000
lines or 20 MB, oldest dropped first). While CLOR cannot be reached at all,
the readers are still read from the last work list it gave.

Everything it talks to is under `/agent/v1` (server/src/routes/agent.ts). It
keeps `clor-agent.json` beside itself: the SCIM token it was handed once, and
the e-mails of people it created (the only ones it may ever switch off).
