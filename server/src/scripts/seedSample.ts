import 'dotenv/config';
/**
 * The Explore sample company (services/sampleCompany.ts), made and filled.
 *
 * A developer fallback: Clor staff build it from the operator console
 * (Sample company, Build sample company — routes/opsExplore.ts), which runs
 * the same build. The first Explore visitor makes it anyway. Safe to run again: it
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
