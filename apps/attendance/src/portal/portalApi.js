import { API_BASE } from '@platform/http';

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
export const askCorrection = (body) => call('/corrections', { method: 'POST', body });
export const getSchedule = (month) => call(`/schedule${month ? `?month=${encodeURIComponent(month)}` : ''}`);
export const getLeave = () => call('/leave');
export const askLeave = (body) => call('/leave', { method: 'POST', body });
export const cancelLeave = (id) => call(`/leave/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
export const getTax = () => call('/tax');
/* Ask HR: my HR cases, and a new one (server: portal /hr-cases). */
export const getHrCases = () => call('/hr-cases');
export const askHr = (body) => call('/hr-cases', { method: 'POST', body });
export const saveTax = (body) => call('/tax', { method: 'PUT', body });
export const changePassword = (current, next) =>
  call('/password', { method: 'POST', body: { current, next } }).then((r) => {
    setPortalToken(r.token);
    return r;
  });

/** Where the phone is, as precisely as it will say (15 s at most). */
export const locate = () =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser cannot give your location.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (e) =>
        reject(
          new Error(
            e.code === 1
              ? 'Location is blocked for this site. Allow it in the browser’s site settings, then try again.'
              : 'Your location could not be found. Turn on location (GPS) and try again.'
          )
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  });

/** A selfie made small on the phone (640 px, JPEG) before it is sent. */
export const shrinkPhoto = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 640 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That photo could not be read.'));
    };
    img.src = url;
  });

export const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
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
