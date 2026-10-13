import { Prisma } from '@prisma/client';

import type { prisma } from './prisma.js';

/**
 * Something you can read and write models through — the client, or a
 * transaction opened from it.
 *
 * Accounting operations compose. Posting a sale, taking the receipt against it,
 * allocating that receipt and deriving what the document is now settled by are
 * four writes that are only ever correct together, and a failure in the fourth
 * has to undo the first three. That needs one transaction spanning all of them,
 * which in turn needs every function in the path to accept a transaction it did
 * not open rather than opening its own.
 *
 * The union is deliberately narrow. `Prisma.TransactionClient` has no
 * `$transaction` of its own, so code written against `DbClient` cannot nest a
 * transaction inside the caller's — which is exactly the mistake this type
 * exists to make unrepresentable.
 */
export type DbClient = Prisma.TransactionClient | typeof prisma;
