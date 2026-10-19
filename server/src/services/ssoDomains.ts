import { promises as dns } from 'node:dns';
import { randomBytes } from 'node:crypto';

import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';

/**
 * Which e-mail domains a sign-in method may speak for.
 *
 * An identity provider set up by one company must never be able to sign in
 * people of another, so a domain counts only once the company has proved it
 * owns it — a DNS TXT record `clor-domain-verification=<token>` on the domain —
 * and only one CLOR account may hold a domain at a time. Public mail domains
 * (gmail.com and the like) can never be claimed.
 */
export const VERIFY_PREFIX = 'clor-domain-verification=';
export const newDomainToken = () => randomBytes(18).toString('base64url');

const PUBLIC_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'zoho.com', 'zohomail.com', 'zohomail.in',
  'rediffmail.com', 'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'yandex.ru', 'tutanota.com', 'fastmail.com', 'hey.com',
]);

export const domainsOf = (csv: string | null | undefined) =>
  [...new Set(String(csv || '').split(/[,\s]+/).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];

export const isPublicMailDomain = (d: string) => PUBLIC_MAIL.has(String(d).toLowerCase());

/** Swappable for tests. */
export const dnsTxt = { resolve: (domain: string) => dns.resolveTxt(domain) };

/** Only the test suite may skip the DNS proof, and only when it says so. */
export const verificationSkipped = () => Boolean(process.env.VITEST) && process.env.SSO_DOMAIN_VERIFY === 'off';

/** Domains that another CLOR account has already proved. */
async function heldElsewhere(accountId: string, domains: string[]) {
  if (!domains.length) return [] as string[];
  /* Other accounts' providers, on purpose: a domain proved by one account cannot be claimed by another. */
  const rows = await outsideTenant('SSO: domains already proved by another account', () =>
    platformPrisma.authProvider.findMany({ where: { NOT: { accountId }, verifiedDomains: { not: null } }, select: { verifiedDomains: true } })
  );
  const taken = new Set(rows.flatMap((r) => domainsOf(r.verifiedDomains)));
  return domains.filter((d) => taken.has(d));
}

/** Why these domains cannot be named on a provider at all, or null. */
export async function domainProblem(accountId: string, csv: string | null | undefined) {
  const domains = domainsOf(csv);
  const bad = domains.filter((d) => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d));
  if (bad.length) return `Not a domain: ${bad.join(', ')}.`;
  const pub = domains.filter(isPublicMailDomain);
  if (pub.length) return `${pub.join(', ')} is a public mail service; a company can only claim its own domain.`;
  const taken = await heldElsewhere(accountId, domains);
  if (taken.length) return `${taken.join(', ')} is already verified by another CLOR account.`;
  return null;
}

/** Look for the TXT record on each domain; returns the ones proven. */
export async function checkDomains(accountId: string, token: string, csv: string | null | undefined) {
  const domains = domainsOf(csv);
  const taken = new Set(await heldElsewhere(accountId, domains));
  const results: Array<{ domain: string; verified: boolean; reason?: string }> = [];
  for (const domain of domains) {
    if (isPublicMailDomain(domain)) {
      results.push({ domain, verified: false, reason: 'public mail service' });
      continue;
    }
    if (taken.has(domain)) {
      results.push({ domain, verified: false, reason: 'verified by another CLOR account' });
      continue;
    }
    try {
      const records = (await dnsTxt.resolve(domain)).map((parts) => parts.join(''));
      const ok = records.some((r) => r.trim() === `${VERIFY_PREFIX}${token}`);
      results.push({ domain, verified: ok, ...(ok ? {} : { reason: 'TXT record not found yet' }) });
    } catch {
      results.push({ domain, verified: false, reason: 'no TXT records found' });
    }
  }
  return results;
}

/** The verified domains still named on the provider (a domain taken off loses its proof). */
export const keptVerified = (verified: string | null | undefined, csv: string | null | undefined) => {
  const named = new Set(domainsOf(csv));
  return domainsOf(verified).filter((d) => named.has(d)).join(',') || null;
};

/** Whether a provider may sign in this e-mail domain right now. */
export const providerSpeaksFor = (p: { emailDomains: string | null; verifiedDomains: string | null }, domain: string) =>
  domainsOf(p.emailDomains).includes(domain) && (verificationSkipped() || domainsOf(p.verifiedDomains).includes(domain));
