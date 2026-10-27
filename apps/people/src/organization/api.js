import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

import { qs } from '../workforce/api';

/* Organization (docs/people/design-v1/ORGANIZATION-DECISIONS.md): the company's shape, its places and its changes. */
const org = () => `/orgs/${encodeURIComponent(orgId())}`;
const base = () => `${org()}/people`;
const opts = { skipWarehouseHeader: true };
const send = (path, method, body) => apiFetch(`${base()}${path}`, { ...opts, method, body });

export const organization = () => apiFetch(`${base()}/organization`, opts);
export const listItems = (kind) => apiFetch(`${base()}/structure/${kind}`, opts).then((r) => r?.items || []);
export const createItem = (kind, body) => send(`/structure/${kind}`, 'POST', body);
export const updateItem = (kind, id, body) => send(`/structure/${kind}/${encodeURIComponent(id)}`, 'PUT', body);
export const deleteItem = (kind, id) => send(`/structure/${kind}/${encodeURIComponent(id)}`, 'DELETE');
export const mergeItem = (kind, id, body) => send(`/structure/${kind}/${encodeURIComponent(id)}/merge`, 'POST', body);
export const structureHistory = (params) => apiFetch(`${base()}/structure-history${qs(params)}`, opts);
export const people = () => apiFetch(`${base()}/employees${qs({ limit: 500, sort: 'name' })}`, opts).then((r) => r?.employees || []);

/* Branches are the company's registered places, shared with Accounting (platform `Branch`). */
const branchOpts = { skipWarehouseHeader: true };
export const listBranches = () => apiFetch(`${org()}/branches`, branchOpts).then((r) => r?.branches || []);
export const createBranch = (body) => apiFetch(`${org()}/branches`, { ...branchOpts, method: 'POST', body });
export const updateBranch = (id, body) => apiFetch(`${org()}/branches/${encodeURIComponent(id)}`, { ...branchOpts, method: 'PATCH', body });
/* Retiring a branch moves its people first (People owns that move and its history). */
export const retireBranch = (id, body) => send(`/branches/${encodeURIComponent(id)}/retire`, 'POST', body);
