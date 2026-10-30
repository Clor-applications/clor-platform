import { API_BASE, apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/*
 * Talent (docs/people/design-v1/TALENT-DECISIONS.md; server routes/peopleTalent.ts): hiring
 * (openings, candidates, interviews, the hire) and growth (goals, reviews, plans, one-on-ones,
 * training). Offers to candidates go through the offer letter (workforce/api createOffer).
 */
const base = () => `/orgs/${encodeURIComponent(orgId())}/people/talent`;
const opts = { skipWarehouseHeader: true };
const id = (v) => encodeURIComponent(v);
const send = (path, method, body) => apiFetch(`${base()}${path}`, { ...opts, method, body });
const get = (path) => apiFetch(`${base()}${path}`, opts);
const qs = (params = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

/* Openings */
export const listOpenings = (params) => get(`/openings${qs(params)}`).then((r) => r?.openings || []);
export const getOpening = (openingId) => get(`/openings/${id(openingId)}`).then((r) => r?.opening);
export const createOpening = (body) => send('/openings', 'POST', body).then((r) => r?.opening);
export const updateOpening = (openingId, body) => send(`/openings/${id(openingId)}`, 'PUT', body).then((r) => r?.opening);
export const setOpeningStatus = (openingId, status, reason) => send(`/openings/${id(openingId)}/status`, 'POST', { status, reason }).then((r) => r?.opening);
export const setApplyLink = (openingId, on) => send(`/openings/${id(openingId)}/apply-link`, 'POST', { on });
export const deleteOpening = (openingId) => send(`/openings/${id(openingId)}`, 'DELETE');
export const interviewers = () => get('/interviewers').then((r) => r?.users || []);

/* Candidates */
export const listCandidates = (params) => get(`/candidates${qs(params)}`);
export const getCandidate = (candidateId) => get(`/candidates/${id(candidateId)}`);
export const addCandidate = (body) => send('/candidates', 'POST', body).then((r) => r?.candidate);
export const updateCandidate = (candidateId, body) => send(`/candidates/${id(candidateId)}`, 'PUT', body);
export const moveCandidate = (candidateId, stage, reason) => send(`/candidates/${id(candidateId)}/stage`, 'POST', { stage, reason });
export const noteCandidate = (candidateId, note) => send(`/candidates/${id(candidateId)}/notes`, 'POST', { note });
export const saveResume = (candidateId, file) => send(`/candidates/${id(candidateId)}/resume`, 'POST', file);
export const hireCandidate = (candidateId, body) => send(`/candidates/${id(candidateId)}/hire`, 'POST', body);
export const resumeFile = (candidateId) => fileOf(`/candidates/${id(candidateId)}/resume`);

/* Interviews */
export const listInterviews = (params) => get(`/interviews${qs(params)}`);
export const scheduleInterview = (candidateId, body) => send(`/candidates/${id(candidateId)}/interviews`, 'POST', body);
export const moveInterview = (interviewId, body) => send(`/interviews/${id(interviewId)}`, 'PUT', body);
export const cancelInterview = (interviewId) => send(`/interviews/${id(interviewId)}/cancel`, 'POST', {});
export const giveFeedback = (interviewId, body) => send(`/interviews/${id(interviewId)}/feedback`, 'POST', body);

/* Goals */
/* Goals and plans come with who the viewer is: { me, reports, hr }, so a screen offers only what they may do. */
export const listGoals = (params) => get(`/goals${qs(params)}`).then((r) => ({ goals: r?.goals || [], me: r?.me || null, reports: r?.reports || [], hr: Boolean(r?.hr) }));
export const getGoal = (goalId) => get(`/goals/${id(goalId)}`);
export const createGoal = (body) => send('/goals', 'POST', body).then((r) => r?.goal);
export const updateGoal = (goalId, body) => send(`/goals/${id(goalId)}`, 'PUT', body).then((r) => r?.goal);
export const checkIn = (goalId, body) => send(`/goals/${id(goalId)}/check-ins`, 'POST', body).then((r) => r?.goal);

/* Reviews */
export const listCycles = () => get('/cycles');
export const createCycle = (body) => send('/cycles', 'POST', body).then((r) => r?.cycle);
export const moveCycle = (cycleId, to) => send(`/cycles/${id(cycleId)}/move`, 'POST', { to });
export const getCycle = (cycleId) => get(`/cycles/${id(cycleId)}`);
export const calibration = (cycleId) => get(`/cycles/${id(cycleId)}/calibration`);
export const writeSelf = (reviewId, body) => send(`/reviews/${id(reviewId)}/self`, 'POST', body);
export const writeManager = (reviewId, body) => send(`/reviews/${id(reviewId)}/manager`, 'POST', body);
export const setFinal = (reviewId, body) => send(`/reviews/${id(reviewId)}/final`, 'POST', body);

/* Improvement plans and one-on-ones */
export const listPlans = (params) => get(`/plans${qs(params)}`).then((r) => ({ plans: r?.plans || [], me: r?.me || null, reports: r?.reports || [], hr: Boolean(r?.hr) }));
export const createPlan = (body) => send('/plans', 'POST', body).then((r) => r?.plan);
export const notePlan = (planId, note) => send(`/plans/${id(planId)}/notes`, 'POST', { note });
export const decidePlan = (planId, body) => send(`/plans/${id(planId)}/decide`, 'POST', body).then((r) => r?.plan);
export const listOneOnOnes = (params) => get(`/one-on-ones${qs(params)}`);
export const saveOneOnOne = (body, oneOnOneId) => send(`/one-on-ones${oneOnOneId ? `/${id(oneOnOneId)}` : ''}`, oneOnOneId ? 'PUT' : 'POST', body).then((r) => r?.oneOnOne);

/* Training */
export const listTrainings = (params) => get(`/trainings${qs(params)}`).then((r) => r?.trainings || []);
export const expiringCertificates = () => get('/trainings?view=expiring').then((r) => r?.expiring || []);
export const getTraining = (trainingId) => get(`/trainings/${id(trainingId)}`);
export const saveTraining = (body, trainingId) => send(`/trainings${trainingId ? `/${id(trainingId)}` : ''}`, trainingId ? 'PUT' : 'POST', body).then((r) => r?.training);
export const deleteTraining = (trainingId) => send(`/trainings/${id(trainingId)}`, 'DELETE');
export const assignSeats = (trainingId, employeeIds) => send(`/trainings/${id(trainingId)}/seats`, 'POST', { employeeIds });
export const markSeat = (seatId, body) => send(`/seats/${id(seatId)}`, 'PUT', body);
export const removeSeat = (seatId) => send(`/seats/${id(seatId)}`, 'DELETE');
export const certificateFile = (seatId) => fileOf(`/seats/${id(seatId)}/certificate`);

/**
 * A file the server sends as itself (a résumé, a certificate), saved by the browser. apiFetch
 * reads JSON or text, so this asks with the same headers and keeps the bytes.
 */
async function fileOf(path) {
  let token = '';
  try { token = String(localStorage.getItem('token') || '').trim(); } catch { /* private window */ }
  const res = await fetch(`${API_BASE}${base()}${path}`, { credentials: 'include', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'x-org-id': orgId() } });
  if (!res.ok) {
    let message = 'Could not download the file.';
    try { message = (await res.json())?.error || message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'file';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file picked by the person, as the server takes it: a data URL with its type. */
export const readFile = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve({ name: file.name, mime: file.type, data: r.result });
  r.onerror = () => reject(new Error('Could not read the file.'));
  r.readAsDataURL(file);
});

/* Referrals (server routes/peopleReferrals.ts): an opening's settings, HR's list and report, the bonus by hand; and my own. */
export const getReferralSettings = (openingId) => get(`/openings/${id(openingId)}/referrals`).then((r) => r?.settings);
export const saveReferralSettings = (openingId, body) => send(`/openings/${id(openingId)}/referrals`, 'PUT', body).then((r) => r?.settings);
export const listReferrals = (params) => get(`/referrals${qs(params)}`);
export const referralReport = () => get('/referrals/report');
export const sendBonus = (referralId) => send(`/referrals/${id(referralId)}/bonus/send`, 'POST', {});
export const bonusPaid = (referralId) => send(`/referrals/${id(referralId)}/bonus/paid`, 'POST', {});
export const bonusForfeit = (referralId, reason) => send(`/referrals/${id(referralId)}/bonus/forfeit`, 'POST', { reason });
const mine = (path = '') => `/orgs/${encodeURIComponent(orgId())}/people/referrals/me${path}`;
export const myReferrals = () => apiFetch(mine(), opts);
export const referSomeone = (body) => apiFetch(mine('/refer'), { ...opts, method: 'POST', body });
export const myReferralLink = (openingId) => apiFetch(mine('/link'), { ...opts, method: 'POST', body: { openingId } });
export const applyMyself = (body) => apiFetch(mine('/apply'), { ...opts, method: 'POST', body });
