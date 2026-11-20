import type { Page } from '@playwright/test';
import { SITES, writeCompanies, writesAllowed, type QaAccount } from './env';
import { renderIssues, shotPath, watch, type Issue, type Visit } from './monitor';

/**
 * A scenario is a real-world story told as steps. Each step is run and recorded
 * on its own (soft): one failing step is reported and the story goes on, so one
 * run shows every broken step, not only the first.
 */
export type Ctx = { page: Page; acc: QaAccount; site: typeof SITES; tag: string; open: (app: keyof typeof SITES, ...path: string[]) => Promise<void> };
export type Step = { name: string; write?: boolean; run: (c: Ctx) => Promise<void> };
export type Scenario = { id: string; title: string; who: string[]; steps: Step[] };

export const RUN_TAG = `QA-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6)}`;

/** Writes only with QA_LIVE_WRITES=1 and in a company listed in QA_WRITE_COMPANIES. */
export function canWrite(acc: QaAccount) {
  return writesAllowed && !!acc.company && writeCompanies.includes(acc.company.toLowerCase());
}

/** Opens an app, then clicks through rail module and panel screen by visible name. */
export function opener(page: Page) {
  return async (app: keyof typeof SITES, ...path: string[]) => {
    if (!page.url().startsWith(SITES[app])) await page.goto(SITES[app] + '/', { waitUntil: 'networkidle' });
    for (const name of path) {
      const re = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      const target = page.locator('nav button, nav a').filter({ hasText: re }).first();
      await target.click({ timeout: 10_000 });
      await page.waitForLoadState('networkidle').catch(() => {});
    }
  };
}

export async function runSteps(scn: Scenario, page: Page, acc: QaAccount): Promise<Visit[]> {
  const w = watch(page);
  const out: Visit[] = [];
  const ctx: Ctx = { page, acc, site: SITES, tag: RUN_TAG, open: opener(page) };
  for (const step of scn.steps) {
    const where = `${scn.id} ${step.name}`;
    if (step.write && !canWrite(acc)) {
      out.push({ portal: 'scenario', account: acc.label, path: where, title: 'skipped (writes off)', ms: 0, ok: true, issues: [] });
      continue;
    }
    w.start(where);
    const t0 = Date.now();
    const issues: Issue[] = [];
    try { await step.run(ctx); } catch (e) { issues.push({ kind: 'check', where, detail: String((e as Error).message).split('\n')[0].slice(0, 300) }); }
    issues.push(...(await renderIssues(page, where)), ...w.take());
    const shot = shotPath(`${scn.id}-${acc.label}-${step.name}`);
    await page.screenshot({ path: shot }).catch(() => {});
    out.push({ portal: 'scenario', account: acc.label, path: where, title: scn.title, ms: Date.now() - t0, ok: issues.length === 0, issues, screenshot: shot });
  }
  return out;
}
