import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * The public handle for a company: the `agc` in `agc.books.clor.in`.
 *
 * Two identifiers, deliberately not one. The internal `id` is a cuid, is used
 * for every foreign key and every authorisation check, and never changes. The
 * slug is what a person types, reads in a URL and quotes to support — and it is
 * the one that will eventually need to change for somebody. Conflating them is
 * how renaming a company breaks its own foreign keys.
 *
 * Derived from the name, then editable. NOT the first three letters of the
 * name, which was the original idea and collides immediately: AGC Traders and
 * AGC Exports both give `agc`, and so does Agarwal Consultants. In a product
 * aimed at Indian SMEs, where a family of firms shares a prefix by design, that
 * is the first week rather than an edge case.
 */

/**
 * Names that must never become a tenant, because each is either already a
 * hostname we serve or one we will want. A tenant called `api` would take the
 * API's own subdomain.
 */
export const RESERVED_SLUGS = new Set([
  'www', 'api', 'app', 'apps', 'admin', 'administrator', 'root', 'system',
  'mail', 'email', 'smtp', 'imap', 'ftp', 'ns', 'ns1', 'ns2', 'mx',
  'static', 'assets', 'cdn', 'media', 'files', 'img', 'images',
  'status', 'health', 'metrics', 'monitor',
  'support', 'help', 'docs', 'doc', 'blog', 'news', 'about', 'legal', 'privacy', 'terms',
  'login', 'logout', 'signup', 'signin', 'register', 'auth', 'sso', 'oauth', 'account', 'accounts',
  'billing', 'pay', 'payment', 'payments', 'invoice', 'invoices', 'checkout', 'pricing',
  'books', 'clor', 'clor', 'test', 'dev', 'staging', 'demo', 'sandbox', 'internal',
  // Module names, so none of them can be taken before we can use them.
  'sales', 'purchase', 'purchases', 'inventory', 'reports', 'settings', 'crm', 'expenses', 'journals',
]);

export const SLUG_MIN = 3;
export const SLUG_MAX = 32;

/** Lowercase, alphanumerics and single hyphens, not starting or ending with one. */
export const normaliseSlug = (raw: string): string =>
  String(raw || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX);

/**
 * @returns null when the slug is usable, or the reason it is not — phrased for
 *   a person, because this is shown next to the field they are typing in.
 */
export const slugProblem = (slug: string): string | null => {
  const s = String(slug || '');
  if (s !== normaliseSlug(s)) return 'Use lowercase letters, numbers and hyphens only.';
  if (s.length < SLUG_MIN) return `At least ${SLUG_MIN} characters.`;
  if (s.length > SLUG_MAX) return `At most ${SLUG_MAX} characters.`;
  if (RESERVED_SLUGS.has(s)) return 'That name is reserved.';
  if (/^\d+$/.test(s)) return 'Use at least one letter.';
  return null;
};

/**
 * A slug that is free, derived from the name.
 *
 * Suffixes with a number only when it has to — and the caller should offer the
 * result for editing rather than accepting it silently, because `agc-traders-2`
 * is a URL somebody has to live with.
 */
export async function suggestSlug(name: string): Promise<string> {
  const base = normaliseSlug(name) || 'company';
  const seed = base.length >= SLUG_MIN ? base : `${base}-co`;

  for (let n = 0; n < 50; n += 1) {
    const candidate = n === 0 ? seed : `${seed}-${n + 1}`.slice(0, SLUG_MAX);
    if (slugProblem(candidate)) continue;
    const taken = await platformPrisma.org.findFirst({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  // Every reasonable derivation was taken; fall back to something certainly free.
  return `${seed.slice(0, SLUG_MAX - 7)}-${Date.now().toString(36).slice(-5)}`;
}

/**
 * @returns null when free, or the reason it cannot be used.
 * `exceptOrgId` lets an org keep its own slug when editing.
 */
export async function slugUnavailableReason(slug: string, exceptOrgId?: string): Promise<string | null> {
  const problem = slugProblem(slug);
  if (problem) return problem;
  const taken = await platformPrisma.org.findFirst({ where: { slug }, select: { id: true } });
  if (taken && taken.id !== exceptOrgId) return 'That name is already taken.';
  return null;
}
