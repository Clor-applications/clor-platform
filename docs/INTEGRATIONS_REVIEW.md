# Integrations review — HR tools, reader vendors, customer-side SMTP / SSO / LDAP / NTP, advanced reports

18 Oct 2026. A review before building, as asked. Facts come from official documentation read this week and from the code as it stands; where a vendor's documentation is not public that is said, and no endpoint is guessed. Each section ends with a recommendation and a size (S = a day, M = two to four days, L = a week or more).

## 0. Where CLOR stands today

| Area | In the product now | Gap |
|---|---|---|
| Outbound API / webhooks | REST `/v1` with API keys, OpenAPI; webhooks for punch, correction.approved, leave.*, month.closed, employee.* with retries | No adapters that speak another tool's API |
| Inbound from readers | ADMS push (ZKTeco, eSSL, Biomax, Realtime, Identix, Mantra rebrands), Hikvision ISAPI pull, Dahua pull, Suprema BioStar 2 pull, generic HTTP push/pull with field mapping, CSV file import, e-Time Office cloud pull | Vendors with their own protocol (see §2) |
| Customer SMTP | Per-company SMTP (`EmailSetting`: host, port, user, encrypted password), platform SMTP as default | A test-send button and a clear screen (verify) |
| SSO | OIDC and SAML providers can be *configured* (`AuthProvider`) — the sign-in handshake was never built; status is literally `CONFIGURED_NOT_ACTIVE` | The actual login flow, JIT provisioning, domain routing |
| LDAP | Nothing | Needs an on-site agent or LDAPS exposed to the internet |
| Time sync | Each reader's clock offset is measured on every push and shown; nothing corrects it | Push the server time to the reader when drift exceeds a threshold (vendor section says how) |
| Reports | Attendance: daily, monthly summary, muster roll, late/early, absent, overtime, leave register, department monthly, reader health, enrolment. Payroll: register, statutory, variance, cost, filings, Form 16. Register and Calendar screens, Export centre | ClorTime had ~28 attendance reports; scheduling, pinning, charts |

ClorTime carried an HRMS adapter framework (ERPNext, Odoo, Horilla, generic webhook) and a note worth keeping: adapters for SAP SuccessFactors, Workday, BambooHR and Zoho People were written and **could not work**, because those APIs sit behind partner programmes, reviewed OAuth apps or paid tiers that an attendance product cannot satisfy on a customer's behalf. The list below is ranked with that in mind: openness first, then Indian SMB relevance.

## 1. HR-tool adapters

Legend — Emp: read the employee master · Att→: push attendance in · Leave←: pull leave · Pay→: push payroll inputs (LOP, OT).

### Ranked: build these, in this order

| # | Tool | India fit | API openness | What the adapter does | Customer enters |
|---|---|---|---|---|---|
| 1 | **greytHR** | Largest SMB base (~18–20k customers) | Attendance swipe push is **self-serve** (admin generates an API ID + RSA key). Core v2 reference not public. | Push every punch to `POST https://<domain>.greythr.com/v2/attendance/asca/swipes` (form-encoded, lines of `ISO-datetime,empcode,door,1|0`, SHA1-RSA signature, ≥10 s between batches). Employee pull only if the customer has core v2 credentials. | greytHR domain, API ID, private key (stored encrypted), optional core client id/secret |
| 2 | **Keka** | 8.5k+ SMB / mid-market | **Public docs** (developers.keka.com), self-serve keys, 50 req/min, outbound event triggers | Both ways: pull `hris/employees` and leave hourly; push punches to `POST https://{server}.a.keka.com/v1/logs` (`deviceId, attendanceNumber, timestamp, status`); receive Keka events for employee/leave changes | Tenant subdomain, server (`cin01`/`cin02`), client id/secret, API key, attendance `X-API-Key`, device id |
| 3 | **Zoho People (+ Zoho Payroll)** | Large SMB footprint | OAuth self-serve; daily quotas (5k–25k calls by plan); public docs | Push check-in/out via `POST /people/api/attendance/bulkImport` in ≤200-record batches; pull employees daily via Forms API; LOP days to Zoho Payroll pay run on `month.closed` | Zoho data centre (.in/.com), OAuth client id/secret, refresh token, Payroll organisation id |
| 4 | **Tally (TallyPrime)** | Ubiquitous SMB accounting | XML over HTTP on the customer's LAN (port 9000), no auth, no internet path | Monthly attendance vouchers per employee (Present / Absent / LOP / OT units) as XML — downloadable, or delivered by the on-site agent (phase 5). Idempotent via `REMOTEID` + `ACTION=Alter` | Tally host:port, company name, attendance-type mapping |
| 5 | **RazorpayX Payroll** | Startups / SMB | API reference **not public**; access granted by Razorpay support | Monthly LOP days per employee on `month.closed`; employee pull for mapping. Spec the endpoints only once the reference is in hand | API ID, API key, org id |
| 6 | **Darwinbox** | ~750 enterprises, not SMB | Docs not public (integrations@darwinbox.in); punch API is real | Push punches (`AttendancePunchesApi`), back-dated corrections on `correction.approved`; pull employees (last-modified) nightly | Subdomain, admin e-mail, secret key |

Also cheap and high-leverage: **SCIM 2.0 inbound** (`/scim/v2/Users`) so a customer's Microsoft Entra provisions CLOR users automatically (no Microsoft approval needed), and a **Google Workspace directory poll** for the same.

### Not now, and why

- **HROne, Pocket HRMS, Spine HR** — no public API documentation; Pocket has no REST API at all; Spine is on-prem. CSV import/export covers them until a vendor spec arrives.
- **SAP SuccessFactors, Workday, Oracle HCM, BambooHR** — real APIs but enterprise-tier and heavy configuration; India demand is MNC captives. A later "enterprise" tier if a customer asks.
- **Freshteam** — being retired (renewals stop March 2026). Do not build.

### How the adapters are built (one framework)

- One `HrAdapter` interface declaring capabilities (`employees`, `pushPunches`, `pushDays`, `leave`, `payrollInputs`) — the ClorTime lesson: an adapter that cannot do a thing says so, the sync skips it and the screen says why, rather than "success" with nothing moved.
- Each connection: adapter, encrypted credentials, mapping (CLOR employee ↔ their id), cadence, last run, last error, a ledger of what was sent (idempotency keys) so a retry never double-posts.
- Delivery rides the existing webhook-delivery queue (retries, back-off, resend).
- Screen: Attendance → System → Integrations → "Connect an HR tool": pick, enter credentials, map people, test, enable.

Size: framework M; greytHR S; Keka M; Zoho M; Tally S (XML) + on-site agent L (shared with LDAP, §3); SCIM M.

## 2. Reader vendors and protocols

### "Bio Park B100" — identified (high confidence)
A real product, not a typo: **Bio-Park B100** (fingerprint + RFID + password, 3,000 users, Wi-Fi "cloud sync", USB Excel export, ~₹5.5k), siblings B200 and the D02 face unit, sold by **Chiptronics Solutions, Vadodara — the company behind Team Office / e-Time Office**. No manual or protocol document exists publicly. Two plausible paths, both already in CLOR: it pushes to the e-Time Office cloud (our e-Time Office pull covers it), or it is a generic ZK-style clock with an ADMS "Cloud Server" menu (our ADMS push covers it). **Founder check**: open the device menu — if *Comm → Cloud Server Setting / ADMS* exists, point it at `api.clor.in/iclock` and it works today. (Biomax has no "N-B100"; drop that reading.)

### Vendor table

| Vendor | Families | Path into CLOR | Docs public? | Template sync? |
|---|---|---|---|---|
| ZKTeco / eSSL / Identix / most Indian rebrands | K30/K40, F22, iFace, uFace, SpeedFace, MB | **ADMS push — have it** | Dealer spec; well-known | Finger + face (BIODATA type 9), photo |
| **Matrix COSEC** | ARGO (face), Vega, Door V3, PVR, FMX, ARC DC200 | **COSEC Devices PUSH API**: device polls our server — `/login`, `/poll`, `/getcmd`, `/updatecmd`, `/getconfig`, `/updateconfig`, `/setevent` | **Yes — official PDF** | Card, finger, palm via Get/Set Credential; face enrolled on device |
| Hikvision | DS-K1T341/671/320/804 | ISAPI pull — have it; **ISAPI HTTP push** (`PUT /ISAPI/Event/notification/httpHosts`) makes it real-time | Partner portal + community | Users, faces (JPEG), fingerprints via ISAPI |
| Dahua | ASI/ASA series | CGI pull — have it; long-poll `snapManager.cgi` for live events | **Yes — official integration PDF** | Cards/users; face photo |
| Anviz | W1/W2 Pro, FacePass, CrossChex | **CrossChex Cloud API** (JSON envelope, token) + webhooks (support-enabled) | Inside the cloud portal + community | No (cloud holds attendance only) |
| Suprema (direct) | BioStation 2/3, FaceStation | **G-SDK** gRPC via a Device Gateway process | **Yes — GitHub** | Yes | 
| Realtime Biometrics | T-series, RS10 | Device "cloud push" (ADMS-like per integrators) | No spec | Unknown |
| Biomax | N-BM30W/60W/70W, N-K30, SpeedFace 5SE Lite | New N-series advertise push/cloud (likely ADMS); old BM30 proprietary TCP | BM30 manual only | If ADMS firmware, yes |
| Mantra | MFSTAB (AEBAS-locked), mBio, MINOP cloud | SDK or MINOP cloud API; MFSTAB no third-party | No | No |
| Secureye, Timewatch, CP Plus, Honeywell-India | fingerprint/face clocks | TCP/IP "cloud sync", protocol undisclosed; Cams dropped Secureye in 2023 | No | Unknown |
| FingerTec | Face ID, TA/TC | ZK-made; Webster/AWDMS push (iclock family), developer programme | Programme | Via SDK |
| Virdi, IDEMIA | AC-2100/7000; MorphoWave, SIGMA | Windows SDK / Thrift server behind partner portal | Partner-gated | Via SDK |

### Build next (in order)
1. **Matrix COSEC push driver** (M) — the one fully documented Indian vendor we lack. Device-initiated GETs with `device-type`, `serial-no`; events via `/setevent` (`seq-no`, `evt_id`, date/time fields, `field-1` = user id, `field-3` bit-field = entry/exit + credential). Dedupe on (serial, seq-no). Clock set via `/updateconfig config-id=1`. Users via `config-id=10`; finger/card/palm templates via Set Credential. Auth: user/password set on device (header form to confirm on hardware).
2. **Hikvision ISAPI push** (S) — register CLOR as an HTTP host on the terminal; parse the multipart `event_log` JSON (capture one real event before freezing field names); keep the pull as gap-fill. Time via `/ISAPI/System/time` and `/ntpServers`.
3. **Anviz CrossChex Cloud** (S) — token from the portal's CloudAPI page, `attendance.record/getrecord` pull with paging, webhook when Anviz enables developer mode. (Alternative: Suprema G-SDK — public, but needs a gateway process → on-site agent.)

### NTP / time sync — what the protocols allow
- **ADMS**: the device takes its clock from our handshake — local time = HTTP `Date` response header + `TimeZone` option; newer firmware reads **minutes** (`TimeZone=330` for IST), older hours. CLOR must send an accurate `Date` header on every `/iclock/*` reply and `TimeZone=330`. The explicit `SET OPTIONS TimeZone=…` then `SET OPTIONS DateTime=<packed>` command works on at least one firmware (device then fetches `/iclock/rtdata?type=time`, which we must answer) — treat as experimental, behind a per-reader switch. No native NTP on ZK clocks.
- **Matrix**: `config-id=1` sets the clock; device UI has NTP and a zone table (IST = index 48).
- **Hikvision**: NTP servers via ISAPI; digest auth fails if drift > 5 min — so fix the clock before anything else.
- **Dahua**: `global.cgi?action=setCurrentTime` (unverified).
- Plan: threshold (default 60 s) → vendor set-time command → reader-log line "clock corrected"; alert if it keeps drifting.

Not verifiable from official sources: Bio Park's protocol; Realtime, new Biomax, Secureye, Timewatch, Honeywell-India push formats; Hikvision push field names; ADMS DateTime on other firmware.

## 3. Customer-side set-up: SMTP, SSO, LDAP, NTP

### SMTP — already there; finish the edges (S)
Per-company SMTP exists with the password encrypted at rest and the platform's own transport as the default. To do: a "send a test mail" button, show which sender is in use, document SPF/DKIM for customers sending from their own domain, and a clear error when their server refuses us.

### SSO — the biggest real gap (L)
Providers can be configured but nobody can sign in with them. Build, in order:
1. **OIDC authorisation-code flow** with PKCE (`openid-client`): Google Workspace, Microsoft Entra, Okta, Keycloak all speak it. Discovery URL + client id/secret are already stored.
2. **Domain routing**: on the sign-in screen, an e-mail whose domain belongs to a configured provider is sent to that provider.
3. **Just-in-time provisioning** with the default role already on the provider record; existing users matched by e-mail.
4. **SAML 2.0** second, via `@node-saml/node-saml` — needed by some enterprises, rarer in SMB.
5. Policy: "SSO only" per company (local passwords off) once it works.

### LDAP / Active Directory — not as a cloud call (M, after the agent)
A cloud SaaS cannot bind to a customer's domain controller unless they expose LDAPS to the internet, which almost none will. The sane shape is the **on-site connector agent** (integration phase 5): a small service on their network that syncs AD users and groups to CLOR over HTTPS, and — for the same agent — pulls LAN-only readers and pushes Tally vouchers. Recommendation: LDAP rides the agent; do not build a direct LDAP bind in the API.

### NTP / time sync (S)
CLOR already knows each reader's drift. Add: a company threshold (default 60 s); when exceeded, queue the vendor's set-time command (ADMS details in §2) and alert if it keeps drifting; show "clock corrected" in the reader log. The CLOR server itself runs on Cloud Run, which is NTP-disciplined — nothing to do there. Phone punches use server time already.

## 4. Advanced reports (M)

Gap against ClorTime's 28 plus what customers ask for:
- **Daily**: first & last punch, missed in/out (open days), scheduled vs actual, daily status board.
- **Monthly**: time card per person (every punch, worked, late, OT by day), work-duration bands, status summary, OT summary, attendance sheet (P/A/L grid — the Register already does this).
- **People**: birthdays and anniversaries, probation ending, contracts expiring, documents expiring (now that documents exist).
- **Readers**: punch counts per reader per day, mobile punches with site and selfie flag.
- **Mechanics**: every report gets *schedule and e-mail* (weekly muster to the owner; uses the SMTP above), *saved filters*, *pin to Reports home*, PDF via the existing print page, and a few charts on the overview (late trend, absence by department).

## 5. Recommended order and sizes

1. SSO (OIDC first) — L. Unblocks enterprise and Google-Workspace SMBs alike; the config half already exists.
2. HR adapter framework + greytHR + Keka — M+S+M. Two biggest open SMB APIs.
3. Matrix COSEC push (M), Hikvision push (S), Anviz cloud (S) + clock correction (S). Bio Park B100: a device-menu check, no code.
   - **Done 18 Oct 2026 — Matrix COSEC push** (`server/src/routes/matrix.ts`, driver `MATRIX_COSEC`): login/poll/getcmd/updatecmd/getconfig/updateconfig/setevent; punches from events 101/105 with field-3 bits; other events to the reader log; Restart and user-count commands; clock set automatically when drift ≥ 60 s (and on "Set the time"). ADMS gained a "Set the time" command (`SET OPTIONS DateTime=<packed>`). Not yet tried on hardware — marked so on the Readers screen. Users / credentials (config-id 10, Set Credential) not built: enrol at the controller.
   - **Done 18 Oct 2026 — Hikvision push** (`server/src/routes/hikvisionPush.ts`, driver `HIKVISION_PUSH`): the terminal's HTTP-listening POST (multipart `event_log` JSON + `Picture`, or plain JSON) at `/hikvision/<token>`; sub-events 1/38/75 with `employeeNoString` → punches (direction from `attendanceStatus`, verify from `currentVerifyMode`), failures and door events → reader log, heartbeats → last seen; the last event is viewable on the reader's page so other firmware's field names show up. Field names from public receivers (DS-K1T341A/343), not tried here. **Anviz CrossChex Cloud** (`services/attendance/pull/anviz.ts`, driver `ANVIZ_CLOUD`): one-endpoint JSON API (`authorize.token/token` with api_key/api_secret, `attendance.record/getrecord` paged by 100), region us/ap/eu, token reused until it expires and renewed once on TOKEN_EXPIRES, requests spaced 15 s (the service's limit per public clients); `checktype` not trusted for in/out (connection direction decides). Shape from public clients (horilla, crosschexcloudapi), not the official PDF.
4. Zoho People/Payroll, Tally XML, SCIM inbound — M, S, M.
5. Advanced reports + scheduled e-mail — M.
6. On-site agent (LAN readers, LDAP/AD, Tally delivery) — L. Then LDAP sync on it — M.
7. SAML, RazorpayX (when the reference arrives), Darwinbox (enterprise) — later.

Decisions needed from the founder: (a) confirm the order, or move reports up; (b) whether to pursue greytHR core-v2 and RazorpayX credentials now (both need a request to the vendor); (c) agree that LDAP waits for the on-site agent rather than a direct bind.
