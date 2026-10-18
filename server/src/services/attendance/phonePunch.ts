import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { istDate, istTime } from './compute.js';
import { emit as emitWebhook } from './webhooks.js';
import { punchPhotoRetentionDays } from '../retention.js';
import { MAX_ACCURACY_M, MIN_GAP_MS, decodePhoto, describeDistance, matchFence, nextDirection, validPosition } from './portal.js';
import { recomputeDeviceDay, shiftDayFor } from '../../routes/iclock.js';
import { enqueuePunches } from '../hr/sync.js';

/**
 * A punch from a phone, for whoever is holding it: an employee in the portal,
 * or a CLOR user in the Attendance app whose employee file is linked. Both
 * doors run the same checks — the phone's position must sit inside one of the
 * person's work sites, the server's clock is the time, a selfie is kept if
 * sent and never required — so a punch means the same thing whichever way it
 * came in. ClorTime had this twice (mobile_attendance.js and portal.js) and
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
};

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
    e.mobilePunch ? sitesFor(e) : Promise.resolve([]),
  ]);
  const fenceNames = new Map(sites.map((s) => [s.id, s.name]));
  return {
    punches: punches.map((p) => ({ time: p.localTime.slice(11, 16), kind: p.kind, phone: p.latitude != null, site: p.geofenceId ? fenceNames.get(p.geofenceId) || null : null })),
    phone: {
      allowed: Boolean(e.mobilePunch),
      next: nextDirection(punches),
      /* For the notice on the punch card: how long a selfie is kept. */
      photoRetentionDays: punchPhotoRetentionDays(),
      sites: sites.map((s) => ({ id: s.id, name: s.name, latitude: s.latitude, longitude: s.longitude, radiusMeters: s.radiusMeters })),
    },
  };
}

export type PunchOutcome = { status: number; body: Record<string, unknown> };

/** The punch itself. Returns the HTTP status and body; the route only sends them. */
export async function recordPhonePunch(e: PunchingEmployee, input: any): Promise<PunchOutcome> {
  if (!e.mobilePunch) return { status: 403, body: { error: 'Punching from your phone is not switched on for you. Ask HR.', code: 'PHONE_OFF' } };
  const { latitude, longitude } = input || {};
  const accuracy = typeof input?.accuracy === 'number' && Number.isFinite(input.accuracy) ? input.accuracy : null;
  if (!validPosition(latitude, longitude)) return { status: 400, body: { error: 'Your location did not come through. Allow location for this site and try again.', code: 'NO_LOCATION' } };
  if (accuracy != null && accuracy > MAX_ACCURACY_M) {
    return { status: 400, body: { error: `Your location is only accurate to ${describeDistance(accuracy)}. Turn on precise location, or step outside, and try again.`, code: 'ROUGH_LOCATION' } };
  }
  const sites = await sitesFor(e);
  if (!sites.length) return { status: 409, body: { error: 'No work site is set up for your phone punches yet. Ask HR.', code: 'NO_SITE' } };
  const { inside, nearest } = matchFence({ latitude, longitude }, sites);
  if (!inside) {
    return {
      status: 403,
      body: { error: `You are ${describeDistance(nearest!.distance)} from ${nearest!.fence.name}. Punch from within ${describeDistance(nearest!.fence.radiusMeters)} of it.`, code: 'OUTSIDE' },
    };
  }
  const photo = decodePhoto(input?.photo);
  if (photo && 'error' in photo) return { status: 400, body: { error: photo.error, code: 'BAD_PHOTO' } };

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
  await peoplePrisma.devicePunch.create({
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
      geofenceId: inside.fence.id,
      photoId: saved?.id || null,
    },
  });
  emitWebhook(e.orgId, 'punch', {
    reader: serialNumber,
    punches: [{ readerId: e.devicePin || e.code, employeeId: e.id, time: localTime, direction: kind, verifyMode: PHONE_VERIFY, site: inside.fence.name }],
  });
  void enqueuePunches(e.orgId, [{ employeeId: e.id, code: e.code || e.devicePin || null, readerId: serialNumber, time: localTime, direction: kind, verifyMode: PHONE_VERIFY }]);
  await recomputeDeviceDay(e.accountId, e.orgId, { id: e.id, branchId: e.branchId, areaId: e.areaId }, shiftDate);
  return { status: 201, body: { kind, time: istTime(at), site: inside.fence.name, distance: Math.round(inside.distance), photo: Boolean(saved) } };
}
