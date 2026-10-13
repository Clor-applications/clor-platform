import '@testing-library/jest-dom/vitest';

/*
 * jsdom implements no layout, so these two are simply absent. Both are called
 * for their visual effect only — keeping a highlighted row on screen, and
 * pointing a panel at its anchor — so a no-op is the honest stand-in rather
 * than something that would make a test pass for the wrong reason.
 */
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
