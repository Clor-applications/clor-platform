import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The connector's spool: punches CLOR could not take, kept on disk and sent
 * again oldest-first until CLOR answers 2xx.
 */

const { appendSpool, flushSpool, readSpool, writeSpool, boundSpool } = await import('../../agent/src/spool.js');
type Batch = { readerId: string; lines: string[]; firstTriedAt: string; attempts: number };

let file = '';
beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clor-spool-')), 'clor-agent-spool.jsonl');
});
const batch = (readerId: string, n = 2, tag = readerId): Batch => ({ readerId, lines: Array.from({ length: n }, (_, i) => `${tag}${i}\t2026-09-01 09:00:0${i % 10}\t0\t15`), firstTriedAt: '2026-09-01T03:30:00.000Z', attempts: 1 });

describe('the connector spool', () => {
  it('keeps batches on disk, one JSON line each, in order', () => {
    expect(readSpool(file)).toEqual([]);
    expect(appendSpool(file, batch('r1'))).toBe(2);
    expect(appendSpool(file, batch('r2', 3))).toBe(5);
    expect(fs.readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(readSpool(file).map((b) => b.readerId)).toEqual(['r1', 'r2']);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['clor-agent-spool.jsonl']); // no temp file left behind
  });

  it('skips a torn line and keeps the rest', () => {
    fs.writeFileSync(file, JSON.stringify(batch('r1')) + '\n{"readerId":"r2","li\n');
    expect(readSpool(file).map((b) => b.readerId)).toEqual(['r1']);
  });

  it('removes a batch only once CLOR answered 2xx, oldest first', async () => {
    appendSpool(file, batch('r1'));
    appendSpool(file, batch('r2'));
    const seen: string[] = [];
    const res = await flushSpool(file, async (b) => (seen.push(b.readerId), 200));
    expect(seen).toEqual(['r1', 'r2']);
    expect(res).toMatchObject({ sent: 2, dropped: 0, waiting: 0, stoppedBy: null });
    expect(fs.existsSync(file)).toBe(false);
  });

  it('keeps everything from the first network error, 5xx or 429 on, and counts the attempt', async () => {
    appendSpool(file, batch('r1'));
    appendSpool(file, batch('r2'));
    appendSpool(file, batch('r3'));
    const answers: Array<number | Error> = [200, new Error('fetch failed')];
    const res = await flushSpool(file, async () => {
      const a = answers.shift()!;
      if (a instanceof Error) throw a;
      return a;
    });
    expect(res).toMatchObject({ sent: 1, waiting: 2, waitingLines: 4, stoppedBy: 'fetch failed' });
    expect(readSpool(file).map((b) => [b.readerId, b.attempts])).toEqual([['r2', 2], ['r3', 1]]);

    for (const status of [503, 429]) {
      const r = await flushSpool(file, async () => status);
      expect(r).toMatchObject({ sent: 0, dropped: 0, waiting: 2, stoppedBy: `CLOR answered ${status}` });
    }
    expect(readSpool(file).map((b) => [b.readerId, b.attempts])).toEqual([['r2', 4], ['r3', 1]]);
  });

  it('drops a batch CLOR refuses with a 4xx other than 429, says so, and goes on', async () => {
    appendSpool(file, batch('gone'));
    appendSpool(file, batch('r2'));
    const logs: string[] = [];
    const res = await flushSpool(file, async (b) => (b.readerId === 'gone' ? 404 : 200), (...a) => logs.push(a.join(' ')));
    expect(res).toMatchObject({ sent: 1, dropped: 1, waiting: 0 });
    expect(logs.join('\n')).toMatch(/refused 2 punch line\(s\) for reader gone \(answered 404\)/);
    expect(readSpool(file)).toEqual([]);
  });

  it('leaves the file untouched when there is nothing to send', async () => {
    const res = await flushSpool(file, async () => 200);
    expect(res).toEqual({ sent: 0, dropped: 0, waiting: 0, waitingLines: 0, stoppedBy: null });
    expect(fs.existsSync(file)).toBe(false);
  });

  it('is bounded: over the limit, the oldest batches go, with a log line', () => {
    const logs: string[] = [];
    const limits = { maxLines: 10, maxBytes: 1_000_000 };
    appendSpool(file, batch('a', 4), (...x) => logs.push(x.join(' ')), limits);
    appendSpool(file, batch('b', 4), (...x) => logs.push(x.join(' ')), limits);
    expect(logs).toEqual([]);
    expect(appendSpool(file, batch('c', 4), (...x) => logs.push(x.join(' ')), limits)).toBe(8);
    expect(readSpool(file).map((b) => b.readerId)).toEqual(['b', 'c']);
    expect(logs.join('\n')).toMatch(/dropped the oldest 4 punch line\(s\) in 1 batch/);

    /* By size as well as by count. */
    const big = [batch('x', 50), batch('y', 50)];
    const oneSize = Buffer.byteLength(JSON.stringify(big[0])) + 1;
    expect(boundSpool(big, { maxLines: 1_000, maxBytes: oneSize + 10 }).kept.map((b) => b.readerId)).toEqual(['y']);
  });

  it('writes by replacing the file whole', () => {
    writeSpool(file, [batch('r1')]);
    writeSpool(file, [batch('r2')]);
    expect(readSpool(file).map((b) => b.readerId)).toEqual(['r2']);
    writeSpool(file, []);
    expect(fs.existsSync(file)).toBe(false);
  });
});
