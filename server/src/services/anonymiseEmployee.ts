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
 *             logs, sign-in IP addresses, tags, HR notes, and documents other
 *             than contracts (offer/appointment/relieving letters) and payslips
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
    select: { id: true, name: true, code: true, status: true, dateOfLeaving: true, anonymisedAt: true },
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
        anonymisedAt: at,
      },
    });
    return {
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
