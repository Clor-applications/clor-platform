import { useEffect, useRef } from 'react';

/**
 * The company the browser is looking at, taken from the server.
 *
 * Signing up asks for the company and creates it on the server. Signing in on
 * a different machine — or after site data is cleared — starts from an empty
 * local book, and there was no route that would say what company this account
 * holds. So the app fell back to a placeholder called "Company" with no GSTIN
 * and no state, and offered to set the company up again: the same questions,
 * answered once already, against books that existed the whole time.
 *
 * `/auth/me` now returns each org's name and stored profile, so the record is
 * rebuilt from it. Local edits win: this fills a company in, it does not
 * overwrite one. A field is taken from the server only where the local value
 * is empty or still the placeholder.
 */

const PLACEHOLDER_NAMES = new Set(['company', 'accounting', 'my company', '']);

const isPlaceholder = (c) =>
  !c || PLACEHOLDER_NAMES.has(String(c.name || '').trim().toLowerCase());

/** The local shape, from the server's org record. */
const companyFromOrg = (org, fallbackId) => {
  const profile = org?.profile && typeof org.profile === 'object' ? org.profile : {};
  const gstin = String(profile.gstin || '').trim();
  return {
    id: fallbackId,
    name: String(org?.name || '').trim() || 'Company',
    gstin,
    gstRegistration: gstin ? 'Regular' : 'Unregistered',
    state: String(profile.state || '').trim(),
    country: String(profile.country || 'India'),
    currency: String(profile.baseCurrency || profile.currency || 'INR'),
    tradeName: String(profile.tradeName || '').trim() || undefined,
    entityType: profile.entityType || undefined,
    profile: {
      ...profile,
      backendCompanyId: org?.id || null,
      handle: org?.slug || null,
    },
  };
};

export const useCompanyFromServer = ({ enabled, orgs, activeOrgId, setDb }) => {
  const appliedFor = useRef('');

  useEffect(() => {
    if (!enabled) return;
    const orgId = String(activeOrgId || '').trim();
    if (!orgId) return;
    const membership = (Array.isArray(orgs) ? orgs : []).find((o) => String(o?.orgId) === orgId);
    const org = membership?.org;
    if (!org) return;

    // Once per org per session: this fills a gap, it does not poll.
    if (appliedFor.current === orgId) return;
    appliedFor.current = orgId;

    setDb((prev) => {
      const companies = Array.isArray(prev?.companies) ? prev.companies : [];
      const idx = companies.findIndex((c) => String(c?.profile?.backendCompanyId || '') === orgId);

      /*
       * No company at all, or only the placeholder the app invents when the
       * book is empty. Either way the person has one company on the server and
       * should not be asked to describe it a second time.
       */
      if (idx === -1) {
        const blankIdx = companies.findIndex((c) => isPlaceholder(c) && !c?.profile?.backendCompanyId);
        const nextId = companies.reduce((m, c) => Math.max(m, Number(c?.id || 0)), 0) + 1;
        const fresh = companyFromOrg(org, blankIdx === -1 ? nextId : companies[blankIdx].id);
        if (blankIdx === -1) {
          return { ...prev, companies: [...companies, fresh], activeCompanyId: fresh.id };
        }
        const merged = companies.map((c, i) => (i === blankIdx ? { ...c, ...fresh, id: c.id } : c));
        return { ...prev, companies: merged, activeCompanyId: companies[blankIdx].id };
      }

      /*
       * Known company: fill the blanks only. Somebody who corrected their
       * trade name here must not find it reverted on the next sign-in, and a
       * state typed locally is a deliberate answer to a question the server
       * may never have been asked.
       */
      const current = companies[idx];
      const server = companyFromOrg(org, current.id);
      const filled = { ...current };
      for (const key of ['name', 'gstin', 'state', 'country', 'currency', 'tradeName', 'entityType']) {
        const localValue = String(current?.[key] ?? '').trim();
        const serverValue = String(server?.[key] ?? '').trim();
        const localIsPlaceholder = key === 'name' ? isPlaceholder(current) : !localValue;
        if (localIsPlaceholder && serverValue) filled[key] = server[key];
      }
      filled.profile = {
        ...server.profile,
        ...(current.profile && typeof current.profile === 'object' ? current.profile : {}),
        backendCompanyId: org.id,
        handle: org.slug || current?.profile?.handle || null,
      };

      const changed = ['name', 'gstin', 'state', 'country', 'currency'].some((k) => filled[k] !== current[k]);
      if (!changed && current?.profile?.backendCompanyId === org.id) return prev;
      return { ...prev, companies: companies.map((c, i) => (i === idx ? filled : c)) };
    });
  }, [enabled, orgs, activeOrgId, setDb]);
};

export default useCompanyFromServer;
