import React from 'react';
import { Calculator, ChartLineUp, Check, LockKey, Storefront, UsersThree } from '@phosphor-icons/react';
import { productBySlug } from '../site.js';
import { Mark } from './Brand.jsx';

/*
 * Small 3D scenes beside section headings (owner, 13 Nov 2026: "add 3D
 * animations or designs in empty place"). Drawn in CSS 3D from the site's own
 * marks and tiles: no stock pictures (owner, 10 Nov). Decoration only, so
 * hidden from screen readers; motion is slow and stops under reduced motion.
 *
 *   flow     four products in a line, a dot running along each wire
 *   vault    company records as separate layers, a lock on top
 *   product  one product's tower, turning slowly
 *   stairs   steps rising to a tick
 *   team     a small org chart floating over its shadow
 */
function Slab({ x, y, w, h, z = 0, d = 0, tone, children, className = '' }) {
  return (
    <div className={`slab ${className}`} style={{ '--x': `${x}px`, '--y': `${y}px`, '--w': `${w}px`, '--h': `${h}px`, '--z': `${z}px`, '--d': `${d}s`, ...(tone ? { '--slab-bg': tone.bg, '--slab-edge': tone.edge, '--slab-line': tone.line } : null) }}>
      {children}
    </div>
  );
}

function Wire({ x, y, len, d = 0, color = 'var(--accent)', down = false }) {
  return <span className={`wire${down ? ' wire--down' : ''}`} style={{ '--x': `${x}px`, '--y': `${y}px`, '--len': `${len}px`, '--d': `${d}s`, '--wire': color }} />;
}

const tint = (hex) => ({ bg: `color-mix(in srgb, ${hex} 9%, #fff)`, edge: `color-mix(in srgb, ${hex} 38%, #fff)`, line: `color-mix(in srgb, ${hex} 24%, #fff)` });

function Flow() {
  const slugs = ['people', 'attendance', 'payroll', 'books'];
  return slugs.map((s, i) => {
    const p = productBySlug(s);
    return (
      <React.Fragment key={s}>
        <Slab x={i * 104} y={0} w={72} h={72} z={18} d={i * 0.45} tone={tint(p.accent)}>
          <Mark product={p} size={40} />
        </Slab>
        {i < slugs.length - 1 ? <Wire x={i * 104 + 72} y={35} len={32} d={i * 0.6} /> : null}
      </React.Fragment>
    );
  });
}

function Vault() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <Slab key={i} x={0} y={0} w={190} h={128} z={i * 30} d={i * 0.35} className={i === 1 ? 'slab--accent' : ''}>
          <span className="slab-rows">
            <i />
            <i />
            <i />
          </span>
        </Slab>
      ))}
      <Slab x={64} y={34} w={62} h={62} z={96} d={0.9} className="slab--lock">
        <LockKey size={28} weight="duotone" />
      </Slab>
    </>
  );
}

function Product({ slug }) {
  const p = productBySlug(slug);
  const t = tint(p.accent);
  return (
    <>
      <Slab x={0} y={0} w={140} h={140} z={0} tone={t} />
      <Slab x={14} y={14} w={112} h={112} z={30} d={0.3} tone={t} />
      <Slab x={30} y={30} w={80} h={80} z={62} d={0.6} tone={t}>
        <Mark product={p} size={48} />
      </Slab>
    </>
  );
}

function Stairs() {
  return [0, 1, 2, 3].map((i) => (
    <Slab key={i} x={i * 66} y={0} w={66} h={92} z={i * 22} d={i * 0.3} className={i === 3 ? 'slab--accent' : ''}>
      {i === 3 ? (
        <span className="slab-tick">
          <Check size={22} weight="bold" />
        </span>
      ) : (
        <span className="slab-num">{i + 1}</span>
      )}
    </Slab>
  ));
}

function Team() {
  const kids = [Storefront, Calculator, ChartLineUp];
  return (
    <>
      <Slab x={92} y={0} w={64} h={64} z={14} className="slab--accent">
        <UsersThree size={28} weight="duotone" />
      </Slab>
      <Wire x={123} y={64} len={44} d={0} down />
      <Wire x={28} y={108} len={192} d={0.5} />
      {kids.map((Icon, i) => (
        <React.Fragment key={i}>
          <Wire x={28 + i * 96} y={108} len={32} d={1 + i * 0.3} down />
          <Slab x={i * 96} y={140} w={56} h={56} z={14} d={0.4 + i * 0.35}>
            <Icon size={24} weight="duotone" />
          </Slab>
        </React.Fragment>
      ))}
    </>
  );
}

const SCENES = { flow: Flow, vault: Vault, product: Product, stairs: Stairs, team: Team };

export function Art3D({ kind, product }) {
  const Scene = SCENES[kind];
  return (
    <div className="art3d" data-kind={kind} aria-hidden="true">
      <div className="art3d-plane">
        <span className="art3d-shadow" />
        <Scene slug={product} />
      </div>
    </div>
  );
}
