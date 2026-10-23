# Data deletion: former employees and closed companies

Decided by the founder on 21 Oct 2026 (tracker LX-07). This is what CLOR does
today. Use it to explain the behaviour to a client, and as the basis for the
terms-and-conditions clauses at the end, which a lawyer should review before
they are published.

CLOR processes personal data on behalf of each client company. The company is
the Data Fiduciary under the DPDP Act 2023; CLOR is its Data Processor.

---

## 1. When a former employee asks for their data to be erased

**Who can do it:** someone in the company allowed to delete employees.
**Where:** Attendance → Settings → Privacy → Data Requests. An erasure request
from the employee portal shows **Anonymise…**.

**Conditions**
- Only for someone recorded as having left (status LEFT). A current
  employee's data is still needed for their attendance and pay.
- The person's name must be typed to confirm.
- It happens once and cannot be undone.

**Erased immediately**
- Phone numbers, personal and work email
- Home address, emergency contact, guardian
- Date of birth, gender, marital status, photo
- HR notes and tags
- Reader PIN, card number and reader password; portal sign-in
- Fingerprint and face templates held by CLOR
- Punch selfies, phone-punch locations, failed phone-punch logs, sign-in IP addresses
- Uploaded documents other than contracts (offer, appointment, relieving letters) and payslips

**Kept, because labour, tax and PF law require the employer to keep them**
- Name and employee code
- Joining and leaving dates, department and designation
- Attendance days and punch times, leave and overtime
- Payroll, salary slips, PAN, UAN, PF and ESI numbers, bank details in past payments
- Contracts and payslips

**Retention periods for what is kept** (configurable)

| Records | Kept for |
|---|---|
| Payroll, tax (TDS / Form 16) and PF records | 8 years after the financial year |
| Attendance registers and records | 3 years |

When the period ends, these records are deleted too. (The scheduled deletion
of expired records is the next part of LX-07.)

**Afterwards**
- The employee's request is marked done, with this answer shown in their portal:
  *"Your personal data was erased on [date]. The law makes us keep your name,
  employee code, dates of employment, attendance and pay records for a fixed
  period; they are deleted when it ends."*
- The action is recorded in the company's audit log (who, when, what was erased).

**Limit:** fingerprints and faces already copied onto physical readers stay on
the reader until the person is removed from each reader. The screen says so.

---

## 2. When a company closes its CLOR account

**Who can do it:** an administrator of the whole company, with a fresh code
from their authenticator app to ask for the closure (any such administrator may
cancel it). Being the person who created the company is not what decides it.
**Where:** Company admin → Data → Close company.

**Steps**
1. **Full export first.** The owner downloads a full export of the company
   (every record, one file). A closure can only be requested within 24 hours
   of a full export.
2. **Request.** The owner types the company's name to confirm, and may give a reason.
3. **Notice period: 30 days.** The company keeps working normally. The owner
   can cancel at any time during the 30 days; nothing is then deleted.
4. **Deletion.** After 30 days, CLOR deletes every record of the company, in
   every app and database: accounting, invoices, payroll, attendance,
   employees, users' access to the company, roles, settings, notifications
   and the company's audit log. **Nothing is kept and nothing can be
   recovered.**

**What CLOR keeps after deletion:** only a closure record: company name, who
asked, when it was asked, when it was deleted, and how many records were
deleted. It contains no employee or business data.

**What is not deleted:** people's own CLOR sign-in (email and password), since
a person may also belong to other companies. Their access to the closed
company is removed.

**When it was the account's last company:** the account's subscription is
cancelled at once and the payment provider is told to stop charging; the
account's plan is closed. CLOR keeps its own billing records (its invoices and
payments to the customer) as its tax law requires. The company's code (for
example KAVE-C100) is never given to another company, so old links never open
somebody else's books.

**Backups:** CLOR's database backups (point-in-time recovery) roll over after
7 days, so the company's data leaves the backups within 7 days of deletion.

**Statutory records after closure are the company's responsibility.** Labour,
tax and PF law may require the business to keep payroll, tax and attendance
records for years. After closure, the company's copy is its export. CLOR, as
processor, returns the data (the export) and then deletes it, as the DPDP Act
expects of a processor when the service ends.

**Audit trail of the process:** the full export, the closure request and any
cancellation are recorded in the company's audit log until the deletion. The
closure record remains after it.

---

## 3. Recycle bin (deleted by mistake)

Added 21 Oct 2026 at the founder's request.

**Where:** Attendance → Settings → Audit & Recovery → Recycle Bin.

- When someone deletes an employee, a note or document, a department,
  designation, location, contractor, shift, shift assignment, schedule,
  rotation, holiday, leave type or an attendance day, CLOR keeps a copy in the
  recycle bin for **30 days**.
- Anyone allowed to delete that kind of item can **restore** it (it comes back
  exactly as it was, with an employee's notes, documents and tags, and the
  people who reported to them) or **delete it for good** sooner.
- After 30 days it is deleted for good automatically.
- Restores and deletions for good are recorded in the audit log.
- Readers (biometric devices) are not kept in the bin: removing one changes the
  device itself.

**Effect on erasure and closure**
- Anonymising a former employee (section 1) also deletes their notes and
  documents waiting in the recycle bin at once.
- Closing a company (section 2) deletes its recycle bin with everything else.
- Otherwise a deleted item can stay up to 30 days before it is gone for good.
  Tell a client this when they ask how soon a deletion is final.

> **Draft clause: deleted items.** Items you delete in CLOR are kept in a
> recycle bin for 30 days, so they can be restored if deleted by mistake, and
> are then permanently deleted. You can permanently delete an item from the
> recycle bin sooner.

---

## 4. Settings (for whoever runs CLOR)

| Setting | Default | What it does |
|---|---|---|
| `COMPANY_CLOSURE_NOTICE_DAYS` | 30 | Notice period before a closed company is deleted |
| `COMPANY_CLOSURE_PURGE` | on | `off` stops the daily deletion job (closures stay scheduled) |
| `RECYCLE_BIN_DAYS` | 30 | Days a deleted item stays in the recycle bin |
| `RECYCLE_BIN_PURGE` | on | `off` stops the daily removal of expired recycle-bin items |

The deletion job runs once a day on the API server. Code:
`server/src/services/companyClosure.ts`, `server/src/services/anonymiseEmployee.ts`,
`server/src/services/recycleBin.ts`.

---

## 5. Draft clauses for the Terms and Conditions (for legal review)

> **Closing your account.** The account owner may close the company's CLOR
> account from Settings. Before closing, the owner must download a full export
> of the company's data. The account stays active for 30 days after the
> request, during which the owner may cancel the closure. After 30 days, CLOR
> permanently deletes all of the company's data from its systems, and from its
> backups within a further 7 days. Deleted data cannot be recovered.

> **Your records after closure.** You are responsible for keeping any records
> that the law requires your business to retain (for example payroll, tax,
> provident fund and attendance records). CLOR does not keep them after your
> account is deleted. Your export is your copy.

> **Requests by your employees.** When a former employee asks for their
> personal data to be erased, you can do so from CLOR. CLOR erases their
> personal details and keeps only the employment, attendance and pay records
> that the law requires you to keep, for the periods set out in our data
> retention notice, after which they are deleted.

> **What we keep.** After deleting your company, CLOR keeps only a record that
> the closure happened (company name, who requested it and when, and the date
> of deletion), to show that your data was deleted as you asked.
