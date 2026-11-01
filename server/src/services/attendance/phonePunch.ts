import { isMinor } from './biometrics.js';
import { peoplePrisma, peopleWrite } from '../../utils/peoplePrisma.js';
import { istDate, istTime } from './compute.js';
import { emit as emitWebhook } from './webhooks.js';
import { punchPhotoRetentionDays } from '../retention.js';
import { MAX_ACCURACY_M, MIN_GAP_MS, decodePhoto, describeDistance, matchFence, nextDirection, validPosition } from './portal.js';
import { recomputeDeviceDay, shiftDayFor } from './punches.js';
import { enqueuePunches } from '../hr/sync.js';
import { placeAt } from '../geocode.js';

/**
 * A punch from a phone, for whoever is holding it: an employee in the portal,
 * or a CLOR user in the Attendance app whose employee file is linked. Both
 * doors run the same checks — the phone's position must sit inside one of the
 * person's work sites (or, for people HR set to field punching, anywhere: the
 * position and its address are kept, marked outside a site, and the punch can
 * wait for approval), the server's clock is the time, a selfie is kept if sent
 * and required only when HR asks — so a punch means the same thing whichever
 * way it came in. ClorTime had this twice (mobile_attendance.js and portal.js) and
 * they drifted; here it is once.
 */

/** Verify mode recorded on a phone punch; readers use 0–15 for finger, face, card and so on. */
export const PHONE_VERIFY = 100;

export type PunchingEmployee = {
  id: string;
  accountId: string;
  orgId: string;
  code: string | null;
  devicePin: string | null;
  branchId: string | null;
  areaId: string | null;
  geofenceId: string | null;
  mobilePunch: boolean;
  /** YYYY-MM-DD; under 18, the phone never reads a location (DPDP s.9: no tracking of children). */
  dateOfBirth?: string | null;
  /** SITE: only inside a work site. FIELD: anywhere, recorded as outside a site. */
  phonePunchMode?: string | null;
  selfieRequired?: boolean | null;
};

const isField = (e: PunchingEmployee) => e.phonePunchMode === 'FIELD';

/** Phone punching for this person: switched on by HR, and never for someone under 18. */
const phoneAllowed = (e: PunchingEmployee) => Boolean(e.mobilePunch) && !isMinor(e.dateOfBirth);

export const nowLocal = (at: Date) => `${istDate(at)} ${new Date(at.getTime() + 330 * 60_000).toISOString().slice(11, 19)}`;

/** Sites this person may punch at: their own, else any active one for everyone or for their area. */
export async function sitesFor(e: Pick<PunchingEmployee, 'orgId' | 'geofenceId' | 'areaId'>) {
  if (e.geofenceId) {
    const own = await peoplePrisma.geofence.findFirst({ where: { id: e.geofenceId, orgId: e.orgId, isActive: true } });
    return own ? [own] : [];
  }
  return peoplePrisma.geofence.findMany({
    where: { orgId: e.orgId, isActive: true, OR: [{ areaId: null }, ...(e.areaId ? [{ areaId: e.areaId }] : [])] },
    orderBy: { name: 'asc' },
  });
}

/** Today's punches (by shift day) and what the phone may do next — the card's whole state. */
export async function phoneStatus(e: PunchingEmployee) {
  const shiftDay = await shiftDayFor(e.orgId, e.id, nowLocal(new Date()));
  const [punches, sites] = await Promise.all([
    peoplePrisma.devicePunch.findMany({ where: { orgId: e.orgId, employeeId: e.id, shiftDate: shiftDay }, orderBy: { at: 'asc' } }),
    phoneAllowed(e) ? sitesFor(e) : Promise.resolve([]),
  ]);
  const fenceNames = new Map(sites.map((s) => [s.id, s.name]));
  return {
    punches: punches.map((p) => ({ time: p.localTime.slice(11, 16), kind: p.kind, phone: p.latitude != null, site: p.geofenceId ? fenceNames.get(p.geofenceId) || null : p.outsideSite ? p.address || 'Outside the work sites' : null, outside: p.outsideSite, review: p.reviewStatus })),
    phone: {
      allowed: phoneAllowed(e),
      mode: isField(e) ? 'FIELD' : 'SITE',
      selfieRequired: Boolean(e.selfieRequired),
      ...(e.mobilePunch && isMinor(e.dateOfBirth) ? { why: 'Phone punching reads your location, which is not done for anyone under 18. Punch at a reader.' } : {}),
      next: nextDirection(punches),
      /* For the notice on the punch card: how long a selfie is kept. */
      photoRetentionDays: await punchPhotoRetentionDays(e.orgId),
      sites: sites.map((s) => ({ id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude, radiusMeters: s.radiusMeters })),
    },
  };
}

export type PunchOutcome = { status: number; body: Record<string, unknown> };

/** The punch itself. Returns the HTTP status and body; the route only sends them. */

/**
 * A phone punch, and — when the server refuses it — a record of the attempt,
 * so HR can see that someone tried from outside the site or with a rough
 * location (Readers → Phone punches). The refusal itself is unchanged.
 */
export async function recordPhonePunch(e: PunchingEmployee, input: any): Promise<PunchOutcome> {
  const out = await recordPhonePunchChecked(e, input);
  if (out.status >= 400 && out.body?.code) {
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    await peoplePrisma.phonePunchAttempt
      .create({
        data: {
          accountId: e.accountId,
          orgId: e.orgId,
          employeeId: e.id,
          code: String(out.body.code),
          message: String(out.body.error || '').slice(0, 300),
          latitude: num(input?.latitude),
          longitude: num(input?.longitude),
          accuracyM: num(input?.accuracy),
        },
      })
      .catch((err) => console.error('[phone-punch-attempt]', err instanceof Error ? err.message : err));
  }
  return out;
}

async function recordPhonePunchChecked(e: PunchingEmployee, input: any): Promise<PunchOutcome> {
  if (!e.mobilePunch) return { status: 403, body: { error: 'Punching from your phone is not switched on for you. Ask HR.', code: 'PHONE_OFF' } };
  if (isMinor(e.dateOfBirth)) return { status: 403, body: { error: 'Phone punching reads your location, which is not done for anyone under 18. Punch at a reader.', code: 'MINOR' } };
  const { latitude, longitude } = input || {};
  const accuracy = typeof input?.accuracy === 'number' && Number.isFinite(input.accuracy) ? input.accuracy : null;
  if (!validPosition(latitude, longitude)) return { status: 400, body: { error: 'Your location did not come through. Allow location for this site and try again.', code: 'NO_LOCATION' } };
  if (accuracy != null && accuracy > MAX_ACCURACY_M) {
    return { status: 400, body: { error: `Your location is only accurate to ${describeDistance(accuracy)}. Turn on precise location, or step outside, and try again.`, code: 'ROUGH_LOCATION' } };
  }
  const sites = await sitesFor(e);
  const field = isField(e);
  if (!sites.length && !field) return { status: 409, body: { error: 'No work site is set up for your phone punches yet. Ask HR.', code: 'NO_SITE' } };
  const { inside, nearest } = sites.length ? matchFence({ latitude, longitude }, sites) : { inside: null, nearest: null };
  if (!inside && !field) {
    return {
      status: 403,
      body: { error: `You are ${describeDistance(nearest!.distance)} from ${nearest!.fence.name}. Punch from within ${describeDistance(nearest!.fence.radiusMeters)} of it.`, code: 'OUTSIDE' },
    };
  }
  const photo = decodePhoto(input?.photo);
  if (photo && 'error' in photo) return { status: 400, body: { error: photo.error, code: 'BAD_PHOTO' } };
  if (!photo && e.selfieRequired) return { status: 400, body: { error: 'A selfie is needed with each punch. Take one and punch again.', code: 'SELFIE_REQUIRED' } };
  /* A field punch outside every site: where it was (the address, best effort) and, if the company asks, a review before it counts. */
  const outside = !inside;
  const settings = outside ? await peoplePrisma.attendanceSettings.findUnique({ where: { orgId: e.orgId }, select: { fieldPunchApproval: true } }) : null;
  const review = outside && (settings?.fieldPunchApproval ?? true) ? 'PENDING' : null;
  const address = outside ? (await Promise.race([placeAt(latitude, longitude).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 4000))]))?.address?.slice(0, 300) || null : null;

  const at = new Date();
  const localTime = nowLocal(at);
  const shiftDate = await shiftDayFor(e.orgId, e.id, localTime);
  const today_ = await peoplePrisma.devicePunch.findMany({ where: { orgId: e.orgId, employeeId: e.id, shiftDate }, orderBy: { at: 'asc' }, select: { at: true, kind: true } });
  const last = today_[today_.length - 1];
  if (last && at.getTime() - last.at.getTime() < MIN_GAP_MS) return { status: 409, body: { error: 'You punched less than a minute ago.', code: 'TOO_SOON' } };
  const kind = nextDirection(today_);

  /* Phone punches sit under one "reader" per company, so Transactions and reports show them like any other. */
  const serialNumber = `MOBILE-${e.orgId}`;
  const device = await peoplePrisma.attendanceDevice.upsert({
    where: { serialNumber },
    create: { accountId: e.accountId, orgId: e.orgId, serialNumber, name: 'Phone punches', vendor: 'MOBILE', createdByUserId: 'portal' },
    update: { lastSeenAt: at },
  });
  const saved = photo ? await peoplePrisma.punchPhoto.create({ data: { accountId: e.accountId, orgId: e.orgId, employeeId: e.id, mime: photo.mime, data: photo.data } }) : null;
  const punch = await peoplePrisma.devicePunch.create({
    data: {
      accountId: e.accountId,
      orgId: e.orgId,
      deviceId: device.id,
      serialNumber,
      pin: e.devicePin || e.code || e.id,
      at,
      localTime,
      state: kind === 'IN' ? '0' : '1',
      kind,
      verifyMode: PHONE_VERIFY,
      employeeId: e.id,
      shiftDate,
      latitude,
      longitude,
      accuracyM: accuracy,
      geofenceId: inside?.fence.id ?? null,
      photoId: saved?.id || null,
      outsideSite: outside,
      address,
      reviewStatus: review,
    },
  });
  if (review === 'PENDING') {
    /* On the approval engine (workflow engine 2d): its request opens, "HR or the manager". Nobody else to decide it at all: approved at once (SPEC 5.6). */
    const opened = await openPunchOnEngine(e, punch.id, shiftDate);
    /* Not counted, nor sent anywhere, until someone approves it. */
    if (!opened) return { status: 201, body: { kind, time: istTime(at), site: null, outside: true, address, review, photo: Boolean(saved) } };
  }
  emitWebhook(e.orgId, 'punch', {
    reader: serialNumber,
    punches: [{ readerId: e.devicePin || e.code, employeeId: e.id, time: localTime, direction: kind, verifyMode: PHONE_VERIFY, site: inside?.fence.name ?? address ?? 'Outside the work sites' }],
  });
  void enqueuePunches(e.orgId, [{ employeeId: e.id, code: e.code || e.devicePin || null, readerId: serialNumber, time: localTime, direction: kind, verifyMode: PHONE_VERIFY }]);
  await recomputeDeviceDay(e.accountId, e.orgId, { id: e.id, branchId: e.branchId, areaId: e.areaId }, shiftDate);
  return { status: 201, body: { kind, time: istTime(at), site: inside?.fence.name ?? null, distance: inside ? Math.round(inside.distance) : null, outside, address, review: review === 'PENDING' ? 'APPROVED' : review, photo: Boolean(saved) } };
}

/**
 * A field punch waiting for review, on the approval engine when the company's switch is on: its request opens under
 * "HR or the manager". Answers true only when it was approved at once (nobody but the person could decide it, SPEC
 * 5.6), so it counts now. A punch is never refused for want of an approver: if the engine cannot open it (STRICT
 * maker-checker with nobody else), it waits on the old path.
 */
async function openPunchOnEngine(e: PunchingEmployee, punchId: string, shiftDate: string) {
  try {
    const { FIELD_PUNCH_SOURCE, openOnEngine } = await import('./attendanceEngine.js');
    const person = await peoplePrisma.employee.findFirst({ where: { id: e.id, orgId: e.orgId }, select: { name: true, userId: true } });
    const out = await peopleWrite(e.orgId, () => openOnEngine({ accountId: e.accountId, orgId: e.orgId, source: FIELD_PUNCH_SOURCE, sourceId: punchId, employeeId: e.id, chain: 'HR', title: `${person?.name || 'Field punch'}: field punch, ${shiftDate}`, enteredBy: person?.userId || `portal:${e.id}` }));
    return out.done;
  } catch (err) {
    console.error('[phone-punch] field punch left on the old review:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * A field punch's review itself: claimed by its status, and the day worked out again with it counted or not. The
 * old path (routes/attendanceInsights.ts reviewFieldPunch) and the approval engine (attendanceEngine.ts, when its
 * step closes) both write it this way.
 */
export async function writePunchDecision(orgId: string, punchId: string, approve: boolean) {
  const p = await peoplePrisma.devicePunch.findFirst({ where: { id: punchId, orgId } });
  if (!p) throw Object.assign(new Error('No such field punch.'), { status: 404 });
  const claimed = await peoplePrisma.devicePunch.updateMany({ where: { id: p.id, reviewStatus: 'PENDING' }, data: { reviewStatus: approve ? 'APPROVED' : 'REJECTED' } });
  if (!claimed.count) throw Object.assign(new Error('Somebody decided this punch a moment ago.'), { status: 409 });
  const emp = p.employeeId ? await peoplePrisma.employee.findFirst({ where: { id: p.employeeId, orgId }, select: { id: true, accountId: true, branchId: true, areaId: true } }) : null;
  if (emp && p.shiftDate) await recomputeDeviceDay(emp.accountId, orgId, { id: emp.id, branchId: emp.branchId, areaId: emp.areaId }, p.shiftDate);
  return p;
}
