import bcrypt from 'bcrypt';

import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { assignOrgCode } from './displayCodes.js';
import { sendTemplate } from './mailer.js';
import { CODE_TTL_MS, formatCode, newActivationCode } from './attendance/portal.js';

/**
 * Employee app activation codes, shared by Attendance's Employee Portal
 * Access screen (routes/portalAdmin.ts) and People's bulk "Send employee app
 * access" (services/people/lifecycle/appAccess.ts). One code per person,
 * kept only as a bcrypt hash; good for CODE_TTL_MS.
 */

/** Where the employee portal is: PORTAL_URL (https://attendance.clor.in/#/portal in production), else the app's own address. */
export const portalUrl = () => process.env.PORTAL_URL || `${process.env.APP_URL || 'http://localhost:5173'}/#/portal`;

/** The company code people sign in with; given now if the company has none yet. */
export async function companyCode(accountId: string, orgId: string) {
  const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { code: true, name: true } });
  return { name: org?.name || '', code: org?.code || (await assignOrgCode(accountId, orgId, org?.name || 'Company')) };
}

/** The link that opens the portal with the company and employee code filled in. */
export const activationLink = (company: string, employeeCode: string) => `${portalUrl()}?c=${encodeURIComponent(company)}&e=${encodeURIComponent(employeeCode)}`;

/** A fresh code for one person: switches the portal on and replaces any unused code. Returns the code in clear, once. */
export async function issueCode(employeeId: string, expires = new Date(Date.now() + CODE_TTL_MS)) {
  const code = newActivationCode();
  await peoplePrisma.employee.update({ where: { id: employeeId }, data: { portalEnabled: true, portalSetupHash: await bcrypt.hash(code, 10), portalSetupExpires: expires } });
  return { code, formatted: formatCode(code), expires };
}

/** The activation e-mail. Throws if it could not be queued. */
export async function emailCode(opts: { accountId: string; orgId: string; to: string; person: { id: string; name: string; code: string; mobilePunch?: boolean | null }; company: { name: string; code: string }; formatted: string; expires: Date }) {
  await sendTemplate({
    templateKey: 'attendance.portal_invite',
    to: opts.to,
    toName: opts.person.name,
    accountId: opts.accountId,
    orgId: opts.orgId,
    relatedType: 'Employee',
    relatedId: opts.person.id,
    data: {
      employeeName: opts.person.name,
      orgName: opts.company.name,
      /* Company and employee code filled in when they open it. */
      portalUrl: activationLink(opts.company.code, opts.person.code),
      companyCode: opts.company.code,
      employeeCode: opts.person.code,
      activationCode: opts.formatted,
      expires: opts.expires.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }),
      phoneLine: opts.person.mobilePunch ? ', and punching in and out from your phone' : '',
    },
  });
}
