import 'dotenv/config';
/**
 * Price book version 1, the mock prices (services/pricing/seed.ts), made and
 * published when the platform database has no price book. The API does the
 * same when it starts; this is for a fresh database before the API has run.
 *
 * Run:
 *   cd server && npm run seed:pricing
 *
 * Idempotent: with any price book already there it changes nothing.
 */
import { ensureFirstPriceBook } from '../services/pricing/seed.js';
import { platformPrisma } from '../utils/platformPrisma.js';

const r = await ensureFirstPriceBook();
console.log(r.created ? `Price book version ${r.version} made and published (mock prices).` : 'A price book already exists; nothing changed.'); // eslint-disable-line no-console
await platformPrisma.$disconnect();
