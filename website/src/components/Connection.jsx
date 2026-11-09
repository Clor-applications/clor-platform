import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AttendanceWindow, BooksWindow, PayrollWindow, PeopleWindow } from './Windows.jsx';

/*
 * "Clor Connection": the site's one orchestrated moment.
 *
 * Four Clor products, each a window of its own, joined by the paths that
 * exist in the platform today: People gives Attendance its people, the closed
 * attendance month goes to Payroll, the locked pay run posts to Books. The
 * orange dot from the Clor mark travels that route once, each line drawing
 * ahead of it, and rests on Books. With reduced motion (or before the script
 * runs) the windows are simply shown.
 *
 * The lines are measured from where the windows actually are, so they meet
 * them at any width.
 */
const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const LABELS = ['One employee record', 'Month closed', 'Journal posted'];

/** Anchor points on a window's box, relative to the stage. */
function anchors(el, box) {
  const r = el.getBoundingClientRect();
  const x = r.left - box.left;
  const y = r.top - box.top;
  return { l: [x, y + r.height * 0.42], r: [x + r.width, y + r.height * 0.42], b: [x + r.width * 0.5, y + r.height], t: [x + r.width * 0.55, y] };
}
const curve = ([x0, y0], [x3, y3], horizontal) => {
  const c1 = horizontal ? [x0 + (x3 - x0) * 0.5, y0] : [x0, y0 + (y3 - y0) * 0.6];
  const c2 = horizontal ? [x0 + (x3 - x0) * 0.5, y3] : [x3, y3 - (y3 - y0) * 0.6];
  const mid = [(x0 + 3 * c1[0] + 3 * c2[0] + x3) / 8, (y0 + 3 * c1[1] + 3 * c2[1] + y3) / 8];
  return { d: `M ${x0} ${y0} C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${x3} ${y3}`, mid, start: [x0, y0], end: [x3, y3] };
};

export default function Connection() {
  const ref = useRef(null);
  const wins = useRef({});
  const motions = useRef([]);
  const [geo, setGeo] = useState(null);
  const [phase, setPhase] = useState('idle');

  useIso(() => {
    const stage = ref.current;
    const measure = () => {
      if (window.matchMedia('(max-width: 720px)').matches) return setGeo(null);
      const box = stage.getBoundingClientRect();
      const a = Object.fromEntries(Object.entries(wins.current).map(([k, el]) => [k, anchors(el, box)]));
      setGeo({
        w: box.width,
        h: box.height,
        routes: [curve(a.people.r, a.attendance.l, true), curve(a.attendance.b, a.payroll.t, false), curve(a.payroll.r, a.books.l, true)],
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!geo || phase !== 'idle') return undefined;
    /* On the next frame, not inside the effect (react-hooks/set-state-in-effect). */
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = requestAnimationFrame(() => setPhase(still ? 'still' : 'armed'));
    return () => cancelAnimationFrame(frame);
  }, [geo, phase]);

  useEffect(() => {
    if (phase !== 'armed') return undefined;
    const io = new IntersectionObserver(
      (e) => {
        if (!e.some((x) => x.isIntersecting)) return;
        io.disconnect();
        setPhase('play');
        motions.current.forEach((m, i) => setTimeout(() => m?.beginElement?.(), 900 + i * 1300));
        setTimeout(() => setPhase('done'), 900 + motions.current.length * 1300 + 200);
      },
      { threshold: 0.3 }
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [phase]);

  const end = geo?.routes[geo.routes.length - 1].end;
  const keep = (k) => (el) => {
    if (el) wins.current[k] = el;
  };
  return (
    <figure className={`stage stage--${phase}`}>
      <div className="stage-box" ref={ref}>
        {geo ? (
          <svg className="stage-lines" viewBox={`0 0 ${geo.w} ${geo.h}`} aria-hidden="true">
            {geo.routes.map((r, i) => (
              <g key={i} className="route" style={{ '--i': i }}>
                <path id={`route-${i}`} d={r.d} pathLength="1" className="route-line" />
                <circle cx={r.start[0]} cy={r.start[1]} r="4" className="route-node" />
              </g>
            ))}
            {/* The moving dot sits at the origin: its path supplies the position. */}
            <circle r="7" className="route-dot route-dot--moving">
              {geo.routes.map((_, i) => (
                <animateMotion key={i} ref={(m) => (motions.current[i] = m)} begin="indefinite" dur="1.1s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.45 0 0.2 1">
                  <mpath href={`#route-${i}`} />
                </animateMotion>
              ))}
            </circle>
            <circle r="7" cx={end[0]} cy={end[1]} className="route-dot route-dot--still" />
          </svg>
        ) : null}
        {/* Labels as text on the page, not in the drawing: crisp at any size, readable by assistive tech. */}
        {geo
          ? geo.routes.map((r, i) => (
              <span key={i} className="route-chip" style={{ left: r.mid[0], top: r.mid[1], '--i': i }}>
                {LABELS[i]}
              </span>
            ))
          : null}
        <div ref={keep('people')} className="stage-slot stage-slot--people">
          <PeopleWindow className="stage-win" />
        </div>
        <div ref={keep('attendance')} className="stage-slot stage-slot--attendance">
          <AttendanceWindow className="stage-win" />
        </div>
        <div ref={keep('payroll')} className="stage-slot stage-slot--payroll">
          <PayrollWindow className="stage-win" />
        </div>
        <div ref={keep('books')} className="stage-slot stage-slot--books">
          <BooksWindow className="stage-win" />
        </div>
      </div>
      <figcaption className="caption">CLOR screens drawn with sample data. Each line is a link between products that works today.</figcaption>
    </figure>
  );
}
