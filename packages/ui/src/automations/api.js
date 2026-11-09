import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/* Settings → Automations for any module (server: routes/automations.ts). */
const base = () => `/orgs/${encodeURIComponent(orgId())}/automations`;
const opts = { skipWarehouseHeader: true };

/** { load, save, history } for one module's Automations screen. */
export const automationsApi = (module) => ({
  load: () => apiFetch(`${base()}?module=${encodeURIComponent(module)}`, opts),
  save: (automations) => apiFetch(`${base()}?module=${encodeURIComponent(module)}`, { ...opts, method: 'PUT', body: { automations } }),
  history: (key) => apiFetch(`${base()}/${encodeURIComponent(key)}/history`, opts),
});
