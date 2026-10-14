/**
 * Is this explicitly a development or test run?
 *
 * Several conveniences — a fallback signing secret, reset and verification
 * tokens echoed back in API responses — used to switch on whenever NODE_ENV
 * was anything but "production". A server started without NODE_ENV set
 * therefore signed tokens with a published secret and handed anyone a
 * working password-reset token. They now need someone to have said, in so
 * many words, that this is development or a test.
 */
export const isDevOrTest = () =>
  ['development', 'test'].includes(String(process.env.NODE_ENV || '').trim()) || Boolean(process.env.VITEST);
