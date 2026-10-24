import React from 'react';

/**
 * The Overview hero's illustration: a pale office block with a glass annex,
 * trees either side, drawn soft so it sits behind the greeting rather than
 * competing with it. Colours are the --ws-art-* tokens in workspace.css.
 * Decorative only: hidden from assistive technology.
 */
const FRONT_COLS = [0, 1, 2, 3];
const FRONT_ROWS = [0, 1, 2, 3];

export default function HeroBuilding() {
  return (
    <svg className="ws-hero-art" viewBox="0 0 560 230" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="hbWall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'rgb(var(--ws-art-wall-top))' }} />
          <stop offset="1" style={{ stopColor: 'rgb(var(--ws-art-wall))' }} />
        </linearGradient>
        <linearGradient id="hbSide" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'rgb(var(--ws-art-side))' }} />
          <stop offset="1" style={{ stopColor: 'rgb(var(--ws-art-side-deep))' }} />
        </linearGradient>
        <linearGradient id="hbPane" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'rgb(var(--ws-art-pane-light))' }} />
          <stop offset="1" style={{ stopColor: 'rgb(var(--ws-art-pane))' }} />
        </linearGradient>
        <linearGradient id="hbGlass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'rgb(var(--ws-art-glass-top))' }} />
          <stop offset="1" style={{ stopColor: 'rgb(var(--ws-art-glass))' }} />
        </linearGradient>
        <radialGradient id="hbShadow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" style={{ stopColor: 'rgb(var(--ws-art-shadow))', stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: 'rgb(var(--ws-art-shadow))', stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id="hbFade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.22" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="0.4" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id="hbMask">
          <rect width="560" height="230" fill="url(#hbFade)" />
        </mask>
      </defs>

      <g mask="url(#hbMask)">
        {/* soft ground and shadow */}
        <ellipse cx="330" cy="214" rx="250" ry="12" fill="url(#hbShadow)" />
        <rect x="40" y="212" width="510" height="1.5" rx="0.75" style={{ fill: 'rgb(var(--ws-art-line))' }} />

        {/* back tree, left */}
        <g>
          <path d="M118 212 L118 160 M118 178 L106 166 M118 172 L130 160" style={{ stroke: 'rgb(var(--ws-art-trunk))' }} strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <circle cx="98" cy="160" r="22" style={{ fill: 'rgb(var(--ws-art-leaf-2))' }} />
          <circle cx="122" cy="146" r="28" style={{ fill: 'rgb(var(--ws-art-leaf))' }} />
          <circle cx="146" cy="162" r="20" style={{ fill: 'rgb(var(--ws-art-leaf-2))' }} />
          <circle cx="114" cy="138" r="14" style={{ fill: 'rgb(var(--ws-art-leaf-light))' }} />
        </g>

        {/* rooftop plant room */}
        <rect x="262" y="18" width="70" height="20" rx="2" style={{ fill: 'rgb(var(--ws-art-roof))' }} />
        <rect x="258" y="14" width="78" height="5" rx="1.5" style={{ fill: 'rgb(var(--ws-art-side))' }} />

        {/* main block: front face */}
        <rect x="200" y="44" width="160" height="168" fill="url(#hbWall)" />
        {/* parapet */}
        <rect x="194" y="36" width="172" height="10" rx="2" style={{ fill: 'rgb(var(--ws-art-roof))' }} />
        {/* side face, for depth */}
        <polygon points="360,44 404,56 404,212 360,212" fill="url(#hbSide)" />
        <polygon points="366,36 410,48 404,56 360,44" style={{ fill: 'rgb(var(--ws-art-side-deep))' }} />

        {/* front windows: tall panes with a mullion */}
        {FRONT_ROWS.map((r) =>
          FRONT_COLS.map((c) => {
            const x = 214 + c * 36;
            const y = 58 + r * 30;
            return (
              <g key={`${r}-${c}`}>
                <rect x={x} y={y} width="24" height="22" rx="1.5" fill="url(#hbPane)" style={{ stroke: 'rgb(var(--ws-art-frame))' }} strokeWidth="1" />
                <line x1={x + 12} y1={y + 1} x2={x + 12} y2={y + 21} style={{ stroke: 'rgb(var(--ws-art-frame))' }} strokeWidth="1" />
              </g>
            );
          })
        )}
        {/* floor bands */}
        {[0, 1, 2, 3].map((r) => (
          <rect key={r} x="200" y={82 + r * 30} width="160" height="1" style={{ fill: 'rgb(var(--ws-art-line))' }} />
        ))}

        {/* ground floor: shopfront and door */}
        <rect x="208" y="180" width="94" height="32" rx="1.5" fill="url(#hbPane)" style={{ stroke: 'rgb(var(--ws-art-frame))' }} strokeWidth="1" />
        <line x1="239" y1="181" x2="239" y2="211" style={{ stroke: 'rgb(var(--ws-art-frame))' }} />
        <line x1="270" y1="181" x2="270" y2="211" style={{ stroke: 'rgb(var(--ws-art-frame))' }} />
        <rect x="314" y="176" width="34" height="36" rx="1.5" style={{ fill: 'rgb(var(--ws-art-door))' }} />
        <rect x="310" y="172" width="42" height="5" rx="1.5" style={{ fill: 'rgb(var(--ws-art-roof))' }} />

        {/* side windows */}
        {[0, 1, 2, 3].map((r) => (
          <g key={r} style={{ fill: 'rgb(var(--ws-art-pane))' }} opacity="0.75">
            <polygon points={`368,${66 + r * 30} 380,${69 + r * 30} 380,${87 + r * 30} 368,${84 + r * 30}`} />
            <polygon points={`388,${71 + r * 30} 398,${74 + r * 30} 398,${92 + r * 30} 388,${89 + r * 30}`} />
          </g>
        ))}

        {/* glass annex */}
        <rect x="404" y="104" width="78" height="108" fill="url(#hbGlass)" />
        <rect x="400" y="98" width="86" height="8" rx="2" style={{ fill: 'rgb(var(--ws-art-wall-top))' }} />
        {[0, 1, 2].map((c) => (
          <rect key={c} x={404 + 26 * (c + 1)} y="106" width="1.5" height="106" style={{ fill: 'rgb(var(--ws-art-glass-frame))' }} />
        ))}
        {[0, 1, 2].map((r) => (
          <rect key={r} x="404" y={136 + r * 26} width="78" height="1.5" style={{ fill: 'rgb(var(--ws-art-glass-frame))' }} />
        ))}
        {/* reflection */}
        <polygon points="410,110 426,110 412,150 404,150" style={{ fill: 'rgb(var(--ws-art-glass-frame))' }} opacity="0.35" />

        {/* railing in front */}
        <g style={{ stroke: 'rgb(var(--ws-art-line))' }} strokeWidth="1.2">
          <line x1="420" y1="204" x2="520" y2="204" />
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
            <line key={i} x1={420 + i * 10} y1="204" x2={420 + i * 10} y2="212" />
          ))}
        </g>

        {/* front trees, right */}
        <g>
          <path d="M498 212 L498 182" style={{ stroke: 'rgb(var(--ws-art-trunk))' }} strokeWidth="2" strokeLinecap="round" />
          <circle cx="490" cy="182" r="13" style={{ fill: 'rgb(var(--ws-art-leaf-2))' }} />
          <circle cx="504" cy="174" r="15" style={{ fill: 'rgb(var(--ws-art-leaf))' }} />
          <circle cx="498" cy="168" r="8" style={{ fill: 'rgb(var(--ws-art-leaf-light))' }} />
          <path d="M538 212 L538 192" style={{ stroke: 'rgb(var(--ws-art-trunk))' }} strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="532" cy="192" r="9" style={{ fill: 'rgb(var(--ws-art-leaf))' }} />
          <circle cx="543" cy="188" r="10" style={{ fill: 'rgb(var(--ws-art-leaf-2))' }} />
        </g>
        {/* shrubs at the door */}
        <g style={{ fill: 'rgb(var(--ws-art-leaf-2))' }}>
          <ellipse cx="190" cy="208" rx="14" ry="7" />
          <ellipse cx="370" cy="208" rx="12" ry="6" />
        </g>
      </g>
    </svg>
  );
}
