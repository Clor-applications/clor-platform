import { describe, expect, it } from 'vitest';

import { EXPLORE_READ_ONLY_TEXT, notify, subscribeToasts } from './notify';

describe('notify', () => {
  it('turns any wrapping of the sample company refusal into the one sentence, as a note', () => {
    const seen = [];
    const off = subscribeToasts((t) => seen.push(t));
    notify.error(`Saved on this device only — the server refused it: ${EXPLORE_READ_ONLY_TEXT}`);
    notify.error(EXPLORE_READ_ONLY_TEXT);
    notify.error('Billing state is required for India.');
    off();
    expect(seen.map((t) => [t.kind, t.message])).toEqual([
      ['info', EXPLORE_READ_ONLY_TEXT],
      ['info', EXPLORE_READ_ONLY_TEXT],
      ['error', 'Billing state is required for India.'],
    ]);
  });
});
