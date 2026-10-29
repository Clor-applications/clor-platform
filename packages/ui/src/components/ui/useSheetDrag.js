import { useCallback, useEffect, useRef } from 'react';

/**
 * Drag a phone sheet down to put it away (People, owner 28 Oct 2026; the
 * Apple notes in .agents/skills/apple-design). Only a drawer shown as a sheet
 * (`ui-drawer-sheet`) on a phone, in People.
 *
 * - The sheet follows the finger 1:1 from where it was grabbed, with ~8px of
 *   slack first so a tap on the header's buttons stays a tap.
 * - Let go, and where it would come to rest is projected from the finger's
 *   speed (Apple's deceleration, 0.998): past half its height it goes, short
 *   of that it comes back. A flick down closes it from anywhere; any flick up
 *   keeps it.
 * - It leaves and returns on a spring that starts at the finger's speed, so
 *   there is no seam between dragging and moving. Grab it mid-flight and it
 *   stops where it is and follows again.
 * - Pulled up past the top it gives a little and resists more the further it
 *   goes, instead of stopping dead.
 * - With unsaved edits it comes back and the drawer asks before discarding.
 */

const SLACK = 8;
const DECELERATION = 0.998;

/** Where a release at this speed (px/s) would come to rest, as scrolling decelerates. */
export const project = (velocity, d = DECELERATION) => ((velocity / 1000) * d) / (1 - d);

/** Past an edge the sheet follows less and less of the finger. */
export const rubberband = (overshoot, dimension, constant = 0.55) => (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));

/**
 * A spring in Apple's terms: damping ratio (1 = no overshoot) and response
 * (seconds to get most of the way). It starts at `velocity` (px/s) and can be
 * stopped at any frame; `value` is where it is now.
 */
export function spring({ from, to, velocity = 0, damping = 1, response = 0.3, within = 0.5, onUpdate, onDone }) {
  const stiffness = (2 * Math.PI / response) ** 2;
  const friction = (4 * Math.PI * damping) / response;
  let x = from;
  let v = velocity;
  let last = performance.now();
  let frame = 0;
  let timer = 0;
  let stopped = false;
  /* The next display frame, or a timer when frames are not coming (a throttled or background tab), whichever is first. */
  const next = () => {
    const run = (now) => { cancelAnimationFrame(frame); clearTimeout(timer); step(typeof now === 'number' ? now : performance.now()); };
    frame = requestAnimationFrame(run);
    timer = setTimeout(run, 34);
  };
  const step = (now) => {
    if (stopped) return;
    const dt = Math.min(0.064, Math.max(0, (now - last) / 1000));
    last = now;
    for (let i = 0; i < 4; i += 1) {
      const h = dt / 4;
      v += (-stiffness * (x - to) - friction * v) * h;
      x += v * h;
    }
    if (Math.abs(x - to) < within && (within > 0.5 || Math.abs(v) < 20)) {
      x = to;
      onUpdate(x);
      stopped = true;
      onDone?.();
      return;
    }
    onUpdate(x);
    next();
  };
  next();
  return {
    stop() { stopped = true; cancelAnimationFrame(frame); clearTimeout(timer); },
    get value() { return x; },
  };
}

const isPhoneSheet = (panel) => Boolean(
  panel?.classList.contains('ui-drawer-sheet')
  && document.documentElement.dataset.palette === 'sky'
  && window.matchMedia?.('(max-width: 639px)').matches,
);

export default function useSheetDrag({ panelRef, scrimRef, dirtyRef, onDismiss, onAskToClose }) {
  const state = useRef({ y: 0, anim: null, drag: null, scrimAlpha: null, scrimRgb: null, suppressClick: false, suppressTimer: null });

  /* Where the sheet is drawn: y px below its resting place; pulled up, it gives a little. */
  const draw = useCallback((y) => {
    const panel = panelRef.current;
    const s = state.current;
    s.y = y;
    if (!panel) return;
    const h = panel.offsetHeight || 1;
    const shown = y < 0 ? rubberband(y, h) : y;
    panel.style.transform = shown ? `translate3d(0, ${shown}px, 0)` : '';
    const scrim = scrimRef.current;
    if (scrim && s.scrimAlpha != null) {
      const left = Math.max(0, Math.min(1, 1 - y / h));
      scrim.style.backgroundColor = `rgb(${s.scrimRgb} / ${(s.scrimAlpha * left).toFixed(3)})`;
    }
  }, [panelRef, scrimRef]);

  const stopAnimation = () => {
    state.current.anim?.stop();
    state.current.anim = null;
  };

  useEffect(() => () => { stopAnimation(); clearTimeout(state.current.suppressTimer); }, []);

  const onPointerDown = useCallback((e) => {
    const panel = panelRef.current;
    if (!isPhoneSheet(panel) || e.button > 0) return;
    const s = state.current;
    /* Caught mid-flight: it stops where it is on screen and follows from there. */
    stopAnimation();
    if (s.scrimAlpha == null && scrimRef.current) {
      const m = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\)/.exec(getComputedStyle(scrimRef.current).backgroundColor);
      if (m) { s.scrimRgb = `${m[1]} ${m[2]} ${m[3]}`; s.scrimAlpha = m[4] == null ? 1 : Number(m[4]); }
    }
    s.drag = { id: e.pointerId, startY: e.clientY - s.y, engaged: s.y !== 0, samples: [{ y: e.clientY, t: e.timeStamp }], target: e.currentTarget };
    s.suppressClick = false;
    clearTimeout(s.suppressTimer);
    if (s.drag.engaged) {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      panel.style.animation = 'none';
    }
  }, [panelRef, scrimRef]);

  const onPointerMove = useCallback((e) => {
    const s = state.current;
    const d = s.drag;
    if (!d || d.id !== e.pointerId) return;
    const y = e.clientY - d.startY;
    if (!d.engaged) {
      if (Math.abs(y) < SLACK) return;
      d.engaged = true;
      /* From here it is a drag, not a tap: the sheet follows and the header's buttons do not fire. */
      d.startY += y > 0 ? SLACK : -SLACK;
      d.target.setPointerCapture?.(e.pointerId);
      const panel = panelRef.current;
      if (panel) panel.style.animation = 'none';
    }
    d.samples.push({ y: e.clientY, t: e.timeStamp });
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100) d.samples.shift();
    s.suppressClick = true;
    draw(e.clientY - d.startY);
  }, [draw, panelRef]);

  const settle = useCallback((velocity) => {
    const panel = panelRef.current;
    const s = state.current;
    if (!panel) return;
    const h = panel.offsetHeight || 1;
    const rest = s.y + project(velocity);
    const goes = velocity >= 0 && rest > h / 2;
    if (goes && !dirtyRef.current) {
      /* Away, at the finger's speed, with no bounce at the bottom. */
      /* Done once it is all but off screen: the slow tail of a spring is nothing anyone sees. */
      s.anim = spring({ from: s.y, to: h, velocity, damping: 1, response: 0.3, within: 2, onUpdate: draw, onDone: () => { s.anim = null; onDismiss(); } });
      return;
    }
    /* Back home: a sheet thrown back may overshoot a touch, as Apple's sheets do (damping 0.8, response 0.3). */
    s.anim = spring({ from: s.y, to: 0, velocity, damping: velocity ? 0.8 : 1, response: 0.3, onUpdate: draw, onDone: () => { s.anim = null; draw(0); } });
    if (goes) onAskToClose();
  }, [dirtyRef, draw, onAskToClose, onDismiss, panelRef]);

  const onPointerUp = useCallback((e) => {
    const s = state.current;
    const d = s.drag;
    if (!d || d.id !== e.pointerId) return;
    s.drag = null;
    /* The click a drag would cause comes straight after pointerup. A drag that ends off the button makes no click,
       so the flag is let go shortly after, or it would swallow the next Enter or Space on a header button. */
    if (s.suppressClick) {
      clearTimeout(s.suppressTimer);
      s.suppressTimer = setTimeout(() => { s.suppressClick = false; s.suppressTimer = null; }, 300);
    }
    if (!d.engaged) return;
    const first = d.samples[0];
    const lastSample = d.samples[d.samples.length - 1];
    const dt = (lastSample.t - first.t) / 1000;
    const velocity = dt > 0 ? (lastSample.y - first.y) / dt : 0;
    settle(Math.max(-6000, Math.min(6000, velocity)));
  }, [settle]);

  /* A drag that began on a header button must not also press it. */
  const onClickCapture = useCallback((e) => {
    if (state.current.suppressClick) {
      e.stopPropagation();
      e.preventDefault();
      state.current.suppressClick = false;
    }
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClickCapture };
}
