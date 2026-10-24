import { Router } from 'express';
import { enterTenant } from '../utils/tenantScope.js';
import { InviteError, expireIfDue, findInviteByToken, joinerView, submitInvite } from '../services/people/lifecycle/invites.js';

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
  `<style>body{font-family:Inter,system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;color:#18181b;line-height:1.5}h1{font-size:1.25rem}label{display:block;margin:.75rem 0 .25rem;font-size:.875rem;font-weight:600}input,select,textarea{width:100%;padding:.5rem;border:1px solid #d4d4d8;border-radius:4px;font:inherit}button{margin-top:1rem;padding:.6rem 1rem;border:0;border-radius:4px;background:#a45761;color:#fff;font:inherit;font-weight:600;cursor:pointer}.muted{color:#52525b;font-size:.875rem}.row{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.doc{display:grid;grid-template-columns:9rem 1fr 1fr;gap:.5rem;margin-top:.5rem}#msg{margin-top:1rem;font-weight:600}</style>` +
  `<body>${body}</body>`;
const said = (title: string, text: string, ok: boolean) => shell(title, `<h1>${ok ? '✓ ' : ''}${esc(title)}</h1><p class="muted">${esc(text)}</p>`);

/* The page's own script, served as a file: the app's content-security policy allows no inline script. */
const JOIN_PAGE_JS = String.raw`const f=document.getElementById('join');const msg=document.getElementById('msg');
const read=(file)=>new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>no(new Error('Could not read '+file.name));r.readAsDataURL(file)});
f.addEventListener('submit',async(e)=>{e.preventDefault();msg.textContent='Sending…';
const fd=new FormData(f);const fields={};for(const [k,v] of fd.entries()){if(!k.startsWith('doc-')&&k!=='accurate'&&k!=='policiesRead'&&typeof v==='string')fields[k]=v;}
const documents=[];for(let i=0;i<4;i++){const file=fd.get('doc-file-'+i);if(file&&file.size){documents.push({kind:fd.get('doc-kind-'+i),title:fd.get('doc-title-'+i)||file.name.replace(/\.[^.]+$/,''),mime:file.type,data:await read(file)});}}
const r=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fields,documents,declarations:{accurate:fd.get('accurate')==='on',policiesRead:fd.get('policiesRead')==='on'}})});
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
  const body = `<h1>Welcome to ${esc(view.orgName)}, ${esc(view.name)}</h1>
<p class="muted">${view.designation ? `${esc(view.designation)} · ` : ''}${view.dateOfJoining ? `joining ${esc(view.dateOfJoining)} · ` : ''}this link works once and runs out on ${esc(view.expiresAt.toISOString().slice(0, 10))}. You see only your own details.</p>
${view.message ? `<p><strong>From HR:</strong> ${esc(view.message)}</p>` : ''}
<form id="join">
<h2 style="font-size:1rem">Your details</h2>
<div class="row">${field('personalEmail', 'Personal email', 'email')}${field('phone', 'Phone', 'tel')}</div>
<div class="row">${field('dateOfBirth', 'Date of birth', 'date')}${select('gender', 'Gender', ['MALE', 'FEMALE', 'OTHER'])}</div>
<div class="row">${select('maritalStatus', 'Marital status', ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'])}${field('guardianName', 'Father’s / guardian’s name')}</div>
${field('addressLine', 'Address')}
<div class="row">${field('city', 'City')}${field('state', 'State')}</div>
<div class="row">${field('pincode', 'PIN code', 'text', 'inputmode="numeric" pattern="[0-9]{6}"')}${field('country', 'Country', 'text', 'value="India"')}</div>
<h2 style="font-size:1rem;margin-top:1.5rem">Emergency contact</h2>
<div class="row">${field('emergencyContactName', 'Name')}${field('emergencyContactPhone', 'Phone', 'tel')}</div>
${field('emergencyContactRelation', 'Relation')}
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
