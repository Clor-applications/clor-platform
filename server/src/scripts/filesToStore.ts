/**
 * R2 plan, S6: move documents, selfies and evidence still held in the people
 * database into the configured store (FILE_STORE=r2 and the R2_* settings).
 *
 *   npm run files:to-r2                  every company
 *   npm run files:to-r2 -- --org <id>    one company
 *   npm run files:to-r2 -- --back        the other way (rollback): bytes into the rows again
 *
 * Run as the owner role. Safe to stop and run again; only rows still holding
 * their bytes are touched. Run it once every instance has FILE_STORE=r2.
 */
import { exclusive, leaseFor } from '../services/jobLease.js';
import { moveFilesToDatabase, moveFilesToStore } from '../services/fileMove.js';

const args = process.argv.slice(2);
const org = args.includes('--org') ? args[args.indexOf('--org') + 1] : null;
const only = org ? { only: [org] } : {};
const result = await exclusive('files.move', leaseFor(6 * 3_600_000), () => (args.includes('--back') ? moveFilesToDatabase(only) : moveFilesToStore(only)) as Promise<Record<string, unknown>>, { idempotent: true });
console.log(result === null ? 'Another run holds the lease; nothing done.' : JSON.stringify(result));
process.exit(0);
