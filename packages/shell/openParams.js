/**
 * What a screen is opened with when another app (or the bell, from another app) opens it by name:
 * the link's params only when the screen exists in that app and there are params; otherwise none,
 * so the last screen's params never leak into the next one. Pure, so it is tested without a browser.
 */
export function paramsForOpen(app, open, params) {
  if (!open || !app?.screens?.[open]) return null;
  if (!params || typeof params !== 'object' || !Object.keys(params).length) return null;
  return params;
}
