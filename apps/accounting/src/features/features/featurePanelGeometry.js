/**
 * How wide the panel is, from how wide the content is.
 *
 * Three quarters, capped at 1160 so a 2560 screen does not get a panel that
 * runs across an empty hall; and never narrower than 880 while the content
 * can give it, so a 1366 laptop still gets a usable panel rather than a
 * strict 76% of a small number. Below 880 of content there is nothing to
 * share, and the panel takes the whole content area.
 */
export const panelWidthFor = (contentWidth) =>
  Math.round(Math.max(Math.min(contentWidth * 0.76, 1160), Math.min(contentWidth, 880)));
