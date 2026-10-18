# CLOR on-site connector

A single Node file that runs inside a customer's network and does what the
cloud cannot reach: pulls LAN-only readers, posts Tally vouchers to Tally's
HTTP port, and syncs Active Directory / LDAP users into CLOR over SCIM.

Built with `npm run agent:build` (esbuild bundles `agent/src` together with
the cloud's own pull drivers from `src/services/attendance/pull`), served by
the API at `GET /agent/v1/download`, and run as:

    node clor-agent.cjs --install --token clora_…   # registers a service (systemd / launchd / Task Scheduler), token kept in clor-agent.json
    node clor-agent.cjs --token clora_… --once      # one round, for trying it

It updates itself from `/agent/v1/download` when CLOR reports a newer version (`--no-update` to stop that).

Everything it talks to is under `/agent/v1` (server/src/routes/agent.ts). It
keeps `clor-agent.json` beside itself: the SCIM token it was handed once, and
the e-mails of people it created (the only ones it may ever switch off).
