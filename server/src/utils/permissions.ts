import type { PermissionAction } from '../constants/enums.js';

export type PermissionKey = {
  module: string;
  subModule?: string | null;
  action: PermissionAction;
};

export function permissionKeyToString(p: PermissionKey): string {
  return `${String(p.module)}::${String(p.subModule || '')}::${String(p.action)}`;
}

export function normalizeModule(s: string): string {
  return String(s || '').trim();
}

export function normalizeSubModule(s?: string | null): string {
  const v = String(s || '').trim();
  return v;
}
