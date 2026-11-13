/* The CLOR identity, as delivered in the CLOR SVG pack (CL frame, no dot).
   These are the pack's own paths, copied verbatim — every shape is straight
   lines and circular arcs, no typeface is involved. Do not redraw them here;
   replace the pack and copy the new paths across.

   Two grids:
     symbol  100 x 100, the open CL frame (an arc and a square bracket)
     letters cap top y=0, baseline y=100; each letter carries its own x offset
   The accent (blaze orange) is the frame's bracket and the O's lower-left
   quarter; everything else is the ink. */

/* ---- the symbol: arc + bracket on a 100 grid ---- */
export const SYMBOL_ARC_D = 'M60 0H46A46 46 0 0 0 0 46V60H24V46A22 22 0 0 1 46 24H60Z';
export const SYMBOL_BRACKET_D = 'M100 40V100H40V76H76V40Z';
export const SYMBOL_BOX = { x: 0, y: 0, w: 100, h: 100 };

/* ---- the letters, each at its own x on the 100 cap grid ---- */
export const LETTERS = [
  { x: 0, ink: 'M98 0H48A48 48 0 0 0 0 48V52A48 48 0 0 0 48 100H98V73H52A22 22 0 0 1 30 51V49A22 22 0 0 1 52 27H98Z' },
  { x: 110, ink: 'M0 0H30V73H96V100H0Z' },
  {
    x: 166,
    accent: 'M0 60V100H48A48 48 0 0 1 0.67 60Z',
    ink: 'M48 0H60A48 48 0 0 1 108 48V52A48 48 0 0 1 60 100H48A48 48 0 0 1 0 52V48A48 48 0 0 1 48 0Z M50 27A20 20 0 0 0 30 47V53A20 20 0 0 0 50 73H58A20 20 0 0 0 78 53V47A20 20 0 0 0 58 27Z',
    evenOdd: true,
  },
  {
    x: 288,
    ink: 'M0 0H76A34 34 0 0 1 110 34A30 30 0 0 1 82 64H30V100H0Z M30 27H72A8.5 8.5 0 0 1 72 44H30Z',
    evenOdd: true,
    extra: 'M50 64H86L120 100H82Z',
  },
];

/* ---- the boxes the pack lays the pieces out in ---- */
export const WORD_BOX = { x: 0, y: -1, w: 408, h: 102 };
/* horizontal: symbol at 1.12, the word starting at x=152 */
export const HORIZONTAL = { box: { x: 0, y: -7, w: 560, h: 114 }, symbol: { x: 0, y: -6, scale: 1.12 }, word: { x: 152, y: 0 } };
/* stacked: the symbol centred over the word */
export const STACKED = { box: { x: -4, y: -4, w: 416, h: 260 }, symbol: { x: 148, y: 0, scale: 1.12 }, word: { x: 0, y: 152 } };
