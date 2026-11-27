// Only an invalidation signal crosses tabs. Each view reads its own authorized data.
const eventName = 'clor:people-changed';
const storageKey = 'clor.people.last-change';

export function publishPeopleChange(org) {
  if (!org || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(eventName, { detail: org }));
  try {
    localStorage.setItem(storageKey, JSON.stringify({ org, at: Date.now() }));
  } catch { /* Storage can be disabled. The visible page still checks the server. */ }
}

export function watchPeopleChanges(org, refresh) {
  const local = (event) => { if (event.detail === org) refresh(); };
  const otherTab = (event) => {
    if (event.key !== storageKey || !event.newValue) return;
    try { if (JSON.parse(event.newValue).org === org) refresh(); } catch { /* Unreadable storage event. */ }
  };
  window.addEventListener(eventName, local);
  window.addEventListener('storage', otherTab);
  return () => {
    window.removeEventListener(eventName, local);
    window.removeEventListener('storage', otherTab);
  };
}
