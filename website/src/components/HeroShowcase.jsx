import React, { useState } from 'react';
import { ArrowUpRight, Pause, Play, ScanFace } from 'lucide-react';
import { Link } from '../router.jsx';

/**
 * The home-page hero uses CLOR's *existing* photography, not empty mockup panels.
 * The tiny story cards provide a playable CSS clip. The primary photograph never
 * disappears, and reduced-motion visitors always get a fully composed static hero.
 */
export default function HeroShowcase() {
  const [playing, setPlaying] = useState(true);
  return (
    <figure className={`showcase${playing ? '' : ' showcase--paused'}`} aria-label="CLOR connected business application showcase">
      <div className="showcase-mesh" aria-hidden="true" />
      <div className="showcase-main">
        <img
          src="/people/hero-books-soft-1400.webp"
          srcSet="/people/hero-books-soft-700.webp 700w, /people/hero-books-soft-1400.webp 1400w"
          sizes="(max-width: 900px) 100vw, 640px"
          width="1400"
          height="835"
          fetchPriority="high"
          decoding="async"
          alt="An accountant using the CLOR Books dashboard on a laptop in a real office"
        />
        <span className="showcase-main-label" aria-hidden="true"><span className="showcase-live-dot" /> CLOR Books · At work</span>
      </div>

      <div className="showcase-story showcase-story--people" aria-hidden="true">
        <img src="/people/people-hr-700.webp" width="700" height="788" loading="lazy" decoding="async" alt="" />
        <span className="showcase-story-copy">
          <span>CLOR People</span>
          <strong>Every person. One record.</strong>
        </span>
      </div>
      <div className="showcase-story showcase-story--attendance" aria-hidden="true">
        <img src="/people/attendance-reader-700.webp" width="700" height="1050" loading="lazy" decoding="async" alt="" />
        <span className="showcase-story-copy">
          <span>CLOR Attendance</span>
          <strong>Every shift, accounted for.</strong>
        </span>
      </div>
      <div className="showcase-story showcase-story--payroll" aria-hidden="true">
        <img src="/people/payroll-payslip-560.webp" width="560" height="700" loading="lazy" decoding="async" alt="" />
        <span className="showcase-story-copy">
          <span>CLOR Payroll</span>
          <strong>From time to payslip.</strong>
        </span>
      </div>

      <figcaption className="showcase-caption">
        <div className="showcase-caption-text">
          <span className="showcase-kicker"><ScanFace size={15} aria-hidden="true" /> CLOR IN MOTION</span>
          <span className="showcase-sub">Your business apps, better together.</span>
        </div>
        <div className="showcase-timeline" aria-hidden="true"><span /></div>
        <button
          type="button"
          className="showcase-play"
          onClick={() => setPlaying((current) => !current)}
          aria-label={playing ? 'Pause hero animation' : 'Play hero animation'}
          aria-pressed={!playing}
        >
          {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        </button>
        <Link className="showcase-link" href="/products" aria-label="Explore CLOR applications"><ArrowUpRight size={17} aria-hidden="true" /></Link>
      </figcaption>
    </figure>
  );
}
