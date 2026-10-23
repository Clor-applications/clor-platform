import { createHash } from 'node:crypto';

import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { readerEventRetentionDays, punchLocationRetentionDays } from '../retention.js';

/**
 * The employee privacy notice for attendance, as the DPDP Act s.5 and the
 * DPDP Rules (rule 3) ask: on its own, in plain words, itemised — what data,
 * for what, on what basis, for how long, who else sees it, and how to use
 * each right and complain. Built from what the company has actually set up,
 * so it never promises what is not true (no "we keep no fingerprints" when
 * copying is on). Its version changes whenever its text does; the portal asks
 * people to read a new version.
 */
export const NOTICE_BASE_VERSION = '2026-10-19';

export type NoticeSection = { id: string; title: string; items: string[] };
export type PrivacyNotice = { version: string; company: string; contact: { name: string | null; email: string | null; phone: string | null }; sections: NoticeSection[] };

export async function privacyNoticeFor(orgId: string): Promise<PrivacyNotice> {
  const [org, settings, hr, hooks, fieldPeople] = await Promise.all([
    platformPrisma.org.findUnique({ where: { id: orgId }, select: { name: true } }),
    peoplePrisma.attendanceSettings.findUnique({ where: { orgId } }),
    peoplePrisma.hrConnection.findMany({ where: { orgId, enabled: true }, select: { name: true } }).catch(() => []),
    peoplePrisma.webhook.findMany({ where: { orgId, isActive: true }, select: { name: true } }).catch(() => []),
    peoplePrisma.employee.count({ where: { orgId, phonePunchMode: 'FIELD', mobilePunch: true } }).catch(() => 0),
  ]);
  const company = org?.name || 'Your employer';
  const contact = { name: settings?.privacyContactName || null, email: settings?.privacyContactEmail || null, phone: settings?.privacyContactPhone || null };
  const reach = [contact.name, contact.email, contact.phone].filter(Boolean).join(', ') || `${company}'s HR (the company has not named a contact yet)`;
  const copies = Boolean(settings?.biometricCopy);
  const shared = [...hr.map((h) => h.name), ...hooks.map((h) => h.name)];
  const months = (d: number) => `${Math.round(d / 30.4)} months`;

  const sections: NoticeSection[] = [
    {
      id: 'who',
      title: 'Who is responsible',
      items: [
        `${company} decides how your attendance data is used. Under the Digital Personal Data Protection Act, 2023 it is the Data Fiduciary.`,
        `CLOR runs the attendance system for ${company} and handles the data only on its instructions (a Data Processor). The data is stored in India.`,
        `Questions and complaints about your data: ${reach}.`,
      ],
    },
    {
      id: 'what',
      title: 'What is collected, and why',
      items: [
        'Your name, employee code, department, site and reader ID — to know whose punch is whose.',
        'Each punch: the time, which reader, in or out, and how you were recognised (finger, face, card) — to work out your attendance, leave and pay.',
        'Phone punches, only if HR switched them on for you: where you were at the moment you punched, how accurate that was, and a selfie if asked — to check you were at a work site. Your location is read only when you press Punch, never in between.',
        ...(fieldPeople
          ? ['Field punching, only for people HR set to it (for work away from the sites): a punch is accepted wherever you are, and the place and its address are recorded and shown to your manager and HR, who may need to approve it before it counts.']
          : []),
        copies
          ? 'Fingerprints and face: the readers hold them to recognise you. CLOR also keeps an encrypted copy so that being enrolled at one reader puts you on the company’s other readers. You can withdraw this at any time (below); your copies are then deleted.'
          : 'Fingerprints and face: only the readers hold them, to recognise you. CLOR keeps no copy.',
        'Requests you make (corrections, leave) and the decisions on them.',
      ],
    },
    {
      id: 'basis',
      title: 'On what basis',
      items: [
        'Attendance, leave and pay records: for the purposes of your employment (DPDP Act, section 7(i)), and to meet labour and wage laws.',
        `Phone location and selfies${copies ? ', and CLOR’s copies of your fingerprints and face' : ''}: your consent. Withdrawing it is as easy as giving it, and does not affect your job; you would then punch at a reader instead.`,
      ],
    },
    {
      id: 'how-long',
      title: 'How long it is kept',
      items: [
        'Punches and attendance days: while you work here, and afterwards for as long as labour, wage and tax laws require of the company.',
        `Selfies from phone punches: ${settings?.photoRetentionDays ?? 90} days. The location of a phone punch: ${months(punchLocationRetentionDays())}; the punch itself stays.`,
        `The original of what each reader sent: ${months(readerEventRetentionDays())}, as evidence if a punch is ever disputed.`,
        copies ? 'CLOR’s copies of your fingerprints and face: deleted when you leave, or when you withdraw.' : 'There are no CLOR copies of fingerprints or faces to keep.',
      ],
    },
    {
      id: 'shared',
      title: 'Who else sees it',
      items: [
        `${company}'s HR and the managers it allows.`,
        'CLOR’s staff, only to keep the system running and secure.',
        shared.length ? `Systems ${company} connected, which receive your punches: ${shared.join(', ')}.` : `${company} has not connected any other system to your attendance.`,
      ],
    },
    {
      id: 'rights',
      title: 'Your rights',
      items: [
        'See a summary of your data, and download it: in the portal under My data.',
        'Have something wrong corrected, or what is no longer needed erased: ask under My data. Records the law makes the company keep are kept until then.',
        'Withdraw consent (phone punches, fingerprint copies): under My data, or ask HR.',
        'Name someone to use these rights for you if you die or cannot act yourself: under My data.',
        `Complain: under My data or to ${reach}. You will have an answer within 30 days. If you are not satisfied, you can complain to the Data Protection Board of India.`,
        'Ask for this notice in English or in any language of the Eighth Schedule to the Constitution.',
      ],
    },
    {
      id: 'children',
      title: 'Under 18',
      items: ['If you are under 18, your location is never read for phone punches, and CLOR keeps no copy of your fingerprints or face.'],
    },
    {
      id: 'breach',
      title: 'If something goes wrong',
      items: [`If a breach affects your data, ${company} will tell you without delay: what happened, what it may mean for you, and what you can do. The Data Protection Board is told as the law requires.`],
    },
  ];
  const version = `${NOTICE_BASE_VERSION}.${createHash('sha256').update(JSON.stringify({ company, contact, sections })).digest('hex').slice(0, 8)}`;
  return { version, company, contact, sections };
}
