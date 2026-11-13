import { peoplePrisma } from '../../utils/peoplePrisma.js';
import type { Prisma } from '../../generated/people/index.js';

/**
 * The next waiting command for a reader, taken for sending: oldest first, and claimed only while it is still
 * PENDING. HR can cancel a waiting command, and a reader can ask twice at once (a retry, two server instances);
 * the claim is what decides. A command cancelled, or taken by the other request, between the read and the claim
 * is passed over for the next one, so a cancelled command never reaches the reader and none is sent twice.
 */
export async function claimNextCommand(where: Prisma.DeviceCommandWhereInput, now = new Date()) {
  for (let tries = 0; tries < 5; tries++) {
    const next = await peoplePrisma.deviceCommand.findFirst({ where: { ...where, status: 'PENDING' }, orderBy: [{ sequence: 'asc' }, { id: 'asc' }] });
    if (!next) return null;
    const taken = await peoplePrisma.deviceCommand.updateMany({ where: { id: next.id, status: 'PENDING' }, data: { status: 'SENT', sentAt: now, attempts: { increment: 1 } } });
    if (taken.count) return next;
  }
  /* Lost the claim every time: the reader asks again in a few seconds. */
  return null;
}
