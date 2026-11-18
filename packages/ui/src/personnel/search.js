import { listEmployees } from './api';
import { tabForQuery } from '../picks/round62';

/**
 * People found by name, employee ID or work email, for the search bar
 * (People plan, 8 Nov 2026: typing "Priya" found nothing). Each opens the
 * person's record: in People itself, or in People from another app. The
 * server applies the reader's own scope, so a manager finds their team only.
 */
export async function findPeople(q, { appId = null } = {}) {
  const r = await listEmployees({ q, limit: 8 });
  /* Round 62 "searchtotab" A: a phone, e-mail or PAN search opens the record on the tab that holds it. */
  const tab = tabForQuery(q);
  return (r?.employees || []).map((e) => ({
    key: `person:${e.id}`,
    label: e.name || [e.firstName, e.lastName].filter(Boolean).join(' '),
    detail: [e.code, e.designation, e.department].filter(Boolean).join(' · '),
    group: 'People',
    screen: 'employee',
    params: tab ? { id: e.id, tab } : { id: e.id },
    ...(appId ? { appId } : {}),
  }));
}
