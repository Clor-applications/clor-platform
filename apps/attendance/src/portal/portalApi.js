import { API_BASE } from '@platform/http';
import { todayIst } from '@ui/utils/dates';
export { todayIst };

/**
 * The employee portal's own transport (server: routes/portal.ts). Its token is
 * kept apart from a CLOR user's ("token"): someone may be signed in to CLOR as
 * HR in one tab and test the portal in another, and neither may become the other.
 */
const KEY = 'clor.portal.token';
const REMEMBER = 'clor.portal.ids';

const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k) || '';
    } catch {
      return '';
    }
  },
  set: (k, v) => {
    try {
      if (v) localStorage.setItem(k, v);
      else localStorage.removeItem(k);
    } catch {
      /* private window: signed in for this page only */
    }
  },
};

export const portalToken = () => store.get(KEY);
export const setPortalToken = (t) => store.set(KEY, t);

/** Company and employee code from the last sign-in, so a phone does not ask every time. */
export const rememberedIds = () => {
  try {
    return JSON.parse(store.get(REMEMBER) || '{}');
  } catch {
    return {};
  }
};
const remember = (company, employeeCode) => store.set(REMEMBER, JSON.stringify({ company, employeeCode }));

export class SignedOut extends Error {}

async function call(path, { method = 'GET', body } = {}) {
  const token = portalToken();
  let res;
  try {
    res = await fetch(`${API_BASE}/portal${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 401 && data?.code === 'PORTAL_SIGNIN') {
    setPortalToken('');
    throw new SignedOut(data.error);
  }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Something went wrong (${res.status}).`), { code: data?.code, status: res.status });
  return data;
}

const signedIn = (company, employeeCode) => (r) => {
  setPortalToken(r.token);
  remember(String(company).trim().toUpperCase(), String(employeeCode).trim());
  return r;
};

export const signIn = ({ company, employeeCode, password }) =>
  call('/login', { method: 'POST', body: { company, employeeCode, password } }).then(signedIn(company, employeeCode));
export const activate = ({ company, employeeCode, activationCode, password }) =>
  call('/activate', { method: 'POST', body: { company, employeeCode, activationCode, password } }).then(signedIn(company, employeeCode));
/**
 * Sign this device out: the server ends its session (A-33), then the token is
 * forgotten here. Forgotten here whatever the server says — a phone that is
 * offline still signs out.
 */
export const signOut = async () => {
  try {
    if (portalToken()) await call('/signout', { method: 'POST' });
  } catch {
    /* offline, or already signed out: forgetting the token is enough here */
  } finally {
    setPortalToken('');
  }
};

/** The devices this person is signed in on (A-33). */
export const getSessions = () => call('/sessions');
export const endSession = (id) => call(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const endOtherSessions = async () => {
  const r = await call('/sessions/end-others', { method: 'POST' });
  /* A device on an older sign-in gets a session of its own back. */
  if (r?.token) setPortalToken(r.token);
  return r;
};

export const getMe = () => call('/me');
export const punch = (body) => call('/punch', { method: 'POST', body });
/* Approvals: what the people reporting to me are waiting on, and my decision on one. */
export const getApprovals = () => call('/approvals');
/* The month's review and overtime (time depth, gap 18): the routes the phone app uses. */
export const getMonthReview = (month) => call(`/month-review${month ? `?month=${encodeURIComponent(month)}` : ''}`);
export const confirmMonth = (month) => call(`/month-review/${encodeURIComponent(month)}/confirm`, { method: 'POST' });
export const disputeMonth = (month, note) => call(`/month-review/${encodeURIComponent(month)}/dispute`, { method: 'POST', body: { note } });
export const getOvertime = (month) => call(`/overtime${month ? `?month=${encodeURIComponent(month)}` : ''}`);
export const askOvertime = (body) => call('/overtime', { method: 'POST', body });
export const cancelOvertime = (id) => call(`/overtime/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
/* My documents (what HR marked visible) and my data requests (DPDP). */
export const getDocuments = () => call('/documents');
export const getDocument = (id) => call(`/documents/${encodeURIComponent(id)}`);
export const getDataRequests = () => call('/data-requests');
export const askData = (body) => call('/data-requests', { method: 'POST', body });
/* DPDP: the company's privacy notice and its read receipt, my data as a file, and withdrawing consent. */
export const getPrivacyNotice = () => call('/privacy-notice');
export const readPrivacyNotice = (version) => call('/privacy-notice/read', { method: 'POST', body: { version } });
export const getMyData = () => call('/my-data');
export const withdrawConsent = (what) => call('/consent/withdraw', { method: 'POST', body: { what } });
export const decideApproval = (type, id, body) => call(`/approvals/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: 'POST', body });
export const getAttendance = (month) => call(`/attendance${month ? `?month=${encodeURIComponent(month)}` : ''}`);
export const explainDay = (date) => call(`/attendance/explain?date=${encodeURIComponent(date)}`);
export const explainLeave = (leaveTypeId, year) => call(`/leave/explain?leaveTypeId=${encodeURIComponent(leaveTypeId)}${year ? `&year=${year}` : ''}`);
export const getSchedule = (month) => call(`/schedule${month ? `?month=${encodeURIComponent(month)}` : ''}`);
export const getLeave = () => call('/leave');
export const askLeave = (body) => call('/leave', { method: 'POST', body });
/** What a request would charge, without saving: { ok, total, split, parts[{label, from, to, days, balance, dates}], problems, reasonNeeded, type }. */
export const previewLeave = (body) => call('/leave/preview', { method: 'POST', body });
export const cancelLeave = (id) => call(`/leave/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
/** Change a waiting request (same body as askLeave). */
export const editLeave = (id, body) => call(`/leave/${encodeURIComponent(id)}`, { method: 'PUT', body });
/** Came back early: approved leave that has started now ends on `toDate`. */
export const shortenLeave = (id, toDate) => call(`/leave/${encodeURIComponent(id)}/shorten`, { method: 'POST', body: { toDate } });
export const pickRestrictedHoliday = (holidayId, picked) => call(`/holidays/restricted/${encodeURIComponent(holidayId)}`, { method: 'POST', body: { picked } });
export const getTax = () => call('/tax');
export const saveTax = (body) => call('/tax', { method: 'PUT', body });
export const changePassword = (current, next) =>
  call('/password', { method: 'POST', body: { current, next } }).then((r) => {
    setPortalToken(r.token);
    return r;
  });

/** A selfie made small on the phone (640 px, JPEG) before it is sent. */
export { shrinkPhoto } from '@ui/timeOff/shrinkPhoto';

export const hm = (minutes) => {
  const m = Math.max(0, Number(minutes) || 0);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

export const getCompanyUpdates = () => call('/company-updates');

/* People self-service (server: routes/peoplePortal.ts): my details and job, my requests to HR, policies, and what I am asked to accept. */
export const getMyDetails = () => call('/people/me/details');
export const askDetailsChange = (body) => call('/people/me/change-request', { method: 'POST', body });
export const answerMyRequest = (id, note) => call(`/people/me/requests/${encodeURIComponent(id)}/reply`, { method: 'POST', body: { note } });
export const withdrawMyRequest = (id) => call(`/people/me/requests/${encodeURIComponent(id)}/withdraw`, { method: 'POST' });
export const getPolicies = () => call('/people/policies');
export const getPolicy = (versionId) => call(`/people/policies/${encodeURIComponent(versionId)}`);
export const getToAccept = () => call('/people/acknowledgements');
export const acceptItem = (id) => call(`/people/acknowledgements/${encodeURIComponent(id)}/accept`, { method: 'POST' });

/* Attendance requests: missed punch, work from home, on duty, permission hours (server: portal /requests). */
/** My requests touching a month, with the month's usage per kind and the rules: { month, requests, usage, rules, reasons }. */
export const listRequests = (month) => call(`/requests${month ? `?month=${encodeURIComponent(month)}` : ''}`);
export const askRequest = (body) => call('/requests', { method: 'POST', body });
export const changeRequest = (id, body) => call(`/requests/${encodeURIComponent(id)}`, { method: 'PUT', body });
export const cancelRequest = (id) => call(`/requests/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
/** What is switched on, with this month's usage: { month, rules, kinds: [{ kind, name }], usage, reasons }. */
export const requestRules = (month) => call(`/request-rules${month ? `?month=${encodeURIComponent(month)}` : ''}`);

/* Payslips (server: portal /payslips): { available, slips: [{ id, number, period, payrollDate, gross, deductions, net, paid }] }; one with its lines. */
export const getPayslips = () => call('/payslips');
export const getPayslip = (id) => call(`/payslips/${encodeURIComponent(id)}`);
/** What changed for me: { decided: [{ key, kind, status, text, note, at }], waitingForMe }. */
export const getUpdates = () => call('/updates');
/** Every holiday of mine in a calendar year, restricted ones marked: { year, quota, picked, left, holidays: [{ id, date, name, restricted, picked, past }] }. */
export const getHolidays = (year) => call(`/holidays${year ? `?year=${encodeURIComponent(year)}` : ''}`);

/* Letters and document copies I ask HR for (server: peoplePortal /me/letters): { kinds: [{ kind, label }], requests: [{ id, type, title, status, createdAt, issued }] }. */
export const getMyLetters = () => call('/people/me/letters');
export const askLetter = (body) => call('/people/me/letters', { method: 'POST', body });
/* Leaving the company (server: peoplePortal /me/resign, /me/leaving). */
export const resign = (body) => call('/people/me/resign', { method: 'POST', body });
export const getLeaving = () => call('/people/me/leaving');
/* My joining and leaving steps (server: peoplePortal /me/journey): the ones that are mine to tick, and what I hand back. */
export const getJourney = () => call('/people/me/journey');
/* Today's greetings, my exit interview, and whether I am announced (server: peopleEngagementPortal; WORKFLOW-GAP-RESEARCH 4.8, 4.9). */
export const getTodayPosts = () => call('/people/engage/today');
export const getExitInterview = () => call('/people/engage/exit-interview');
export const sendExitInterview = (body) => call('/people/engage/exit-interview', { method: 'POST', body });
export const getCelebrations = () => call('/people/engage/celebrations');
export const setCelebrations = (optedOut) => call('/people/engage/celebrations', { method: 'PUT', body: { optedOut } });
export const doneJourneyTask = (id, note) => call(`/people/me/journey/tasks/${encodeURIComponent(id)}/done`, { method: 'POST', body: note ? { note } : {} });

/* Ask HR as a conversation (server: peoplePortal /desk): my requests with who wrote last, one with its thread (no internal notes), a reply, a reopen. */
export const getDesk = () => call('/people/desk');
export const raiseDesk = (body) => call('/people/desk', { method: 'POST', body });
export const getDeskCase = (id) => call(`/people/desk/${encodeURIComponent(id)}`);
export const replyDesk = (id, body) => call(`/people/desk/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { body } });
export const reopenDesk = (id) => call(`/people/desk/${encodeURIComponent(id)}/reopen`, { method: 'POST' });

/** A private complaint to the committee: { reference, receivedOn, inquiryDue } and nothing listed back. */
export const raisePrivateCase = (body) => call('/people/private-cases', { method: 'POST', body });

/* Growth (Talent, server routes/peoplePortal.ts): my goals and check-ins, my reviews (self-review, read and acknowledge), my plan, one-on-ones and trainings. */
export const getGrowth = () => call('/people/me/growth');
export const checkInGoal = (id, body) => call(`/people/me/goals/${encodeURIComponent(id)}/check-ins`, { method: 'POST', body });
export const writeSelfReview = (id, body) => call(`/people/me/reviews/${encodeURIComponent(id)}/self`, { method: 'POST', body });
export const acknowledgeReview = (id) => call(`/people/me/reviews/${encodeURIComponent(id)}/acknowledge`, { method: 'POST' });
/* Shift swaps (People, gap 24): mine and asked of me, who I may ask on some days, ask, answer, withdraw. */
export const getSwaps = () => call('/people/swaps');
export const swapColleagues = (from, to) => call(`/people/swaps/colleagues?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to || from)}`);
export const askSwap = (body) => call('/people/swaps', { method: 'POST', body });
export const answerSwap = (id, accept, note) => call(`/people/swaps/${encodeURIComponent(id)}/${accept ? 'accept' : 'decline'}`, { method: 'POST', body: note ? { note } : {} });
export const withdrawSwap = (id) => call(`/people/swaps/${encodeURIComponent(id)}/withdraw`, { method: 'POST' });
/* Requests HR set up (People, gap 25): the forms open to me and mine; ask (idempotencyKey makes a double tap one), answer, withdraw, my files. */
export const getForms = () => call('/people/forms');
export const askFormRequest = (id, body) => call(`/people/forms/${encodeURIComponent(id)}`, { method: 'POST', body });
export const replyFormRequest = (id, note) => call(`/people/forms/requests/${encodeURIComponent(id)}/reply`, { method: 'POST', body: { note } });
export const withdrawFormRequest = (id) => call(`/people/forms/requests/${encodeURIComponent(id)}/withdraw`, { method: 'POST' });
export const getFormFile = (id) => call(`/people/forms/files/${encodeURIComponent(id)}`).then((r) => r.file);

/* Jobs and referrals (People, server routes/peopleReferralsPortal.ts): jobs open to me, refer a friend, my link, apply myself, my referrals. */
export const getReferrals = () => call('/people/referrals');
export const referFriend = (body) => call('/people/referrals/refer', { method: 'POST', body });
export const referralLink = (openingId) => call('/people/referrals/link', { method: 'POST', body: { openingId } });
export const applyWithin = (body) => call('/people/referrals/apply', { method: 'POST', body });

/* Attendance rules (People, server routes/peopleTimePortal.ts): days to fix, my late marks, absence notices, night-work consent. */
export const getFixes = () => call('/people/time/fixes');
export const getMyMarks = (month) => call(`/people/time/marks${month ? `?month=${encodeURIComponent(month)}` : ''}`);
export const getNightConsent = () => call('/people/time/night-consent');
export const setNightConsent = (body) => call('/people/time/night-consent', { method: 'POST', body });
