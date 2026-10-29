/**
 * A test works an authenticator code out, and the server checks it a moment
 * later. The server takes the step before, this one and the one after
 * (services/totp.ts), so a code for "the step before" is refused when a step
 * ends in between: on a slow CI runner it is two steps old by then. Enrolling
 * with the step before is what leaves this step free for the step-up that
 * follows, so rather than change that, wait out the end of a step first.
 */
const STEP_MS = 30_000;

export async function clearOfStepEdge(marginMs = 8_000) {
  const left = STEP_MS - (Date.now() % STEP_MS);
  if (left < marginMs) await new Promise((done) => setTimeout(done, left + 50));
}
