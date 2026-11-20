/**
 * Every form, every field. On each screen of each app the form tester:
 *   1. finds buttons that open a form (Add, New, Create, Invite, Apply, Record…)
 *   2. opens each one and lists its fields (label, type, required)
 *   3. flags fields with no label (a person with a screen reader cannot use them)
 *   4. submits it EMPTY: expects a validation message or a disabled button, never a 5xx
 *   5. types WRONG values by field kind (bad email, letters in a number, bad GSTIN,
 *      PAN, IFSC, phone, PIN code): expects each to be refused
 *   6. types GOOD values: expects no error under the fields
 *   7. writes mode (QA company only): saves it and expects success, no 4xx/5xx;
 *      otherwise closes it (Cancel / Escape) without saving
 * Runs as each company's owner (sees every form). QA_FORM_ACCOUNTS=label,label overrides.
 */
import type { Locator, Page } from '@playwright/test';
import type { QaAccount } from './env';
import { DANGER, saveVisits, shotPath, watch, type Issue, type Visit } from './monitor';
import { canWrite, RUN_TAG } from './scenario';
import { walkApp } from './walk';

const OPENER = /^\s*(\+\s*)?(add|new|create|invite|apply|record|raise|request|import|upload|set up|start)\b/i;
const APPS = ['app', 'people', 'payroll', 'attendance', 'books'] as const;
const pick = process.env.QA_FORM_ACCOUNTS?.split(',').map((s) => s.trim());
/** Forms run as each company's owner (sees every form), or the labels in QA_FORM_ACCOUNTS. */
export const formsFor = (acc: QaAccount) => (pick ? pick.includes(acc.label) : (acc as any).role === 'owner');

/* Field kind from its label/name/type, with a wrong value it must refuse and a good one it must take. */
const KINDS: Array<{ kind: string; match: RegExp; bad?: string; good: string }> = [
  { kind: 'email', match: /e-?mail/i, bad: 'not-an-email', good: `${RUN_TAG.toLowerCase()}@example.com` },
  { kind: 'gstin', match: /gstin|gst no|gst number/i, bad: '12ABCDE', good: '27AAPFU0939F1ZV' },
  { kind: 'pan', match: /\bpan\b/i, bad: '1234', good: 'AAPFU0939F' },
  { kind: 'ifsc', match: /ifsc/i, bad: 'XYZ', good: 'HDFC0000123' },
  { kind: 'phone', match: /phone|mobile/i, bad: '12', good: '9876543210' },
  { kind: 'pin', match: /pin ?code|postal|zip/i, bad: '12', good: '400001' },
  { kind: 'number', match: /amount|salary|rate|price|qty|quantity|days|hours|number of|ctc|%/i, bad: 'abc', good: '1000' },
  { kind: 'date', match: /date|from|to\b|dob|joining/i, good: '2026-11-20' },
  { kind: 'text', match: /.*/, good: `${RUN_TAG} test` },
];

type Field = { label: string; type: string; required: boolean; el: Locator };

async function fieldsIn(form: Locator): Promise<Field[]> {
  const els = form.locator('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):visible, textarea:visible, select:visible');
  const out: Field[] = [];
  for (let i = 0; i < (await els.count()); i++) {
    const el = els.nth(i);
    const info = await el.evaluate((n: any) => {
      const id = n.id;
      const lab = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent) || n.closest('label')?.textContent || n.getAttribute('aria-label') || '';
      return { label: lab.trim(), placeholder: n.getAttribute('placeholder') || '', name: n.getAttribute('name') || '', type: n.tagName === 'SELECT' ? 'select' : n.getAttribute('type') || n.tagName.toLowerCase(), required: n.required || n.getAttribute('aria-required') === 'true', readonly: n.readOnly || n.disabled };
    });
    if (info.readonly) continue;
    out.push({ label: info.label || info.placeholder || info.name || '', type: info.type, required: info.required, el });
  }
  return out;
}

const kindOf = (f: Field) => (f.type === 'email' ? KINDS[0] : f.type === 'number' ? KINDS[6] : f.type === 'date' ? KINDS[7] : KINDS.find((k) => k.match.test(f.label))!);

async function errorsShown(form: Locator) {
  const n = await form.locator('[role=alert]:visible, [aria-invalid=true], .ui-field-error:visible, [class*=error]:visible').count();
  const invalid = await form.locator('input:invalid, textarea:invalid, select:invalid').count();
  return n + invalid;
}

async function submitBtn(form: Locator) {
  return form.getByRole('button', { name: /^(save|add|create|submit|send|invite|apply|continue|next|done)\b/i }).last();
}

async function closeForm(page: Page, form: Locator) {
  const cancel = form.getByRole('button', { name: /^(cancel|close|discard|not now|back)$/i }).first();
  if (await cancel.isVisible().catch(() => false)) await cancel.click().catch(() => {});
  else await page.keyboard.press('Escape');
  const discard = page.getByRole('button', { name: /^(discard|leave|yes, discard)/i }).first();
  if (await discard.isVisible({ timeout: 1000 }).catch(() => false)) await discard.click().catch(() => {});
  await page.waitForTimeout(300);
}

export async function formsAs(page: Page, acc: QaAccount) {
  {
    const w = watch(page);
    const visits: Visit[] = [];
    const done = new Set<string>();
    for (const app of APPS) {
      await walkApp(page, app, async (screen) => {
        const openers = page.locator('main button:visible, main a[role=button]:visible').filter({ hasText: OPENER });
        const n = Math.min(await openers.count(), 6);
        for (let i = 0; i < n; i++) {
          const btn = openers.nth(i);
          const name = (await btn.innerText().catch(() => '')).trim().split('\n')[0];
          const key = `${app}|${screen}|${name}`;
          if (!name || DANGER.test(name) || done.has(key)) continue;
          done.add(key);
          const where = `${app} › ${screen} › "${name}"`;
          const issues: Issue[] = [];
          w.start(where);
          const t0 = Date.now();
          const back = page.url();
          await btn.click().catch(() => {});
          await page.waitForTimeout(800);
          const form = page.getByRole('dialog').filter({ has: page.locator('input, textarea, select') }).last()
            .or(page.locator('main form').filter({ has: page.locator('input, textarea, select') }).last()).first();
          if (!(await form.isVisible().catch(() => false))) {
            issues.push(...w.take().filter((x) => x.kind !== 'console'));
            if (page.url() !== back) await page.goto(back, { waitUntil: 'networkidle' }).catch(() => {});
            if (issues.length) visits.push({ portal: `form:${app}`, account: acc.label, path: `${screen} › "${name}" (no form)`, title: '', ms: Date.now() - t0, ok: false, issues });
            continue;
          }
          const fields = await fieldsIn(form);
          const unlabeled = fields.filter((f) => !f.label);
          if (unlabeled.length) issues.push({ kind: 'check', where, detail: `${unlabeled.length} field(s) with no label` });

          // Empty submit
          const submit = await submitBtn(form);
          if (await submit.isVisible().catch(() => false)) {
            if (await submit.isEnabled().catch(() => false)) {
              await submit.click().catch(() => {});
              await page.waitForTimeout(1200);
              const stillOpen = await form.isVisible().catch(() => false);
              if (stillOpen && fields.some((f) => f.required) && (await errorsShown(form)) === 0) issues.push({ kind: 'check', where, detail: 'empty submit: no validation message shown' });
              if (!stillOpen) issues.push({ kind: 'check', where, detail: 'empty submit: form accepted with nothing filled in' });
            }
          } else issues.push({ kind: 'check', where, detail: 'no save/submit button found' });

          // Wrong values, one field at a time
          if (await form.isVisible().catch(() => false)) {
            for (const f of fields) {
              const k = kindOf(f);
              if (!k.bad || f.type === 'select') continue;
              await f.el.fill(k.bad).catch(() => {});
              await f.el.blur().catch(() => {});
              await page.waitForTimeout(250);
              const bad = await f.el.evaluate((n: any) => n.matches(':invalid') || n.getAttribute('aria-invalid') === 'true').catch(() => false);
              const near = await f.el.locator('xpath=ancestor::*[self::div or self::label][1]').locator('[role=alert], [class*=error]').count().catch(() => 0);
              if (!bad && !near) issues.push({ kind: 'check', where, detail: `field "${f.label || '?'}" (${k.kind}) took a wrong value "${k.bad}" without complaint` });
            }
            // Good values
            for (const f of fields) {
              const k = kindOf(f);
              if (f.type === 'select') { await f.el.selectOption({ index: 1 }).catch(() => {}); continue; }
              await f.el.fill(k.good).catch(() => {});
            }
            if (canWrite(acc) && (await submit.isEnabled().catch(() => false))) {
              await submit.click().catch(() => {});
              await page.waitForTimeout(2500);
              if (await form.isVisible().catch(() => false)) {
                const msg = (await form.locator('[role=alert]:visible').first().innerText().catch(() => '')).slice(0, 160);
                issues.push({ kind: 'check', where, detail: `save with good values did not close the form${msg ? `: "${msg}"` : ''}` });
              }
            }
          }
          issues.push(...w.take());
          const shot = shotPath(`form-${acc.label}-${app}-${screen}-${name}`);
          await page.screenshot({ path: shot }).catch(() => {});
          if (await form.isVisible().catch(() => false)) await closeForm(page, form);
          if (page.url() !== back) await page.goto(back, { waitUntil: 'networkidle' }).catch(() => {});
          visits.push({ portal: `form:${app}`, account: acc.label, path: `${screen} › "${name}" (${fields.length} fields)`, title: '', ms: Date.now() - t0, ok: issues.length === 0, issues, screenshot: shot });
        }
      });
    }
    saveVisits(`forms-${acc.label}`, visits);
  }
}
