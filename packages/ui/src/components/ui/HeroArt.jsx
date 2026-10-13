import heroIllustration from '../../assets/hero-illustration.webp';

/**
 * The drawing at the right-hand end of the Home band.
 *
 * A blank first hour is the day somebody decides what they think of the
 * product, and that hour used to be a heading and a checklist on an empty white
 * page. This is the one piece of warmth on the screen.
 *
 * The artwork is the file from the design, not a redraw of it: I had drawn a
 * near-copy in SVG and it was a near-copy — the leaves, the weight of the hand,
 * the fall of the shadow were all approximately right and none of them exactly.
 *
 * It is transparent through the background, so it sits on the hero's own ground
 * in either theme rather than carrying a white rectangle with it.
 *
 * Cropped to the artwork before it was ever imported: half the canvas it was
 * exported on is empty, which is why the picture looked small in a box the size
 * of the one the design gives it. Then served at twice the width it is drawn
 * at, which is what a retina screen reads and no more, as WebP — 125KB against
 * the PNG's 521KB, and the difference where it is actually seen averages under
 * one value per channel.
 *
 * Decorative, so it is hidden from assistive technology — nothing here is said
 * only in the picture.
 */
export default function HeroArt({ className = '' }) {
  return (
    <img
      src={heroIllustration}
      alt=""
      aria-hidden="true"
      draggable="false"
      className={`pointer-events-none select-none object-contain object-right-bottom ${className}`}
    />
  );
}
