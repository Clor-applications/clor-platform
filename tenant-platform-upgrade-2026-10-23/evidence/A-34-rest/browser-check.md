# A-34 webhooks — browser check (2026-10-24, local dev, web :5173 → API :4002 as clor_app)

Local test company made for this check (generated credentials in the session scratchpad, not here),
with one webhook "HRMS sync" → https://example.com/clor-hook.

Attendance → Integrations → Webhooks:
1. Row shows Deliveries · Send test · **New secret** · Delete. Help text now describes
   `X-Clor-Signature-256: t=…,v1=…` (HMAC of `t.body`, check t within five minutes) and says the
   body-only `X-Clor-Signature` is still sent for receivers set up before.
2. New secret → confirm dialog "New signing secret for HRMS sync?" explaining both secrets are signed
   with for a day. First pass: the confirm button was red (danger tone) though nothing is destroyed — fixed
   to the primary tone.
3. Confirm → the shown-once panel: "New signing secret for “HRMS sync” — the old one works until
   10/25/2026, 12:41:21 PM — shown once. Copy it now; CLOR keeps it encrypted to sign with and does not
   show it again." with Copy / I have copied it.
   First pass found two faults, both fixed and re-checked:
   - the panel opened at the top of the page while the person was scrolled down at the webhook list
     (nothing visible happened) — ShownOnce now scrolls itself into view;
   - it said "CLOR keeps only a hash", untrue for a webhook secret (it must be replayed to sign) —
     ShownOnce takes a `kept` sentence; webhooks pass the encrypted wording; hashed tokens keep theirs.
4. Company audit trail (fetched from the page): two rows "ROTATE_SECRET / ATTENDANCE_INTEGRATION",
   no `whsec_` anywhere in them. After this check the rows read "Changed a webhook’s signing secret"
   (named phrase added; asserted in credentialLeftovers.test.ts).
