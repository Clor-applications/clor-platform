import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { trackFirst } from '../productEvents.js';
import { FACE, admsField, FINGER, SEQ, addFinger, removalCommandsFor, templateCommands, userCommandFor, type Template } from './adms.js';
import { biometricPolicy, openTemplate, sealTemplate, sendableWhere } from './biometrics.js';
import { vendorsWith } from './drivers.js';
import { pinMatcher, recomputeDeviceDay, shiftDayFor } from './punches.js';

/**
 * People and their fingerprints and faces on readers: what each reader holds, and the commands that put people on (or take them off) the readers they belong on.
 *
 * Moved out of routes/iclock.ts, the ZKTeco ADMS route, so that every reader
 * channel, the portal, scheduling and payroll call a service instead of a
 * route file. Behaviour is unchanged.
 */

// ---------------------------------------------------------------------------
// Users and fingerprints / faces
// ---------------------------------------------------------------------------

type Device = { id: string; accountId: string; orgId: string; serialNumber: string; vendor?: string | null; areaId?: string | null; faceSupported?: boolean | null; fingerSupported?: boolean | null; faceMajorVer?: number | null; faceMinorVer?: number | null };

/**
 * Which readers someone belongs on. A reader given an area (a site) takes only
 * that area's staff, so a 40-site company does not fill every gate with every
 * employee; a reader with no area takes everyone. Someone with no area goes
 * to every reader — nobody is locked out by a field left blank.
 */
export const servesArea = (reader: { areaId?: string | null }, areaId: string | null | undefined) => !reader.areaId || !areaId || reader.areaId === areaId;

/** What a reader holds for a person, as it changes: from what the reader sends and from commands it confirms. */
export async function markOnReader(device: { id: string; accountId: string; orgId: string }, pin: string, change: { user?: boolean; name?: string | null; finger?: number; face?: boolean; clearFingers?: boolean; remove?: boolean }) {
  const key = { deviceId_pin: { deviceId: device.id, pin } };
  if (change.remove) {
    await peoplePrisma.deviceUser.deleteMany({ where: { deviceId: device.id, pin } });
    return;
  }
  const existing = await peoplePrisma.deviceUser.findUnique({ where: key, select: { fingers: true } });
  const data: any = {
    ...(change.name ? { name: change.name.slice(0, 120) } : {}),
    ...(change.finger !== undefined ? { fingers: addFinger(existing?.fingers || '', change.finger) } : {}),
    ...(change.clearFingers ? { fingers: '' } : {}),
    ...(change.face !== undefined ? { face: change.face } : {}),
  };
  await peoplePrisma.deviceUser.upsert({ where: key, create: { accountId: device.accountId, orgId: device.orgId, deviceId: device.id, pin, ...data }, update: data });
}

export async function storeUser(device: Device, u: { pin: string; name: string | null; privilege: number | null; password: string | null; card: string | null }) {
  const pin = u.pin.slice(0, 40);
  await keepUser(device, pin, u);
  await adoptReaderUser(device, pin, u);
}

/** A name CLOR gave someone it only knew from a reader, until the reader says who they are. */
export const READER_PLACEHOLDER = 'Reader user ';

/**
 * Sync from the reader into CLOR (ClorTime processBiodataLine): someone added
 * at a reader whose ID matches no employee becomes one — named as the reader
 * names them, with the ID as their employee code — and the punches they have
 * already made are theirs. Someone CLOR knows keeps CLOR's details; a
 * placeholder name and an empty card are filled from the reader.
 */
async function adoptReaderUser(device: Device, pin: string, u: { name: string | null; card: string | null }) {
  const match = await pinMatcher(device.orgId);
  const known = match(pin, device.areaId);
  const name = String(u.name || '').trim().slice(0, 120);
  if (known) {
    const e = await peoplePrisma.employee.findUnique({ where: { id: known.id }, select: { name: true, cardNumber: true } });
    const data: any = {};
    if (name && e?.name.startsWith(READER_PLACEHOLDER)) data.name = name;
    if (u.card && u.card !== '0' && !e?.cardNumber) data.cardNumber = String(u.card).slice(0, 40);
    if (Object.keys(data).length) await peoplePrisma.employee.update({ where: { id: known.id }, data });
    return;
  }
  const settings = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId: device.orgId }, select: { readerUsersBecomeEmployees: true } });
  if (settings && !settings.readerUsersBecomeEmployees) return;
  let employee;
  try {
    employee = await peoplePrisma.employee.create({
      data: {
        accountId: device.accountId,
        orgId: device.orgId,
        code: pin,
        name: name || `${READER_PLACEHOLDER}${pin}`,
        status: 'ACTIVE',
        ...(u.card && u.card !== '0' ? { cardNumber: String(u.card).slice(0, 40) } : {}),
        createdByUserId: 'reader',
      } as any,
    });
  } catch {
    /* Two readers reporting the same new person at once: the other one made it. */
    return;
  }
  void trackFirst(device.orgId, 'system', 'employee_added', { source: 'reader', app: 'attendance' });
  await attachPunchesTo(device.accountId, device.orgId, employee, pin);
  await peoplePrisma.biometricTemplate.updateMany({ where: { orgId: device.orgId, scope: '', pin, employeeId: null }, data: { employeeId: employee.id } });
  /* …and on to the company's other readers. */
  const others = (await peoplePrisma.attendanceDevice.findMany({ where: { orgId: device.orgId, isActive: true, vendor: { in: vendorsWith('templates') }, id: { not: device.id } }, select: { id: true } })).length;
  if (others) await pushEmployeeToReaders(device.orgId, employee, null, undefined, device.id);
}

/**
 * Punches already made under a reader ID now belong to this employee: each is
 * given its shift day and the days are worked out. (Matching by hand, and a
 * reader user becoming an employee, both end here.)
 */
export async function attachPunchesTo(accountId: string, orgId: string, employee: { id: string; branchId: string | null; areaId?: string | null }, pin: string, siteAreaId?: string | null) {
  /* A site ID claims only the punches made on that site's readers. */
  const readers = siteAreaId ? (await peoplePrisma.attendanceDevice.findMany({ where: { orgId, areaId: siteAreaId }, select: { id: true } })).map((d) => d.id) : null;
  const punches = await peoplePrisma.devicePunch.findMany({ where: { orgId, pin, employeeId: null, ...(readers ? { deviceId: { in: readers } } : {}) }, select: { id: true, localTime: true } });
  const days = new Set<string>();
  for (const p of punches) {
    const shiftDate = await shiftDayFor(orgId, employee.id, p.localTime);
    await peoplePrisma.devicePunch.update({ where: { id: p.id }, data: { employeeId: employee.id, shiftDate } });
    days.add(shiftDate);
  }
  for (const date of days) await recomputeDeviceDay(accountId, orgId, employee, date);
  return { matched: punches.length, days: days.size };
}

async function keepUser(device: Device, pin: string, u: { name: string | null; privilege: number | null; password: string | null; card: string | null }) {
  const fields = {
    ...(u.name !== null ? { name: u.name.slice(0, 120) } : {}),
    ...(u.privilege !== null ? { privilege: u.privilege } : {}),
    ...(u.password !== null ? { password: u.password.slice(0, 40) } : {}),
    ...(u.card !== null ? { card: u.card.slice(0, 40) } : {}),
  };
  await peoplePrisma.deviceUser.upsert({
    where: { deviceId_pin: { deviceId: device.id, pin } },
    create: { accountId: device.accountId, orgId: device.orgId, deviceId: device.id, pin, ...fields },
    update: fields,
  });
}

/**
 * The user record to send with a template: the name and card as the reader it
 * came from holds them, else the employee's. Administrator rights and the door
 * PIN only ever come from CLOR's employee file: a reader is known by its serial
 * number alone, so what "a reader" reports must never become admin rights or a
 * known door PIN on every other reader of the company.
 */
async function userFor(orgId: string, pin: string, preferDeviceId?: string, match?: Awaited<ReturnType<typeof pinMatcher>>, areaId?: string | null) {
  const held = await peoplePrisma.deviceUser.findMany({ where: { orgId, pin }, orderBy: { updatedAt: 'desc' } });
  const u = held.find((h) => h.deviceId === preferDeviceId) || held[0];
  const emp = (match ?? (await pinMatcher(orgId)))(pin, areaId);
  const file = emp
    ? await peoplePrisma.employee.findUnique({ where: { id: emp.id }, select: { name: true, cardNumber: true, devicePassword: true, devicePrivilege: true } })
    : null;
  return {
    name: u?.name || file?.name || 'Unknown',
    privilege: file?.devicePrivilege ?? 0,
    password: file?.devicePassword ?? '',
    card: file?.cardNumber || u?.card || '',
  };
}

/**
 * A user record still waiting for a reader is replaced by a newer one, so the
 * latest name, card and PIN win (a record queued when the employee was created
 * must not stand in for the one carrying the card a reader enrolled later).
 * Ones already sent are left alone.
 */
const supersedeUserInfo = (deviceId: string, pin: string) =>
  peoplePrisma.deviceCommand.deleteMany({ where: { deviceId, status: 'PENDING', OR: [{ command: { startsWith: `DATA UPDATE USERINFO PIN=${admsField(pin)}\t` } }, { command: { startsWith: `config-id=10 user-id=${pin} ` } }] } });

/* Templates travel only between ADMS readers; a Matrix controller enrols at the door. */
const supports = (target: Device, type: number) =>
  target.vendor !== 'MATRIX_COSEC' && !(type === FACE && target.faceSupported === false) && !(type === FINGER && target.fingerSupported === false);

/**
 * Queue one person's templates onto one reader: their user record first
 * (unless one is already on its way), then each template in order.
 */
async function queueOnto(target: Device, pin: string, templates: Template[], user: Awaited<ReturnType<typeof userFor>>, createdByUserId: string | null) {
  const usable = templates.filter((t) => supports(target, t.type));
  if (!usable.length) return 0;
  const userCmd = userCommandFor(target.vendor, pin, user.name, user);
  await supersedeUserInfo(target.id, pin);
  const rows = [{ seq: SEQ.USER, command: userCmd }, ...usable.flatMap((t) => templateCommands(t, target))];
  await peoplePrisma.deviceCommand.createMany({
    data: rows.map((r) => ({ accountId: target.accountId, orgId: target.orgId, deviceId: target.id, serialNumber: target.serialNumber, command: r.command, sequence: r.seq, createdByUserId })),
  });
  return rows.length;
}

const otherReaders = (source: { orgId: string; id: string }) =>
  peoplePrisma.attendanceDevice.findMany({ where: { orgId: source.orgId, isActive: true, id: { not: source.id } } });

/**
 * A template a reader just enrolled (or changed) goes to every other reader of
 * the company, so a person enrolled once is recognised everywhere (ClorTime
 * syncTemplateToOtherDevices). Unchanged templates are not re-sent: a reader
 * asked for its templates would otherwise bounce every copy back round.
 */
export async function storeTemplate(device: Device, t: Template, match: Awaited<ReturnType<typeof pinMatcher>>) {
  const pin = t.pin.slice(0, 40);
  const emp = match(pin, device.areaId);
  /* A site ID's fingerprints are kept apart from the same number elsewhere in the company. */
  const scope = match.isSiteId(pin, device.areaId) ? String(device.areaId) : '';
  /* The face algorithm this reader runs, learnt from what it sends. */
  if (t.type === FACE && t.majorVer > 0 && (device.faceMajorVer !== t.majorVer || device.faceMinorVer !== t.minorVer)) {
    await peoplePrisma.attendanceDevice.update({ where: { id: device.id }, data: { faceMajorVer: t.majorVer, faceMinorVer: t.minorVer || null, faceSupported: true } });
  }
  /* This reader certainly has it, whatever CLOR may keep. */
  if (t.type === FINGER) await markOnReader(device, pin, { finger: t.no });
  else if (t.type === FACE) await markOnReader(device, pin, { face: true });
  /* DPDP: a copy only when the company switched copying on, and never for someone who withdrew or is under 18. */
  const policy = await biometricPolicy(device.orgId);
  if (!policy.allows(emp?.id)) return;
  const key = { orgId_scope_pin_type_no: { orgId: device.orgId, scope, pin, type: t.type, no: t.no } };
  const existing = await peoplePrisma.biometricTemplate.findUnique({ where: key, select: { data: true } });
  const changed = !existing || openTemplate(existing.data) !== t.data;
  const values = { data: sealTemplate(t.data), valid: t.valid, duress: t.duress, majorVer: t.majorVer, minorVer: t.minorVer, format: t.format, indexNo: t.indexNo, sourceDeviceId: device.id, employeeId: emp?.id ?? null };
  await peoplePrisma.biometricTemplate.upsert({
    where: key,
    create: { accountId: device.accountId, orgId: device.orgId, scope, pin, type: t.type, no: t.no, ...values },
    update: values,
  });
  if (!changed) return;
  for (const target of await otherReaders(device)) {
    if (emp) {
      /* A known person goes to the readers that serve them, under the ID they have on each. */
      if (!servesArea(target, emp.areaId)) continue;
      const there = match.pinFor(emp, target.areaId);
      if (!there) continue;
      await queueOnto(target, there, [{ ...t, pin: there }], await userFor(device.orgId, there, there === pin ? device.id : undefined, match, target.areaId), null);
    } else if (!scope && !match(pin, target.areaId)) {
      /* An ID nobody has yet travels as it is, but never onto a reader where that number is someone else. */
      await queueOnto(target, pin, [{ ...t, pin }], await userFor(device.orgId, pin, device.id, match, target.areaId), null);
    }
  }
}

/**
 * Put one person on one reader as CLOR has them: their user record (card from
 * the employee file, else as a reader holds it; door PIN and privilege from the
 * employee file only — see userFor) and whichever of their fingerprints and
 * face this reader lacks.
 */
export async function sendPersonTo(target: Device, employee: { name: string; cardNumber?: string | null; devicePassword?: string | null; devicePrivilege?: number | null }, pin: string, templates: Template[], createdByUserId: string | null) {
  const held = await peoplePrisma.deviceUser.findFirst({ where: { orgId: target.orgId, pin }, orderBy: { updatedAt: 'desc' } });
  const rows = [
    {
      seq: SEQ.USER as number,
      command: userCommandFor(target.vendor, pin, employee.name, {
        privilege: employee.devicePrivilege ?? 0,
        password: employee.devicePassword ?? '',
        card: employee.cardNumber ?? held?.card ?? '',
      }),
    },
    ...templates.filter((t) => supports(target, t.type)).flatMap((t) => templateCommands({ ...t, pin }, target)),
  ];
  await supersedeUserInfo(target.id, pin);
  await peoplePrisma.deviceCommand.createMany({
    data: rows.map((r) => ({ accountId: target.accountId, orgId: target.orgId, deviceId: target.id, serialNumber: target.serialNumber, command: r.command, sequence: r.seq, createdByUserId })),
  });
  return rows.length;
}

export { supports as readerSupports };

/** Copy every stored template of people still employed (and of reader IDs not yet matched) onto one reader. */
export async function copyAllTemplatesTo(target: Device, createdByUserId: string | null) {
  const policy = await biometricPolicy(target.orgId);
  const templates = await peoplePrisma.biometricTemplate.findMany({ where: { orgId: target.orgId, scope: { in: ['', target.areaId || ''] }, ...sendableWhere(policy) }, orderBy: [{ pin: 'asc' }, { type: 'asc' }, { no: 'asc' }] });
  const people = await peoplePrisma.employee.findMany({ where: { orgId: target.orgId }, select: { id: true, status: true, areaId: true, devicePin: true, code: true } });
  const byId = new Map(people.map((e) => [e.id, e]));
  const left = new Set(people.filter((e) => e.status === 'LEFT').map((e) => e.id));
  const elsewhere = new Set(people.filter((e) => !servesArea(target, e.areaId)).map((e) => e.id));
  const match = await pinMatcher(target.orgId);
  /* One set per person (a person may have prints stored under a company and a site ID), else per unknown ID. */
  const groups = new Map<string, { pin: string; list: Map<string, Template> }>();
  for (const t of templates) {
    if (t.employeeId && (left.has(t.employeeId) || elsewhere.has(t.employeeId))) continue;
    const emp = t.employeeId ? byId.get(t.employeeId) : null;
    const pin = emp ? match.pinFor(emp, target.areaId) : t.pin;
    if (!pin || (!emp && match(t.pin, target.areaId))) continue;
    const k = emp ? `e:${emp.id}` : `p:${t.pin}`;
    if (!groups.has(k)) groups.set(k, { pin, list: new Map() });
    const g = groups.get(k)!;
    const slot = `${t.type}|${t.no}`;
    if (!g.list.has(slot) || t.scope) g.list.set(slot, { ...t, pin });
  }
  let commands = 0;
  for (const g of groups.values()) commands += await queueOnto(target, g.pin, [...g.list.values()], await userFor(target.orgId, g.pin, undefined, match, target.areaId), createdByUserId);
  return { people: groups.size, commands };
}

/**
 * Someone left: take them off every reader (templates, then the user) and
 * delete their stored fingerprints and faces — door access ends with
 * employment, and biometric data is not kept longer than it is needed.
 */
export async function revokeFromReaders(orgId: string, employee: { id: string; code: string | null; devicePin: string | null }, createdByUserId: string | null) {
  const match = await pinMatcher(orgId);
  const templates = await peoplePrisma.biometricTemplate.findMany({ where: { orgId, employeeId: employee.id }, select: { pin: true, scope: true } });
  const readers = await peoplePrisma.attendanceDevice.findMany({ where: { orgId, isActive: true } });
  /* On each reader, only the IDs that are this person there: at another site the same number may be someone else. */
  const pinsAt = new Map<string, Set<string>>();
  for (const r of readers) {
    const set = new Set<string>();
    const own = match.pinFor(employee, r.areaId);
    if (own) set.add(own);
    for (const t of templates) if ((t.scope === '' || t.scope === r.areaId) && (match(t.pin, r.areaId)?.id ?? employee.id) === employee.id) set.add(t.pin);
    pinsAt.set(r.id, set);
  }
  const all = new Set([...pinsAt.values()].flatMap((x) => [...x]));
  if (!all.size) return { readers: 0, pins: 0 };
  /*
   * Anything still waiting to go to a reader for them goes first: the removals
   * below are handed out before fingerprint copies (lower sequence), so a copy
   * left in the queue would put a leaver's fingerprint back after removal.
   */
  const waiting = await peoplePrisma.deviceCommand.findMany({ where: { orgId, status: 'PENDING' }, select: { id: true, deviceId: true, command: true } });
  const pinOf = (c: string) => /\b(?:PIN|Pin)=([^\t]*)/.exec(c)?.[1] ?? /\buser-id=([^ ]+)/.exec(c)?.[1] ?? '';
  const theirs = waiting.filter((c) => pinsAt.get(c.deviceId)?.has(pinOf(c.command))).map((c) => c.id);
  if (theirs.length) await peoplePrisma.deviceCommand.deleteMany({ where: { id: { in: theirs } } });
  for (const r of readers) {
    const pins = [...(pinsAt.get(r.id) || [])];
    if (!pins.length) continue;
    await peoplePrisma.deviceCommand.createMany({
      data: pins.flatMap((pin) => removalCommandsFor(r.vendor, pin).map((command) => ({ accountId: r.accountId, orgId, deviceId: r.id, serialNumber: r.serialNumber, command, sequence: SEQ.USER, createdByUserId }))),
    });
    await peoplePrisma.deviceUser.deleteMany({ where: { orgId, deviceId: r.id, pin: { in: pins } } });
  }
  const company = String(employee.devicePin || employee.code || '').trim();
  await peoplePrisma.biometricTemplate.deleteMany({ where: { orgId, OR: [{ employeeId: employee.id }, ...(company ? [{ employeeId: null, scope: '', pin: company }] : [])] } });
  return { readers: readers.length, pins: all.size };
}

/**
 * Someone's ID at one site changed (a site ID given, changed or taken away):
 * that site's readers drop the ID they knew them by and get them under the new
 * one, with their fingerprints and face. `oldPin` is the ID they had there.
 */
export async function moveIdAtSite(orgId: string, employeeId: string, areaId: string, oldPin: string, createdByUserId: string | null) {
  const match = await pinMatcher(orgId);
  const emp = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId } });
  if (!emp) return { readers: 0 };
  const pin = match.pinFor(emp, areaId);
  const readers = await peoplePrisma.attendanceDevice.findMany({ where: { orgId, areaId, isActive: true, vendor: { in: vendorsWith('users') } } });
  const stored = (await biometricPolicy(orgId)).allows(employeeId) ? await peoplePrisma.biometricTemplate.findMany({ where: { orgId, employeeId }, orderBy: [{ type: 'asc' }, { no: 'asc' }] }) : [];
  const templates = [...new Map(stored.map((t) => [`${t.type}|${t.no}`, t])).values()];
  for (const r of readers) {
    if (oldPin && oldPin !== pin) {
      await peoplePrisma.deviceCommand.createMany({
        data: removalCommandsFor(r.vendor, oldPin).map((command) => ({ accountId: r.accountId, orgId, deviceId: r.id, serialNumber: r.serialNumber, command, sequence: SEQ.USER, createdByUserId })),
      });
      await peoplePrisma.deviceUser.deleteMany({ where: { orgId, deviceId: r.id, pin: oldPin } });
    }
    if (pin && emp.status !== 'LEFT' && servesArea(r, emp.areaId)) await sendPersonTo(r, emp, pin, templates.map((t) => ({ ...t, pin })), createdByUserId);
  }
  return { readers: readers.length };
}

/** Did anything a reader holds change: the ID, name, card, PIN or privilege? */
export const readerFieldsChanged = (before: any, after: any) =>
  ['code', 'devicePin', 'name', 'cardNumber', 'devicePassword', 'devicePrivilege', 'areaId'].some((k) => (before?.[k] ?? null) !== (after?.[k] ?? null)) ||
  (before?.status === 'LEFT' && after?.status !== 'LEFT');

/**
 * Put one employee on every reader of the company (ClorTime: POST/PUT
 * /api/employees and rehire queue DATA UPDATE USERINFO to all readers). Their
 * Reader ID, else their employee code. A card not set in CLOR is taken from
 * what a reader already holds, so pushing never wipes one enrolled at a reader.
 * If their ID changed, the old ID is taken off the readers first.
 */
export async function pushEmployeeToReaders(orgId: string, employee: any, createdByUserId: string | null, before?: any, skipDeviceId?: string) {
  const match = await pinMatcher(orgId);
  /* The ID they have on each reader: a site ID there, else the company one (services/attendance/readerIds.ts). */
  const pinAt = (r: { areaId?: string | null }) => match.pinFor(employee, r.areaId);
  const oldAt = (r: { areaId?: string | null }) => (before ? match.pinFor(before, r.areaId) : '');
  const all = await peoplePrisma.attendanceDevice.findMany({ where: { orgId, isActive: true, vendor: { in: vendorsWith('users') } } });
  if (!all.some((r) => pinAt(r) || oldAt(r))) return { readers: 0 };
  const readers = all.filter((r) => servesArea(r, employee.areaId) && r.id !== skipDeviceId);
  /* Moved to another site: off the readers that no longer serve them. */
  if (before && (before.areaId ?? null) !== (employee.areaId ?? null)) {
    for (const r of all.filter((x) => servesArea(x, before.areaId) && !servesArea(x, employee.areaId))) {
      const pins = [...new Set([oldAt(r), pinAt(r)].filter(Boolean))];
      await peoplePrisma.deviceCommand.createMany({
        data: pins.flatMap((p) => removalCommandsFor(r.vendor, p).map((command) => ({ accountId: r.accountId, orgId, deviceId: r.id, serialNumber: r.serialNumber, command, sequence: SEQ.USER, createdByUserId }))),
      });
    }
  }
  if (!readers.length) return { readers: 0 };
  /* Readers that did not serve them before (a new site) get their fingerprints and face too. */
  const movedSite = before && (before.areaId ?? null) !== (employee.areaId ?? null);
  const policy = movedSite ? await biometricPolicy(orgId) : null;
  const stored = movedSite && employee.id && policy?.allows(employee.id) ? await peoplePrisma.biometricTemplate.findMany({ where: { orgId, employeeId: employee.id }, orderBy: [{ type: 'asc' }, { no: 'asc' }] }) : [];
  const templates = [...new Map(stored.map((t) => [`${t.type}|${t.no}`, t])).values()];
  for (const r of readers) {
    const pin = pinAt(r);
    const oldPin = oldAt(r);
    const rows: Array<{ command: string; sequence: number }> = [];
    if (oldPin && oldPin !== pin) for (const c of removalCommandsFor(r.vendor, oldPin)) rows.push({ command: c, sequence: SEQ.USER });
    if (pin) {
      const held = await peoplePrisma.deviceUser.findFirst({ where: { orgId, pin }, orderBy: { updatedAt: 'desc' } });
      await supersedeUserInfo(r.id, pin);
      rows.push({
        /* Privilege and door PIN from the employee file only (see userFor); a card enrolled at a reader is kept. */
        command: userCommandFor(r.vendor, pin, employee.name, {
          privilege: employee.devicePrivilege ?? 0,
          password: employee.devicePassword ?? '',
          card: employee.cardNumber ?? held?.card ?? '',
        }),
        sequence: SEQ.USER,
      });
    }
    await peoplePrisma.deviceCommand.createMany({
      data: rows.map((x) => ({ accountId: r.accountId, orgId, deviceId: r.id, serialNumber: r.serialNumber, command: x.command, sequence: x.sequence, createdByUserId })),
    });
    if (pin && templates.length && !servesArea(r, before.areaId)) {
      const extra = templates.filter((t) => supports(r, t.type)).flatMap((t) => templateCommands({ ...t, pin }, r));
      if (extra.length) {
        await peoplePrisma.deviceCommand.createMany({
          data: extra.map((x) => ({ accountId: r.accountId, orgId, deviceId: r.id, serialNumber: r.serialNumber, command: x.command, sequence: x.seq, createdByUserId })),
        });
      }
    }
  }
  return { readers: readers.length };
}

// ---------------------------------------------------------------------------
// The protocol
// ---------------------------------------------------------------------------
