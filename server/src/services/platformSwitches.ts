import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';

/**
 * Switches for the whole of CLOR, set in the operator console (Settings,
 * OPS_PORTAL_GAPS #5): pause new trials or demo requests from clor.in for a
 * while, with the words visitors read meanwhile. Kept as PlatformSetting rows
 * under `switch.<name>`; no row means open.
 */
export const SWITCHES = {
  signups: {
    label: 'Free trials from clor.in',
    help: 'New visitors can start a free trial. Paused, the trial form shows your message instead; people who already have a link can still finish.',
    pausedDefault: 'New trials are paused for a short while. Ask us for a demo and we will set you up.',
  },
  demoRequests: {
    label: 'Demo requests from clor.in',
    help: 'Visitors can ask for a demo. Paused, the form shows your message instead.',
    pausedDefault: 'We are not taking demo requests for a short while. Write to us and we will reply.',
  },
} as const;
export type SwitchName = keyof typeof SWITCHES;
export const SWITCH_NAMES = Object.keys(SWITCHES) as SwitchName[];

export type SwitchState = { open: boolean; message: string; updatedAt: Date | null; updatedByUserId: string | null };

const keyOf = (name: SwitchName) => `switch.${name}`;

function read(name: SwitchName, row: { value: unknown; updatedAt: Date; updatedByUserId: string | null } | null): SwitchState {
  const v = (row?.value && typeof row.value === 'object' ? row.value : {}) as Record<string, unknown>;
  const message = typeof v.message === 'string' && v.message.trim() ? v.message.trim() : SWITCHES[name].pausedDefault;
  return { open: v.open !== false, message, updatedAt: row?.updatedAt ?? null, updatedByUserId: row?.updatedByUserId ?? null };
}

export async function switchState(name: SwitchName): Promise<SwitchState> {
  const row = await outsideTenant('platform switch: read', () => platformPrisma.platformSetting.findUnique({ where: { key: keyOf(name) } }));
  return read(name, row);
}

export async function allSwitches() {
  const rows = await outsideTenant('platform switches: read', () => platformPrisma.platformSetting.findMany({ where: { key: { in: SWITCH_NAMES.map(keyOf) } } }));
  const by = new Map(rows.map((r) => [r.key, r]));
  return SWITCH_NAMES.map((name) => ({ name, label: SWITCHES[name].label, help: SWITCHES[name].help, ...read(name, by.get(keyOf(name)) ?? null) }));
}

export async function setSwitch(name: SwitchName, open: boolean, message: string | null, userId: string) {
  const value = { open, message: message?.trim() || null };
  await outsideTenant('platform switch: set', () =>
    platformPrisma.platformSetting.upsert({ where: { key: keyOf(name) }, update: { value, updatedByUserId: userId }, create: { key: keyOf(name), value, updatedByUserId: userId } }),
  );
}

/** The refusal a paused public form answers with, or null when it is open. */
export async function pausedRefusal(name: SwitchName) {
  const s = await switchState(name);
  return s.open ? null : { status: 503, body: { error: s.message, code: 'PAUSED' } };
}
