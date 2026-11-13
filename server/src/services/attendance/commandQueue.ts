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

/**
 * A reader's answer settles a command only while it is still out with the reader on the attempt that was read:
 * SENT, with the same attempt count. A late or repeated answer (the command was re-queued and sent again, or an
 * earlier answer already settled it) changes nothing, so it cannot overwrite a newer result. Returns whether this
 * answer was the one that settled it.
 */
export async function settleCommand(
  cmd: { id: number; attempts: number },
  data: { status: 'DONE' | 'FAILED'; returnCode: number; lastError: string | null },
  now = new Date(),
) {
  const done = await peoplePrisma.deviceCommand.updateMany({
    where: { id: cmd.id, status: 'SENT', attempts: cmd.attempts },
    data: { ...data, doneAt: now },
  });
  return done.count > 0;
}
