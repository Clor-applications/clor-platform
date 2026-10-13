import 'dotenv/config';
import { buildApp } from './app.js';
import { startRecurringScheduler } from './services/recurringScheduler.js';

const app = buildApp();
const port = Number(process.env.PORT || 4001);

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
});

/*
 * Started with the server, not with a browser. Set RECURRING_SCHEDULER=off to
 * disable it — on an instance that only serves requests, say, or while
 * something is being investigated.
 */
startRecurringScheduler();
