/** Builds the scenario world against a running API without running any test (for writing tests). */
import { seed } from '../support/seed';

seed((process.argv[2] as 'desktop' | 'phone') || 'desktop').then((w) => console.log(JSON.stringify({ run: w.run, asha: w.asha, owner: w.users.owner.email }, null, 2))).catch((e) => {
  console.error(e);
  process.exit(1);
});
