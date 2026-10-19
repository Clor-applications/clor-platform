import fs from 'node:fs';

/**
 * The connector's spool: punches a reader gave it that CLOR could not take
 * just then (no internet, a timeout, CLOR busy or down). Kept on disk beside
 * the state file, one JSON line per batch, and sent again oldest-first at the
 * start of every round until CLOR answers 2xx. CLOR drops punches it already
 * has, so sending a batch twice does no harm; losing one does.
 *
 * Pure file handling plus a `send` the caller gives, so it is tested without
 * a network (src/__tests__/agentSpool.test.ts).
 */

export type SpoolBatch = { readerId: string; lines: string[]; firstTriedAt: string; attempts: number };

/** What CLOR answered (the HTTP status). Throw for a network error or timeout. */
export type SpoolSend = (batch: SpoolBatch) => Promise<number>;

export type SpoolLimits = { maxLines: number; maxBytes: number };
export const SPOOL_LIMITS: SpoolLimits = { maxLines: 50_000, maxBytes: 20 * 1024 * 1024 };

/** Worth trying again later: CLOR busy (429) or broken (5xx). Any other 4xx will not change by waiting. */
export const retryableStatus = (status: number) => status === 429 || status >= 500;

export function readSpool(file: string): SpoolBatch[] {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out: SpoolBatch[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const b = JSON.parse(line);
      if (b && typeof b.readerId === 'string' && Array.isArray(b.lines)) out.push({ readerId: b.readerId, lines: b.lines.map(String), firstTriedAt: String(b.firstTriedAt || ''), attempts: Number(b.attempts) || 0 });
    } catch {
      /* a torn line from a crash: skip it, keep the rest */
    }
  }
  return out;
}

/** Replace the spool in one step (temp file, then rename), so a crash leaves the old file or the new one, never half of each. */
export function writeSpool(file: string, batches: SpoolBatch[]) {
  if (!batches.length) {
    fs.rmSync(file, { force: true });
    return;
  }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, batches.map((b) => JSON.stringify(b)).join('\n') + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export const spooledLines = (batches: SpoolBatch[]) => batches.reduce((n, b) => n + b.lines.length, 0);

/** Drop the oldest batches until the spool is within its limits. Returns what was dropped. */
export function boundSpool(batches: SpoolBatch[], limits: SpoolLimits = SPOOL_LIMITS): { kept: SpoolBatch[]; droppedBatches: number; droppedLines: number } {
  const kept = [...batches];
  let lines = spooledLines(kept);
  let bytes = kept.reduce((n, b) => n + Buffer.byteLength(JSON.stringify(b)) + 1, 0);
  let droppedBatches = 0;
  let droppedLines = 0;
  while (kept.length && (lines > limits.maxLines || bytes > limits.maxBytes)) {
    const b = kept.shift()!;
    lines -= b.lines.length;
    bytes -= Buffer.byteLength(JSON.stringify(b)) + 1;
    droppedBatches += 1;
    droppedLines += b.lines.length;
  }
  return { kept, droppedBatches, droppedLines };
}

/** Keep a batch CLOR could not take. Returns how many lines are now waiting. */
export function appendSpool(file: string, batch: SpoolBatch, log: (...a: unknown[]) => void = () => {}, limits: SpoolLimits = SPOOL_LIMITS): number {
  const { kept, droppedBatches, droppedLines } = boundSpool([...readSpool(file), batch], limits);
  if (droppedBatches) log(`spool full: dropped the oldest ${droppedLines} punch line(s) in ${droppedBatches} batch(es) that CLOR never took`);
  writeSpool(file, kept);
  return spooledLines(kept);
}

export type FlushResult = { sent: number; dropped: number; waiting: number; waitingLines: number; stoppedBy: string | null };

/**
 * Send what is waiting, oldest first. A batch leaves the spool only when CLOR
 * answered 2xx (sent) or a 4xx other than 429 (dropped, with a log line: it
 * will never be taken). A network error, timeout, 429 or 5xx stops the flush
 * there; that batch and everything after it stay for the next round.
 */
export async function flushSpool(file: string, send: SpoolSend, log: (...a: unknown[]) => void = () => {}): Promise<FlushResult> {
  const batches = readSpool(file);
  let sent = 0;
  let dropped = 0;
  let stoppedBy: string | null = null;
  let i = 0;
  for (; i < batches.length; i++) {
    const b = batches[i];
    let status: number;
    try {
      status = await send(b);
    } catch (e: any) {
      stoppedBy = String(e?.message || e).slice(0, 200);
    }
    if (stoppedBy !== null) {
      b.attempts += 1;
      break;
    }
    if (status! >= 200 && status! < 300) {
      sent += 1;
    } else if (retryableStatus(status!)) {
      b.attempts += 1;
      stoppedBy = `CLOR answered ${status!}`;
      break;
    } else {
      dropped += 1;
      log(`spool: CLOR refused ${b.lines.length} punch line(s) for reader ${b.readerId} (answered ${status!}); dropped them`);
    }
  }
  const rest = batches.slice(i);
  if (sent || dropped || stoppedBy !== null) writeSpool(file, rest);
  return { sent, dropped, waiting: rest.length, waitingLines: spooledLines(rest), stoppedBy };
}
