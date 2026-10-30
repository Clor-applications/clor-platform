import { Prisma } from '../generated/people/index.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';

/**
 * Anonymise a former employee (LX-07, DPDP Act s.8(7) and s.12).
 *
 * Erasure, minus what other laws make the company keep. Labour, tax and PF law
 * require attendance registers, wages and statutory numbers to be kept for
 * years after someone leaves, so those stay — under the person's name and
 * code, because a register an inspector cannot read is no register — until
 * their retention period ends (a separate, scheduled purge). Everything else
 * personal goes now, in one transaction:
 *
 *   erased    contact details, home address, emergency contact, date of birth,
 *             gender, marital status, photo, guardian, notes, reader PIN, card
 *             and password, portal sign-in, CLOR-held fingerprint and face
 *             templates, punch selfies, phone-punch locations and failed-punch
 *             logs, sign-in IP addresses, tags, HR notes, documents other
 *             than contracts (offer/appointment/relieving letters) and payslips,
 *             the free text on their register entries (HR cases, goals,
 *             training, the candidate record they were hired from), checklist
 *             notes, the text of their privacy requests, and the reasons on
 *             their history and stints (docs/people/02-PRD.md PRV-04)
 *   kept      name, employee code, joining and leaving dates, department and
 *             designation, attendance days and punch times, leave, overtime,
 *             payroll and statutory numbers (Payroll), contracts and payslips
 *
 * Only for someone who has left: anonymising a current employee would break
 * their attendance tomorrow. Not reversible.
 *
 * Templates already copied onto physical readers are not reached from here;
 * the reader's own user must be removed on the reader (stated in the result).
 */

/** Document kinds kept as employment and wage records; every other kind is erased. */
export const KEPT_DOCUMENT_KINDS = ['CONTRACT', 'PAYSLIP'] as const;

export class AnonymiseError extends Error {
  constructor(message: string, public status = 400, public code = 'ANONYMISE_REFUSED') {
    super(message);
  }
}

export type AnonymiseResult = {
  employeeId: string;
  name: string;
  code: string | null;
  anonymisedAt: string;
  erased: Record<string, number>;
  kept: string[];
  readerNote: string;
};

export async function anonymiseEmployee(args: { accountId: string; orgId: string; employeeId: string }): Promise<AnonymiseResult> {
  const { accountId, orgId, employeeId } = args;
  const e = await peoplePrisma.employee.findFirst({
    where: { id: employeeId, accountId, orgId },
    select: { id: true, name: true, code: true, status: true, dateOfLeaving: true, anonymisedAt: true, email: true, personalEmail: true, workEmail: true, phone: true, workPhone: true },
  });
  if (!e) throw new AnonymiseError('No such employee.', 404, 'NOT_FOUND');
  if (e.anonymisedAt) throw new AnonymiseError(`${e.name} was already anonymised on ${e.anonymisedAt.toISOString().slice(0, 10)}.`, 409, 'ALREADY_ANONYMISED');
  if (e.status !== 'LEFT') {
    throw new AnonymiseError(`${e.name} still works here. Record their leaving (Resignations) first; then their data can be anonymised.`, 409, 'STILL_EMPLOYED');
  }

  const at = new Date();
  const where = { accountId, orgId, employeeId };
  const erased = await peoplePrisma.$transaction(async (tx) => {
    const [templates, photos, notes, tags, documents, attempts] = await Promise.all([
      tx.biometricTemplate.deleteMany({ where }),
      tx.punchPhoto.deleteMany({ where }),
      tx.employeeNote.deleteMany({ where }),
      tx.employeeTagLink.deleteMany({ where }),
      tx.employeeDocument.deleteMany({ where: { ...where, kind: { notIn: [...KEPT_DOCUMENT_KINDS] } } }),
      tx.phonePunchAttempt.deleteMany({ where }),
      /* Their notes and documents sitting in the recycle bin go too, or the erasure would wait 30 days. */
      tx.deletedItem.deleteMany({ where: { orgId, kind: { in: ['employeeNote', 'employeeDocument'] }, snapshot: { path: ['row', 'employeeId'], equals: employeeId } } }),
    ]);
    const punchLocations = await tx.devicePunch.updateMany({
      where: { ...where, OR: [{ latitude: { not: null } }, { address: { not: null } }, { photoId: { not: null } }] },
      data: { latitude: null, longitude: null, accuracyM: null, address: null, photoId: null },
    });
    const signInIps = await tx.attendanceActivity.updateMany({ where: { ...where, ip: { not: null } }, data: { ip: null } });
    /*
     * Register entries (PRV-04): the HR cases, goals and training on their
     * file, and the candidate record they were hired from. Those are linked
     * by employeeId; a candidate record from before the hire may not be, so
     * any entry whose details carry their address or number goes too. The
     * row stays (it is part of the company's record), its free text does not.
     */
    const contacts = [e.email, e.personalEmail, e.workEmail, e.phone, e.workPhone].filter((v): v is string => Boolean(v && v.trim()));
    const linked = await tx.peopleRecord.findMany({ where: { accountId, orgId, employeeId }, select: { id: true } });
    const byContact = contacts.length
      ? await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "PeopleRecord" WHERE "orgId" = ${orgId} AND (${Prisma.join(contacts.map((c) => Prisma.sql`"details"::text ILIKE ${'%' + c + '%'}`), ' OR ')})`
      : [];
    const recordIds = [...new Set([...linked.map((r) => r.id), ...byContact.map((r) => r.id)])];
    const registers = recordIds.length
      ? await tx.peopleRecord.updateMany({ where: { id: { in: recordIds }, orgId }, data: { details: { anonymised: true }, updatedBy: 'anonymise' } })
      : { count: 0 };
    await tx.peopleRecord.updateMany({ where: { id: { in: recordIds }, orgId, kind: 'candidates' }, data: { title: 'Anonymised' } });
    /* Talent: their candidate card (linked, or with their e-mail or phone), and the free text about them in goals, reviews, plans, one-on-ones and certificates. */
    const asCandidate = await tx.candidate.findMany({ where: { orgId, OR: [{ employeeId }, ...(contacts.length ? [{ email: { in: contacts } }, { phone: { in: contacts } }] : [])] }, select: { id: true } });
    if (asCandidate.length) {
      const ids = asCandidate.map((c) => c.id);
      await tx.candidate.updateMany({ where: { orgId, id: { in: ids } }, data: { name: 'Anonymised', email: null, phone: null, sourceDetail: null, currentEmployer: null, resumeName: null, resumeMime: null, resumeSize: null, resumeData: null, resumeUrl: null, closedReason: null, anonymisedAt: new Date() } });
      await tx.candidateEvent.updateMany({ where: { orgId, candidateId: { in: ids } }, data: { text: null } });
      await tx.interviewFeedback.updateMany({ where: { orgId, candidateId: { in: ids } }, data: { notes: null } });
    }
    /* Referrals about them (as the friend referred) and by them: the contact keys and the free text go; who referred whom and the bonus stay. */
    await tx.referral.updateMany({ where: { orgId, OR: [{ referrerEmployeeId: employeeId }, ...(asCandidate.length ? [{ candidateId: { in: asCandidate.map((c) => c.id) } }] : [])] }, data: { phoneKey: null, emailKey: null, note: null, relation: null } });
    const goalIds = (await tx.goal.findMany({ where, select: { id: true } })).map((g) => g.id);
    await tx.goal.updateMany({ where, data: { description: null } });
    if (goalIds.length) await tx.goalCheckIn.updateMany({ where: { orgId, goalId: { in: goalIds } }, data: { note: null } });
    await tx.review.updateMany({ where, data: { selfText: null, managerText: null, finalReason: null } });
    const planIds = (await tx.improvementPlan.findMany({ where, select: { id: true } })).map((p) => p.id);
    await tx.improvementPlan.updateMany({ where, data: { reason: '[erased]', expectations: '[erased]', outcomeNote: null } });
    if (planIds.length) await tx.talentNote.deleteMany({ where: { orgId, subject: 'PLAN', subjectId: { in: planIds } } });
    await tx.oneOnOne.updateMany({ where: { orgId, OR: [{ employeeId }, { managerEmployeeId: employeeId }] }, data: { notes: null, actions: null } });
    await tx.trainingSeat.updateMany({ where, data: { certName: null, certMime: null, certSize: null, certData: null, certUrl: null } });
    const checklistNotes = await tx.checklistTask.updateMany({ where: { ...where, note: { not: null } }, data: { note: null } });
    const dataRequests = await tx.dataRequest.updateMany({ where: { ...where, details: { not: '[erased]' } }, data: { details: '[erased]' } });
    const historyNotes = await tx.employmentEvent.updateMany({ where: { ...where, note: { not: null } }, data: { note: null } });
    await tx.employmentEpisode.updateMany({ where: { ...where, endReason: { not: null } }, data: { endReason: null } });
    await tx.employee.update({
      where: { id: employeeId },
      data: {
        email: null,
        phone: null,
        personalEmail: null,
        workEmail: null,
        workPhone: null,
        photoUrl: null,
        addressLine: null,
        city: null,
        state: null,
        country: null,
        pincode: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        emergencyContactRelation: null,
        dateOfBirth: null,
        gender: null,
        maritalStatus: null,
        guardianName: null,
        notes: null,
        devicePin: null,
        cardNumber: null,
        devicePassword: null,
        portalEnabled: false,
        portalPasswordHash: null,
        portalPasswordSetAt: null,
        portalSetupHash: null,
        portalSetupExpires: null,
        mobilePunch: false,
        leavingReason: null,
        anonymisedAt: at,
      },
    });
    return {
      registers: registers.count,
      checklistNotes: checklistNotes.count,
      dataRequests: dataRequests.count,
      historyNotes: historyNotes.count,
      biometricTemplates: templates.count,
      punchSelfies: photos.count,
      hrNotes: notes.count,
      tags: tags.count,
      documents: documents.count,
      failedPhonePunches: attempts.count,
      punchLocations: punchLocations.count,
      signInAddresses: signInIps.count,
    };
  });

  return {
    employeeId: e.id,
    name: e.name,
    code: e.code,
    anonymisedAt: at.toISOString(),
    erased,
    kept: ['name and employee code', 'joining and leaving dates', 'department and designation', 'attendance days and punch times', 'leave and overtime', 'payroll and statutory numbers', 'contracts and payslips'],
    readerNote: 'Fingerprints and faces already on the readers stay there until the person is removed from each reader.',
  };
}
