# A-39 browser check (local dev, 2026-10-24)

A03 Test Traders. "Advance Taker A39" created in People (no payroll profile), then a ₹5,000 salary advance recorded for them in Payroll.

People → Employees → Advance Taker A39 → Delete → "Yes, delete": `DELETE /api/orgs/<A03>/people/employees/<id>` → **409** `EMPLOYEE_IN_PAYROLL`, "This person is in payroll. Mark them as having left instead of deleting their file." (`browser-people-delete-refused.jpg`). The file and the advance stay.

Before the fix the People delete checked only a payroll profile and payslips, so this person would have been binned and the advance left pointing at nobody (`before-fix-people.txt`: 200 where 409 expected). The Payroll API delete (no screen calls it) is covered by `payrollEmployeeDelete.test.ts` (before: an employee with a loan was deleted, and their statutory config was orphaned).

Seen in passing (not this change): the employee drawer's title is cut to "A." at phone width.
