# Incident response — CLOR's own incidents

**Status: draft for the founder to approve (20 Oct 2026). Not legal advice; check the current text of the CERT-In Directions and the DPDP Rules before relying on the timelines below.**

This covers incidents in CLOR's own systems: the API on Cloud Run, the databases on Cloud SQL, the web app and marketing site on Cloudflare, the Android apps, email through Brevo, and the people who can reach them. A breach inside a customer's own company (a manager misusing data) is the customer's to handle in its breach register (Attendance → Personnel → Data protection); CLOR helps when asked.

## Who decides

| Role | Who | Backup |
|---|---|---|
| Incident lead (decides, reports, signs off) | Founder | — (name a second person before the first paying customer) |
| Technical lead (contains, investigates, restores) | Founder / engineer on duty | — |
| Customer contact | Founder | — |

Keep phone numbers and the CERT-In / Board portal logins in `Clor-Business`, not in this repository.

## Clocks that start when CLOR learns of an incident

| Who | What | When |
|---|---|---|
| CERT-In | Report the incident (CERT-In Directions of 28 Apr 2022, types in its Annexure I: unauthorised access, data breach or leak, malware or ransomware, compromise of a server or application, DoS, and others) | **Within 6 hours** of noticing it, by e-mail to `incident@cert-in.org.in` or the form on cert-in.org.in. Send what is known; update later. |
| Each affected customer (the Data Fiduciary for its employees' and its business data) | Tell them what happened, what data, what CLOR has done, what they should do | **Without delay** — same day. They owe their own notices under the DPDP Act. |
| Data Protection Board of India | Intimation, then a detailed report (DPDP Rules 2025) | Where CLOR is itself the Data Fiduciary (its own users' account data): intimation without delay, detailed report within 72 hours. For customer data, support the customer's report. |
| Affected people | Plain-language notice: what, likely consequences, what is being done, what they can do, who to contact | Without delay (by the Data Fiduciary). |

## The first hour

1. **Write down** the time noticed, who noticed, and what was seen. Start an incident note in `Clor-Business/incidents/<date>.md`; every later step is logged there with the time.
2. **Contain** without destroying evidence:
   - suspected credential leak → rotate the secret in Secret Manager (`JWT_SECRET`, `DB_PASSWORD`, `SMTP_PASS`, `MAIL_SECRET_KEY`, `EDGE_SECRET`), deploy, and revoke sessions;
   - suspected compromised account → disable the user and revoke all sessions;
   - suspected compromised revision → shift traffic back to the last good revision (`gcloud run services update-traffic clor-api --to-revisions <rev>=100`);
   - abuse from one source → block at Cloudflare.
3. **Preserve**: export the relevant Cloud Logging entries and Cloudflare logs; do not delete or reset anything that holds evidence. Logs are kept 30 days today — export early (LX-05 raises this to 180 days in India).
4. **Decide** with the incident lead whether it is reportable. When unsure, report: an early CERT-In report that turns out minor costs little; a missed one does not.

## Within 6 hours

- Send the CERT-In report (what is known, systems affected, time noticed, actions taken, contact).
- Tell affected customers by e-mail and phone (template below).

## Within 72 hours

- Root cause found or a working hypothesis written down.
- Detailed report to the Board where CLOR is the Data Fiduciary; supporting facts to customers for their reports.
- Fix deployed, or the risk contained with a dated plan.

## Afterwards

- Write up: timeline, cause, what data, who was told and when, what changes (add each to `CLOR_PLATFORM_FIXES.xlsx`).
- Keep the incident note, exported logs and copies of every notice for at least one year.

## Customer notice template

> Subject: Security incident affecting your CLOR account — <date>
>
> On <date and time IST> we found <what happened, in one sentence>. It affected <which data: e.g. employee names and attendance days for your company> between <from> and <to>. <Not affected: e.g. passwords, which are stored hashed, and bank details.>
>
> What we have done: <contained, rotated keys, fixed, reported to CERT-In on <time>>.
>
> What you should do: <e.g. ask staff to reset portal passwords; nothing>. As the Data Fiduciary for your employees' data, you may need to notify the Data Protection Board and the people affected; we will give you the facts you need for that.
>
> Contact: <name, e-mail, phone>. We will update you by <time>.

## Practice

Run this once before the first paying customer (a tabletop: "a laptop with a Secret Manager session was stolen"), and after any change of hosting. Record the date here.

| Date | Exercise | Gaps found |
|---|---|---|
| — | — | — |
