/**
 * The test world: who exists, in which company, and how they sign in.
 *
 * Built once per device project by its setup project and written to
 * e2e/.state/<device>/world.json; the tests of that project read it from
 * there. Names follow docs/people/qa/PERSONA-SCENARIOS.md. Company names
 * carry the run's suffix, so two runs against one staging account never meet.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Device = 'desktop' | 'phone';

const ROOT = fileURLToPath(new URL('../.state/', import.meta.url));
export const stateDir = (device: Device) => `${ROOT}${device}/`;
export const worldFile = (device: Device) => `${stateDir(device)}world.json`;
/** A saved sign-in: owner, hr, manager (web) or app-<person> (employee app). */
export const authFile = (device: Device, persona: string) => `${stateDir(device)}auth-${persona}.json`;

/** setup-desktop → desktop, phone → phone. */
export const deviceOf = (projectName: string): Device => (projectName.endsWith('phone') ? 'phone' : 'desktop');

export type Person = {
  key: string;
  name: string;
  code: string;
  id: string;
  department: string;
  designation: string;
  manager: string | null;
  email?: string;
  phone?: string;
};

export type Company = { name: string; orgId: string; branchId: string; code: string };

export type World = {
  run: string;
  device: Device;
  password: string;
  asha: Company;
  vels: Company;
  other: Company;
  /** Web sign-ins (CLOR users). */
  users: Record<'owner' | 'hr' | 'manager' | 'otherOwner', { email: string; name: string }>;
  /** Employee app sign-ins: company code + employee code + password. */
  appUsers: Record<string, { company: string; code: string; name: string }>;
  people: Record<string, Person>;
  velsPeople: Record<string, Person>;
  otherPeople: Record<string, Person>;
  leave: { casualId: string; earnedId: string; casualDays: number; holiday: { date: string; name: string } };
};

const cache = new Map<Device, World>();
export function readWorld(device: Device): World {
  if (!cache.has(device)) cache.set(device, JSON.parse(readFileSync(worldFile(device), 'utf8')) as World);
  return cache.get(device)!;
}
