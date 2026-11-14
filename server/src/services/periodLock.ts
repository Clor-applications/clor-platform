import { prisma } from '../utils/prisma.js';
import { isFeatureEnabled } from './features.js';

export const PERIOD_LOCK_MODULES = ['sales', 'purchases', 'expenses', 'cashBank', 'inventory', 'journal'] as const;
export type PeriodLockModule = typeof PERIOD_LOCK_MODULES[number];

export type PeriodLockPolicy = {
  enabled: boolean;
  modules: Record<PeriodLockModule, { enabled: boolean; mode: 'MANUAL' | 'AUTO'; manualThrough: string; autoDays: number; exemptUserIds: string[] }>;
  exemptUserIds: string[];
};

export const defaultPeriodLockPolicy = (): PeriodLockPolicy => ({
  enabled: false,
  modules: Object.fromEntries(PERIOD_LOCK_MODULES.map((key) => [key, { enabled: false, mode: 'MANUAL', manualThrough: '', autoDays: 0, exemptUserIds: [] }])) as unknown as PeriodLockPolicy['modules'],
  exemptUserIds: [],
});

export const normalisePeriodLockPolicy = (value: any): PeriodLockPolicy => {
  const defaults = defaultPeriodLockPolicy();
  const modules = Object.fromEntries(PERIOD_LOCK_MODULES.map((key) => {
    const row = value?.modules?.[key] || {};
    return [key, {
      enabled: row.enabled === true,
      mode: row.mode === 'AUTO' ? 'AUTO' : 'MANUAL',
      manualThrough: /^\d{4}-\d{2}-\d{2}$/.test(String(row.manualThrough || '')) ? String(row.manualThrough) : '',
      autoDays: Math.min(365, Math.max(0, Number.isInteger(Number(row.autoDays)) ? Number(row.autoDays) : 0)),
      exemptUserIds: [...new Set<string>((Array.isArray(row.exemptUserIds) ? row.exemptUserIds : []).map((id: unknown) => String(id)).filter(Boolean))],
    }];
  })) as PeriodLockPolicy['modules'];
  const exemptUserIds: string[] = [...new Set<string>((Array.isArray(value?.exemptUserIds) ? value.exemptUserIds : []).map((id: unknown) => String(id)).filter(Boolean))];
  return { enabled: value?.enabled === true, modules, exemptUserIds };
};

export async function getPeriodLockPolicy(accountId: string, orgId: string, db: any = prisma): Promise<PeriodLockPolicy> {
  const row = await db.orgMaster.findFirst({ where: { accountId, orgId, kind: 'PERIOD_LOCK', name: 'Organization' } });
  if (!row) return defaultPeriodLockPolicy();
  try { return normalisePeriodLockPolicy(JSON.parse(row.dataJson || '{}')); }
  catch { return defaultPeriodLockPolicy(); }
}

export function periodLockModuleForSource(source: string | null | undefined): PeriodLockModule | null {
  const kind = String(source || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (['INVOICE', 'CREDITNOTE', 'POSSALE'].includes(kind)) return 'sales';
  if (['BILL', 'DEBITNOTE', 'PURCHASEINVOICE'].includes(kind)) return 'purchases';
  if (kind === 'EXPENSE') return 'expenses';
  if (['RECEIPT', 'PAYMENT', 'BANK', 'CASH', 'CONTRA'].includes(kind)) return 'cashBank';
  if (kind.includes('INVENTORY') || kind.includes('STOCK') || kind.includes('TRANSFER')) return 'inventory';
  if (['MANUAL', 'IMPORTJOURNAL', 'FXREVALUATION'].includes(kind)) return 'journal';
  return null;
}

export function periodLockThrough(policy: PeriodLockPolicy, module: PeriodLockModule, now = new Date()): string {
  if (!policy.enabled || !policy.modules[module]?.enabled) return '';
  const rule = policy.modules[module];
  if (rule.mode === 'MANUAL') return rule.manualThrough;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let monthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  while (new Date(monthEnd.getFullYear(), monthEnd.getMonth(), monthEnd.getDate() + rule.autoDays) >= today) {
    monthEnd = new Date(monthEnd.getFullYear(), monthEnd.getMonth(), 0);
  }
  return `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`;
}

export async function assertPeriodUnlocked({ accountId, orgId, userId, module, date, db = prisma }: {
  accountId: string; orgId: string; userId: string; module: PeriodLockModule; date: string; db?: any;
}) {
  if (!(await isFeatureEnabled(accountId, orgId, 'periodLock', db))) return;
  const policy = await getPeriodLockPolicy(accountId, orgId, db);
  if (policy.exemptUserIds.includes(userId) || policy.modules[module]?.exemptUserIds.includes(userId)) return;
  const through = periodLockThrough(policy, module);
  if (through && String(date || '').slice(0, 10) <= through) {
    const error = new Error(`${module} entries dated on or before ${through} are locked by Organization Settings.`) as Error & { status: number };
    error.status = 409;
    throw error;
  }
}
