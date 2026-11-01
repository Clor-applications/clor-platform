import React, { useState } from 'react';
import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { sendAppAccess } from './api';
import { escapeHtml as esc } from '@ui/utils/html';

/*
 * "Send employee app access" (HR-VIEW gap 3), from the directory's bulk bar
 * or one record's More menu. People with an e-mail get their one-time code
 * by e-mail and HR never sees it; people with only a phone get a code shown
 * here once, to print or share on WhatsApp. Closing this throws the codes
 * away: sending again makes new ones.
 */

/* The server's own words for when the codes stop (India's time), so this, the sheet and the WhatsApp text agree. */
const untilWords = (result) => result.expiresWords || new Date(result.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

/** One slip per person, to cut and hand over. Black on white: it is a printed document. */
function printSheet(result) {
  const slips = result.sent.filter((s) => s.channel === 'PRINT');
  const until = untilWords(result);
  const html = `<!doctype html><meta charset="utf-8"><title>Employee app codes</title><style>body{font-family:Inter,system-ui,sans-serif;color:#000;background:#fff;margin:24px}.slip{border:1px dashed #000;padding:16px;margin-bottom:16px;break-inside:avoid}h2{font-size:16px;margin:0 0 8px}dl{display:grid;grid-template-columns:10rem 1fr;gap:4px;margin:0}dt{font-weight:600}dd{margin:0;font-variant-numeric:tabular-nums}p{font-size:12px;margin:8px 0 0}</style>${slips.map((s) => `<div class="slip"><h2>${esc(s.name)}</h2><dl><dt>Open</dt><dd>${esc(result.portalUrl)}</dd><dt>Company code</dt><dd>${esc(result.company.code)}</dd><dt>Employee code</dt><dd>${esc(s.employeeCode)}</dd><dt>Activation code</dt><dd>${esc(s.activationCode)}</dd></dl><p>Choose "First time? Activate", enter these and choose your own password. The code works once, until ${esc(until)}.</p></div>`).join('')}`;
  const w = window.open('', '_blank');
  if (!w) return notify.error('The browser blocked the sheet. Allow pop-ups for CLOR and try again.');
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
  return undefined;
}

export default function AppAccessSend({ people, onClose }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const send = async () => {
    setBusy(true);
    try {
      setResult(await sendAppAccess(people.map((p) => p.id)));
    } catch (e) {
      notify.error(String(e?.message || 'Not sent.'));
    } finally {
      setBusy(false);
    }
  };
  const emailed = result?.sent.filter((s) => s.channel === 'EMAIL') || [];
  const handed = result?.sent.filter((s) => s.channel === 'PRINT') || [];
  const title = people.length === 1 ? `Employee app access for ${people[0].name}` : `Employee app access for ${people.length} people`;
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(40rem,96vw)]" title={title}
      footer={result
        ? <>{handed.length ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => printSheet(result)}>Print codes</button> : null}<button type="button" className="ui-btn ui-btn-primary" onClick={onClose}>Done</button></>
        : <><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send access'}</button></>}>
      {!result ? (
        <div className="space-y-3 text-sm">
          <p>Each person gets a one-time activation code for the employee app. It works for a day; with it they choose their own password.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>With an e-mail on file: sent by e-mail. You will not see the code.</li>
            <li>With only a phone: the code is shown here once, to print or send on WhatsApp.</li>
            <li>A new code replaces any code not used yet. A password they already chose keeps working until they use the new code.</li>
          </ul>
        </div>
      ) : (
        <div className="space-y-6">
          {emailed.length ? (
            <section aria-label="Sent by e-mail">
              <h3 className="ui-t-sec">Sent by e-mail <span className="ui-caption tabular-nums">{emailed.length}</span></h3>
              <ul className="divide-y text-sm">{emailed.map((s) => <li key={s.employeeId} className="flex justify-between gap-3 py-2"><span>{s.name}</span><span className="ui-muted">{s.sentTo}</span></li>)}</ul>
            </section>
          ) : null}
          {handed.length ? (
            <section aria-label="To hand over">
              <h3 className="ui-t-sec">To hand over <span className="ui-caption tabular-nums">{handed.length}</span></h3>
              <p className="ui-caption">These codes are shown only now. Print them or send them on WhatsApp before you close this. Company code <span className="tabular-nums">{result.company.code}</span>; they work until {untilWords(result)}.</p>
              <ul className="divide-y text-sm">
                {handed.map((s) => (
                  <li key={s.employeeId} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">{s.name} <span className="ui-muted tabular-nums">({s.employeeCode})</span>{s.phoneEnding ? <span className="block ui-caption">Phone ending <span className="tabular-nums">{s.phoneEnding}</span></span> : null}</span>
                    <span className="font-semibold tabular-nums" aria-label={`Activation code for ${s.name}`}>{s.activationCode}</span>
                    {s.whatsappUrl ? <a className="ui-btn ui-btn-secondary ui-btn-sm" href={s.whatsappUrl} target="_blank" rel="noreferrer">Send on WhatsApp</a> : <span className="ui-caption">No number for WhatsApp</span>}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {result.skipped.length ? (
            <section aria-label="Not sent">
              <h3 className="ui-t-sec">Not sent <span className="ui-caption tabular-nums">{result.skipped.length}</span></h3>
              <ul className="divide-y text-sm">{result.skipped.map((s) => <li key={s.employeeId} className="flex justify-between gap-3 py-2"><span>{s.name || 'Someone'}</span><span className="ui-muted">{s.reason}</span></li>)}</ul>
            </section>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
