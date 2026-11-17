import { describe, expect, it, vi } from 'vitest';

import { listAllPages } from './paging';

const source = (n) => Array.from({ length: n }, (_, i) => i);
const pager = (rows) => vi.fn(async ({ limit, offset }) => rows.slice(offset, offset + limit));

describe('every row of a paged list', () => {
  it('asks page after page until one comes back short', async () => {
    const fetchPage = pager(source(1234));
    const r = await listAllPages(fetchPage, { pageSize: 500 });
    expect(r.complete).toBe(true);
    expect(r.rows).toEqual(source(1234));
    expect(fetchPage.mock.calls.map(([p]) => p)).toEqual([{ limit: 500, offset: 0 }, { limit: 500, offset: 500 }, { limit: 500, offset: 1000 }]);
  });

  it('a list that ends exactly on a page takes one more, empty, to know it has ended', async () => {
    const fetchPage = pager(source(1000));
    const r = await listAllPages(fetchPage, { pageSize: 500 });
    expect(r).toEqual({ rows: source(1000), complete: true });
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('an empty list is whole', async () => {
    expect(await listAllPages(pager([]))).toEqual({ rows: [], complete: true });
    expect(await listAllPages(async () => null)).toEqual({ rows: [], complete: true });
  });

  it('says so when it stops at the most it will read', async () => {
    const r = await listAllPages(pager(source(5000)), { pageSize: 500, maxRows: 2000 });
    expect(r.complete).toBe(false);
    expect(r.rows).toHaveLength(2000);
  });

  it('a page that fails fails the list, so nothing passes as whole', async () => {
    let n = 0;
    await expect(listAllPages(async () => { n += 1; if (n === 2) throw new Error('offline'); return source(500); }, { pageSize: 500 })).rejects.toThrow('offline');
  });
});
