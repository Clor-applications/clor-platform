import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';

/**
 * Which company is Explore's shared sample (services/sampleCompany.ts), for
 * the code that must treat it differently without loading the sample's own
 * machinery: the mailer sends it nothing, and the bell gives it no notices,
 * so the visitor starts with a clean bell and no made-up person is mailed.
 *
 * Kept apart from sampleCompany.ts on purpose: the mailer and notifications
 * are imported almost everywhere, and the sample builder imports almost
 * everything.
 */
export const SAMPLE_COMPANY_NAME = 'Sample Traders Pvt Ltd';
export const SAMPLE_OWNER_EMAIL = 'owner@sample-traders.example';

let sampleOrgId: string | null = null;
let checkedAt = 0;

/** Told by the sample builder the moment it knows (saves the first lookup). */
export const rememberSampleOrg = (orgId: string) => {
  sampleOrgId = orgId;
};

/** The sample company's id, or null while there is none (looked up at most once a minute until there is). */
export async function sampleOrgIdOrNull(): Promise<string | null> {
  if (sampleOrgId) return sampleOrgId;
  if (Date.now() - checkedAt < 60_000) return null;
  checkedAt = Date.now();
  try {
    const found = await outsideTenant('explore: which company is the sample', async () => {
      const owner = await platformPrisma.user.findFirst({ where: { email: SAMPLE_OWNER_EMAIL }, select: { accountId: true } });
      if (!owner?.accountId) return null;
      return platformPrisma.org.findFirst({ where: { accountId: owner.accountId, name: SAMPLE_COMPANY_NAME }, select: { id: true } });
    });
    if (found) sampleOrgId = found.id;
  } catch {
    /* unknown for now: treated as not the sample, asked again in a minute */
  }
  return sampleOrgId;
}

export async function isSampleOrg(orgId: string | null | undefined): Promise<boolean> {
  if (!orgId) return false;
  return (await sampleOrgIdOrNull()) === orgId;
}
