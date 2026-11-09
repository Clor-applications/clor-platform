import 'dotenv/config';
/**
 * The Explore sample company (services/sampleCompany.ts), made and filled.
 *
 * The first Explore visitor makes it anyway; this is for doing it ahead of
 * them, after a deploy, so nobody waits on the fill. Safe to run again: it
 * adds only what is missing. `--force` runs the fill again even when the
 * company says it is filled (still adding only what is missing).
 *
 * Run:
 *   cd server && npm run seed:sample
 */
import { ensureSampleCompany, SAMPLE } from '../services/sampleCompany.js';

const force = process.argv.includes('--force');
const started = Date.now();

ensureSampleCompany({ fill: true, force, log: (m) => console.log(`  ${m}`) })
  .then((c) => {
    console.log(`\n  ${SAMPLE.company} is ready (org ${c.orgId}) in ${Math.round((Date.now() - started) / 1000)} s.\n`);
    process.exit(0);
  })
  .catch((e) => {
    console.error('\n  The sample company could not be made:', e?.stack || e, '\n');
    process.exit(1);
  });
