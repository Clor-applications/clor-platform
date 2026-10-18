/**
 * Tally Prime / ERP 9 import XML for a payroll journal. The file goes in with
 * Gateway of Tally → Import Data → Vouchers (or an on-site agent posting it to
 * Tally's HTTP port later). Ledger names must exist in the Tally company by
 * the same name; Tally refuses the voucher otherwise, saying which.
 *
 * Tally's sign convention: a debit is a negative AMOUNT with ISDEEMEDPOSITIVE
 * Yes; a credit is positive with No.
 */
export type TallyLine = { ledgerName: string; debit: number; credit: number; description?: string };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
/** "2026-10-31" → "20261031", the form Tally takes. */
export const tallyDate = (iso: string) => iso.replace(/-/g, '').slice(0, 8);

export function tallyJournalXml(opts: { date: string; voucherNumber: string; narration: string; lines: TallyLine[]; companyName?: string; voucherType?: string }) {
  const type = opts.voucherType || 'Journal';
  const entries = opts.lines
    .filter((l) => l.debit > 0 || l.credit > 0)
    .map((l) => {
      const debit = l.debit > 0;
      const amount = debit ? -l.debit : l.credit;
      return `      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${esc(l.ledgerName)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>${debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
        <AMOUNT>${money(amount)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`;
    })
    .join('\n');
  const company = opts.companyName ? `\n      <STATICVARIABLES>\n        <SVCURRENTCOMPANY>${esc(opts.companyName)}</SVCURRENTCOMPANY>\n      </STATICVARIABLES>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>${company}
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="${esc(type)}" ACTION="Create" OBJVIEW="Accounting Voucher View">
            <DATE>${tallyDate(opts.date)}</DATE>
            <EFFECTIVEDATE>${tallyDate(opts.date)}</EFFECTIVEDATE>
            <VOUCHERTYPENAME>${esc(type)}</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${esc(opts.voucherNumber)}</VOUCHERNUMBER>
            <NARRATION>${esc(opts.narration)}</NARRATION>
            <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
${entries}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;
}
