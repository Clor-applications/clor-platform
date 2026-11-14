import { useEffect, useRef } from 'react';
import { rememberCompanyDisplaySettings } from '../utils/money';

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
  const settings = profile.companySettings && typeof profile.companySettings === 'object' ? profile.companySettings : {};
  const gstin = String(settings.gstin || profile.gstin || '').trim();
  return {
    id: fallbackId,
    name: String(settings.companyName || org?.name || '').trim() || 'Company',
    legalName: String(settings.legalName || org?.name || '').trim(),
    gstin,
    gstRegistration: gstin ? 'Regular' : 'Unregistered',
    state: String(settings.regStateName || profile.state || '').trim(),
    address: [settings.regAddress1, settings.regAddress2].filter(Boolean).join(', '),
    city: String(settings.regCity || '').trim(),
    pincode: String(settings.regPincode || '').trim(),
    country: String(settings.regCountry || profile.country || 'India'),
    currency: String(settings.baseCurrency || profile.baseCurrency || profile.currency || 'INR'),
    pan: String(settings.pan || '').trim(),
    cin: String(settings.cin || '').trim(),
    phone: String(settings.phone || '').trim(),
    email: String(settings.officialEmail || '').trim(),
    website: String(settings.website || '').trim(),
    logo: String(settings.logo || '').trim(),
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
    if (org?.profile?.companySettings) rememberCompanyDisplaySettings(companyFromOrg(org, 0));

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

      // Local edits win: a field is taken from the server only where the
      // local value is empty, or the name is still the placeholder. The
      // address, PAN and contact fields exist only when the company settings
      // were saved on the server, so they are filled only then.
      const current = companies[idx];
      const server = companyFromOrg(org, current.id);
      const hasSettings = Boolean(org?.profile?.companySettings);
      const keys = ['name', 'gstin', 'state', 'country', 'currency', 'tradeName', 'entityType'];
      if (hasSettings) {
        keys.push('legalName', 'address', 'city', 'pincode', 'pan', 'cin', 'phone', 'email', 'website', 'logo');
      }
      const filled = { ...current };
      for (const key of keys) {
        const localValue = String(current?.[key] ?? '').trim();
        const serverValue = String(server?.[key] ?? '').trim();
        const localIsPlaceholder = key === 'name' ? isPlaceholder(current) : !localValue;
        if (localIsPlaceholder && serverValue) filled[key] = server[key];
      }
      if (filled.gstin && !current.gstin && !current.gstRegistration) filled.gstRegistration = 'Regular';
      filled.profile = {
        ...server.profile,
        ...(current.profile && typeof current.profile === 'object' ? current.profile : {}),
        backendCompanyId: org.id,
        handle: org.slug || current?.profile?.handle || null,
      };
      if (hasSettings) filled.profile.companySettings = server.profile.companySettings;

      // As before, tradeName and entityType alone are not worth a rewrite.
      const watched = keys.filter((k) => k !== 'tradeName' && k !== 'entityType');
      const changed = watched.some((k) => filled[k] !== current[k]) || (hasSettings
        && JSON.stringify(filled.profile.companySettings) !== JSON.stringify(current?.profile?.companySettings));
      if (!changed && current?.profile?.backendCompanyId === org.id) return prev;
      return { ...prev, companies: companies.map((c, i) => (i === idx ? filled : c)) };
    });
  }, [enabled, orgs, activeOrgId, setDb]);
};

export default useCompanyFromServer;
