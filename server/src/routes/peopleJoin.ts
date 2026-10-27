import { Router, type Request, type Response } from 'express';
import { enterTenant } from '../utils/tenantScope.js';
import { InviteError, expireIfDue, findInviteByToken, joinerView, submitInvite } from '../services/people/lifecycle/invites.js';
import { OfferError, acceptOffer, declineOffer, findOfferByToken, offerPdf, offerView } from '../services/people/offers.js';

/**
 * The joiner's link (docs/people/02-PRD.md LIFE-01). No sign-in: the token
 * is looked up outside any company, then the invite's own company is
 * entered. GET shows a plain form (or JSON when asked for); POST sends the
 * details once. The page carries the joiner's own name and joining date and
 * nothing else about the company's people.
 */
export const peopleJoinRouter = Router();

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const shell = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>` +
  `<style>body{font-family:Inter,system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;color:#18181b;line-height:1.5}h1{font-size:1.25rem}label{display:block;margin:.75rem 0 .25rem;font-size:.875rem;font-weight:600}input,select,textarea{width:100%;padding:.5rem;border:1px solid #d4d4d8;border-radius:4px;font:inherit}button{margin-top:1rem;padding:.6rem 1rem;border:0;border-radius:4px;background:#a45761;color:#fff;font:inherit;font-weight:600;cursor:pointer}.muted{color:#52525b;font-size:.875rem}.row{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.doc{display:grid;grid-template-columns:9rem 1fr 1fr;gap:.5rem;margin-top:.5rem}.nom{display:grid;grid-template-columns:1.4fr 1fr .8fr 1fr;gap:.5rem;margin-top:.5rem}#msg{margin-top:1rem;font-weight:600}</style>` +
  `<body>${body}</body>`;
const said = (title: string, text: string, ok: boolean) => shell(title, `<h1>${ok ? '✓ ' : ''}${esc(title)}</h1><p class="muted">${esc(text)}</p>`);

/* The page's own script, served as a file: the app's content-security policy allows no inline script. */
const JOIN_PAGE_JS = String.raw`const f=document.getElementById('join');const msg=document.getElementById('msg');
const read=(file)=>new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>no(new Error('Could not read '+file.name));r.readAsDataURL(file)});
f.addEventListener('submit',async(e)=>{e.preventDefault();msg.textContent='Sending…';
const fd=new FormData(f);const fields={};for(const [k,v] of fd.entries()){if(!k.startsWith('doc-')&&!k.startsWith('st-')&&!k.startsWith('nom-')&&k!=='accurate'&&k!=='policiesRead'&&typeof v==='string')fields[k]=v;}
const statutory={};for(const k of ['pan','uan','esicNumber','bankAccountName','bankAccountNumber','bankIfsc','bankName']){const v=fd.get('st-'+k);if(v)statutory[k]=v;}
statutory.nominees=[];for(let i=0;i<3;i++){const name=fd.get('nom-name-'+i);if(name)statutory.nominees.push({name,relation:fd.get('nom-relation-'+i),sharePercent:Number(fd.get('nom-share-'+i)||0),dateOfBirth:fd.get('nom-dob-'+i)||null});}
const documents=[];for(let i=0;i<4;i++){const file=fd.get('doc-file-'+i);if(file&&file.size){documents.push({kind:fd.get('doc-kind-'+i),title:fd.get('doc-title-'+i)||file.name.replace(/\.[^.]+$/,''),mime:file.type,data:await read(file)});}}
const r=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fields,statutory,documents,declarations:{accurate:fd.get('accurate')==='on',policiesRead:fd.get('policiesRead')==='on'}})});
const j=await r.json().catch(()=>({}));if(r.ok){f.innerHTML='<h2 style="font-size:1rem">✓ Sent to HR</h2><p class="muted">Thank you. HR checks your details before they go on your record. This link no longer works.</p>';}else{msg.textContent=j.error||'Not sent. Try again.';}});
`;

peopleJoinRouter.get('/people/join-page.js', (_req, res) => {
  res.type('application/javascript').set('Cache-Control', 'public, max-age=3600').send(JOIN_PAGE_JS);
});

peopleJoinRouter.get('/people/join/:token', async (req, res) => {
  const found = await findInviteByToken(String(req.params.token || ''));
  const wantsJson = req.accepts(['html', 'json']) === 'json' || req.query.format === 'json';
  if (!found) return wantsJson ? res.status(404).json({ error: 'This link does not work.' }) : res.status(404).type('html').send(said('This link does not work', 'It may be wrong or too old. Ask HR for a new one.', false));
  enterTenant(found.orgId);
  const invite = await expireIfDue(found);
  if (invite.status === 'EXPIRED') return wantsJson ? res.status(410).json({ error: 'This link has run out.', status: 'EXPIRED' }) : res.status(410).type('html').send(said('This link has run out', 'Invites work for fourteen days. Ask HR for a new one.', false));
  if (invite.status === 'RETURNED' || invite.status === 'CHECKED') return wantsJson ? res.status(410).json({ error: 'These details were already sent.', status: invite.status }) : res.status(410).type('html').send(said('Already sent', 'Your details are with HR. They will be in touch if anything is missing.', true));
  const view = await joinerView(invite);
  if (wantsJson) return res.json(view);
  const field = (k: string, label: string, type = 'text', extra = '') => `<label for="f-${k}">${esc(label)}</label><input id="f-${k}" name="${k}" type="${type}" ${extra}>`;
  const select = (k: string, label: string, options: string[]) => `<label for="f-${k}">${esc(label)}</label><select id="f-${k}" name="${k}"><option value="">—</option>${options.map((o) => `<option value="${o}">${o[0] + o.slice(1).toLowerCase()}</option>`).join('')}</select>`;
  const kindLabel: Record<string, string> = { ID_PROOF: 'ID proof', ADDRESS_PROOF: 'Address proof', EDUCATION: 'Education', CERTIFICATE: 'Certificate', OTHER: 'Other' };
  const docRow = (i: number) => `<div class="doc"><select name="doc-kind-${i}">${view.documentKinds.map((k) => `<option value="${k}">${kindLabel[k] || k}</option>`).join('')}</select><input name="doc-title-${i}" placeholder="Title, e.g. Aadhaar"><input name="doc-file-${i}" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"></div>`;
  const relationLabel = (r: string) => r[0] + r.slice(1).toLowerCase();
  const nomineeRow = (i: number) => `<div class="nom"><input name="nom-name-${i}" placeholder="Name" aria-label="Nominee ${i + 1} name"><select name="nom-relation-${i}" aria-label="Nominee ${i + 1} relation">${view.statutory.nomineeRelations.map((r) => `<option value="${r}">${relationLabel(r)}</option>`).join('')}</select><input name="nom-share-${i}" type="number" min="1" max="100" step="0.01" placeholder="Share %" aria-label="Nominee ${i + 1} share"><input name="nom-dob-${i}" type="date" aria-label="Nominee ${i + 1} date of birth"></div>`;
  const body = `<h1>Welcome to ${esc(view.orgName)}, ${esc(view.name)}</h1>
<p class="muted">${view.designation ? `${esc(view.designation)} · ` : ''}${view.dateOfJoining ? `joining ${esc(view.dateOfJoining)} · ` : ''}this link works once and runs out on ${esc(view.expiresAt.toISOString().slice(0, 10))}. You see only your own details.</p>
${view.message ? `<p><strong>From HR:</strong> ${esc(view.message)}</p>` : ''}
<form id="join">
<h2 style="font-size:1rem">Your details</h2>
<div class="row">${field('personalEmail', 'Personal email', 'email')}${field('phone', 'Phone', 'tel')}</div>
<div class="row">${field('dateOfBirth', 'Date of birth', 'date')}${select('gender', 'Gender', ['MALE', 'FEMALE', 'NON_BINARY', 'OTHER', 'PREFER_NOT_TO_SAY'])}</div>
<div class="row">${select('maritalStatus', 'Marital status', ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'])}${field('guardianName', 'Father’s / guardian’s name')}</div>
${field('addressLine', 'Address')}
<div class="row">${field('city', 'City')}${field('state', 'State')}</div>
<div class="row">${field('pincode', 'PIN code', 'text', 'inputmode="numeric" pattern="[0-9]{6}"')}${field('country', 'Country', 'text', 'value="India"')}</div>
<h2 style="font-size:1rem;margin-top:1.5rem">Emergency contact</h2>
<div class="row">${field('emergencyContactName', 'Name')}${field('emergencyContactPhone', 'Phone', 'tel')}</div>
${field('emergencyContactRelation', 'Relation')}
<h2 style="font-size:1rem;margin-top:1.5rem">For your pay: PAN, PF, ESI and bank</h2>
<p class="muted">HR checks these before they go to payroll. Leave UAN or ESIC blank if you have none yet.</p>
<div class="row">${field('st-pan', 'PAN', 'text', 'maxlength="10" autocapitalize="characters" placeholder="ABCDE1234F"')}${field('st-uan', 'UAN (PF)', 'text', 'inputmode="numeric" maxlength="12"')}</div>
${field('st-esicNumber', 'ESIC number', 'text', 'inputmode="numeric" maxlength="17"')}
<div class="row">${field('st-bankAccountName', 'Name on the bank account')}${field('st-bankName', 'Bank')}</div>
<div class="row">${field('st-bankAccountNumber', 'Account number', 'text', 'inputmode="numeric" maxlength="18"')}${field('st-bankIfsc', 'IFSC', 'text', 'maxlength="11" autocapitalize="characters" placeholder="HDFC0001234"')}</div>
<h2 style="font-size:1rem;margin-top:1.5rem">PF nominee</h2>
<p class="muted">Who receives your PF if something happens to you (Form 2). Shares add up to 100%.</p>
${[0, 1, 2].map(nomineeRow).join('')}
<h2 style="font-size:1rem;margin-top:1.5rem">Documents</h2>
<p class="muted">ID proof, address proof, education certificates. PDF or image, up to 5 MB each.</p>
${[0, 1, 2, 3].map(docRow).join('')}
<h2 style="font-size:1rem;margin-top:1.5rem">Declarations</h2>
<label style="font-weight:400"><input type="checkbox" name="accurate" style="width:auto;margin-right:.5rem">The details above are true and complete.</label>
<label style="font-weight:400"><input type="checkbox" name="policiesRead" style="width:auto;margin-right:.5rem">I have read the policies HR sent me.</label>
<button type="submit">Send to HR</button>
<p id="msg" class="muted"></p>
</form>
<script src="/api/people/join-page.js"></script>`;
  res.type('html').send(shell(`Welcome to ${view.orgName}`, body));
});

peopleJoinRouter.post('/people/join/:token', async (req, res) => {
  const found = await findInviteByToken(String(req.params.token || ''));
  if (!found) return res.status(404).json({ error: 'This link does not work.' });
  enterTenant(found.orgId);
  const invite = await expireIfDue(found);
  try {
    const r = await submitInvite(invite, req.body && typeof req.body === 'object' ? req.body : {});
    res.json({ status: r.status, returnedAt: r.returnedAt });
  } catch (e) {
    if (e instanceof InviteError) return res.status(e.status).json({ error: e.message });
    console.error('[people-join]', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

/* ---------------------------------------------------------------- the offer link (HR-VIEW gap 5; services/people/offers.ts) */

const OFFER_PAGE_JS = String.raw`const box=document.getElementById('offer-actions');const msg=document.getElementById('msg');
const send=async(what)=>{msg.textContent='Sending…';const r=await fetch(location.pathname+'/'+what,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const j=await r.json().catch(()=>({}));
if(r.ok){box.innerHTML=what==='accept'?'<h2 style="font-size:1rem">✓ Offer accepted</h2><p class="muted">Thank you. The company has been told, and will be in touch about joining.</p>':'<h2 style="font-size:1rem">Offer declined</h2><p class="muted">The company has been told.</p>';}else{msg.textContent=j.error||'Not sent. Try again.';}};
document.getElementById('accept').addEventListener('click',()=>send('accept'));
document.getElementById('decline').addEventListener('click',()=>{if(confirm('Decline this offer?'))send('decline');});
`;

peopleJoinRouter.get('/people/offer-page.js', (_req, res) => {
  res.type('application/javascript').set('Cache-Control', 'public, max-age=3600').send(OFFER_PAGE_JS);
});

/* Each handler enters the offer's company itself: enterTenant binds the caller's own async context. */
peopleJoinRouter.get('/people/offer/:token', async (req, res) => {
  const offer = await findOfferByToken(String(req.params.token || ''));
  if (offer) enterTenant(offer.orgId);
  const wantsJson = req.accepts(['html', 'json']) === 'json' || req.query.format === 'json';
  if (!offer) return wantsJson ? res.status(404).json({ error: 'This link does not work.' }) : res.status(404).type('html').send(said('This link does not work', 'It may be wrong or too old. Ask the company for a new one.', false));
  const view = await offerView(offer);
  if (wantsJson) return res.json(view);
  const state =
    view.status === 'ACCEPTED' ? `<h2 style="font-size:1rem">✓ You accepted this offer${view.acceptedAt ? ` on ${esc(view.acceptedAt.toISOString().slice(0, 10))}` : ''}</h2>`
    : view.status === 'SENT' ? `<button type="button" id="accept">Accept the offer</button> <button type="button" id="decline" style="background:#fff;color:#18181b;border:1px solid #d4d4d8">Decline</button><p id="msg" class="muted"></p><script src="/api/people/offer-page.js"></script>`
    : `<p class="muted">This offer is no longer open${view.status === 'EXPIRED' ? ': it ran out' : view.status === 'DECLINED' ? ': you declined it' : ''}. Ask the company if you have questions.</p>`;
  const body = `<h1>Your offer from ${esc(view.orgName)}</h1>
<p class="muted">${esc(view.designation)} · open until ${esc(view.acceptBy)} · <a href="${esc(req.params.token)}/pdf">Download as PDF</a></p>
<pre style="white-space:pre-wrap;font:inherit;border:1px solid #e4e4e7;border-radius:12px;padding:1rem">${esc(view.letter)}</pre>
<div id="offer-actions">${state}</div>`;
  res.type('html').send(shell(`Your offer from ${view.orgName}`, body));
});

peopleJoinRouter.get('/people/offer/:token/pdf', async (req, res) => {
  const offer = await findOfferByToken(String(req.params.token || ''));
  if (offer) enterTenant(offer.orgId);
  if (!offer) return res.status(404).json({ error: 'This link does not work.' });
  res.type('application/pdf').set('Content-Disposition', 'attachment; filename="offer-letter.pdf"').set('Cache-Control', 'private, no-store').send(offerPdf(offer));
});

const answerOffer = (action: 'accept' | 'decline') => async (req: Request, res: Response) => {
  const offer = await findOfferByToken(String(req.params.token || ''));
  if (offer) enterTenant(offer.orgId);
  if (!offer) return res.status(404).json({ error: 'This link does not work.' });
  try {
    res.json(action === 'accept' ? await acceptOffer(offer, req.ip || null) : await declineOffer(offer));
  } catch (e) {
    if (e instanceof OfferError) return res.status(e.status).json({ error: e.message });
    console.error('[people-offer]', e instanceof Error ? e.message : e);
    res.status(500).json({ error: 'Something went wrong.' });
  }
};
peopleJoinRouter.post('/people/offer/:token/accept', answerOffer('accept'));
peopleJoinRouter.post('/people/offer/:token/decline', answerOffer('decline'));
