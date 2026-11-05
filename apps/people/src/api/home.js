import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/* People Home's dashboard, kudos and pulse (owner's suite spec, 5–6 Nov 2026; server: routes/peopleHomeDashboard.ts). */
const base = () => `/orgs/${encodeURIComponent(orgId())}/people`;
const opts = { skipWarehouseHeader: true };
const send = (path, method, body) => apiFetch(`${base()}${path}`, { ...opts, method, body });

/** { today: { clock, away }, decisions: { probation, statutory, clearance }, workforce, hiring, links } */
export const getHomeDashboard = () => apiFetch(`${base()}/home/dashboard`, opts);

export const listKudos = () => apiFetch(`${base()}/kudos`, opts).then((r) => r?.kudos || []);
export const giveKudos = (toEmployeeId, message) => send('/kudos', 'POST', { toEmployeeId, message }).then((r) => r?.kudos || []);
export const removeKudos = (id) => send(`/kudos/${encodeURIComponent(id)}`, 'DELETE').then((r) => r?.kudos || []);

/** { question, answered, mine, results: [n1..n5] | null, average, showsAt, canAsk } */
export const getPulse = () => apiFetch(`${base()}/pulse`, opts);
export const answerPulse = (questionId, score) => send('/pulse/answer', 'POST', { questionId, score });
export const askPulse = (text) => send('/pulse', 'POST', { text });
export const closePulse = () => send('/pulse/close', 'POST', {});
