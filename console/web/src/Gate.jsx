import React from 'react';

import { ClorLogo } from '@ui/components/brand';

/*
 * The frame every way into the Console sits in: the same room as the Ops
 * sign-in (packages/shell/AuthLayout.jsx), drawn with the same shared classes
 * and the same picture, so CLOR staff recognise where they are. Copied in
 * shape, not imported: the Console's build takes nothing from the customer
 * shell (console/check-separation.mjs).
 */
const SRC = '/auth/signin-ops-1254.webp';
const SRC_SET = '/auth/signin-ops-960.webp 960w, /auth/signin-ops-1254.webp 1254w';

function Scene({ band = false }) {
  return (
    <div className={band ? 'ui-auth-scene-band lg:hidden' : 'ui-auth-scene'}>
      <img className="ui-auth-scene-fill" src={SRC} alt="" aria-hidden="true" decoding="async" />
      <img className="ui-auth-scene-pic" src={SRC} srcSet={SRC_SET} sizes={band ? '100vw' : '70vw'} alt="" decoding="async" fetchpriority="high" />
      <p className="ui-auth-scene-title">
        <span>CLOR Applications Private Limited</span>
        <strong>Engineering Console</strong>
      </p>
    </div>
  );
}

export default function Gate({ title, subtitle, children }) {
  return (
    <div className="ui-auth min-h-dvh has-scene">
      <div className="ui-min-h-viewport flex">
        <aside className="ui-auth-brand ui-auth-brand--scene hidden lg:flex" aria-label="About the Console" style={{ '--scene-ratio': 1 }}>
          <Scene />
        </aside>
        <main className="ui-auth-side relative flex-1 flex flex-col items-center justify-center px-6 py-10">
          <div className="relative w-full max-w-md">
            <div className="lg:hidden mb-6 text-center">
              <ClorLogo size={30} title="CLOR" />
            </div>
            <Scene band />
            <div className="ui-auth-card ui-in">
              <div className="mb-7">
                <span className="ui-auth-form-logo hidden lg:inline-flex"><ClorLogo size={30} title="CLOR" /></span>
                <h1 className="ui-auth-form-title">{title}</h1>
                {subtitle ? <p className="ui-muted mt-2 text-sm">{subtitle}</p> : null}
              </div>
              {children}
            </div>
          </div>
          <div className="ui-auth-foot">
            <p className="ui-auth-foot-line">© 2026 CLOR Applications Private Limited</p>
          </div>
        </main>
      </div>
    </div>
  );
}
