import 'dotenv/config';
/**
 * Sample prices for a developer’s own database (services/pricing/seed.ts), made and
 * published as version 1 when the platform database has no price book. Real
 * prices are made in the operator console; the API never seeds anything.
 *
 * Run:
 *   cd server && npm run seed:pricing
 *
 * Idempotent: with any price book already there it changes nothing.
 */
import { seedSampleBook } from '../services/pricing/seed.js';
import { platformPrisma } from '../utils/platformPrisma.js';

const r = await seedSampleBook();
console.log(r.created ? `Price book version ${r.version} made and published (sample prices).` : 'A price book already exists; nothing changed.'); // eslint-disable-line no-console
await platformPrisma.$disconnect();
