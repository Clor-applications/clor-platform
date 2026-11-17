/**
 * Every row of a list the server hands out a page at a time.
 *
 * The books in the browser are read from these lists, and Reports and the GST
 * returns are worked out from the books. Asking once returned the first page
 * only (500 invoices, 200 bills, 100 payments each way), so a larger company
 * got a short return with nothing to say so (audit, 17 Nov 2026).
 *
 * `fetchPage({ limit, offset })` returns one page as an array. Pages are asked
 * for until one comes back short. `complete` is false only when `maxRows` was
 * reached with more still to come, so the caller can say the figures are short
 * rather than show them as whole.
 */
export const PAGE_SIZE = 500;
export const MAX_ROWS = 50_000;

export async function listAllPages(fetchPage, { pageSize = PAGE_SIZE, maxRows = MAX_ROWS } = {}) {
  const rows = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const page = await fetchPage({ limit: pageSize, offset });
    const got = Array.isArray(page) ? page : [];
    rows.push(...got);
    if (got.length < pageSize) return { rows, complete: true };
  }
  return { rows, complete: false };
}
