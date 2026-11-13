import React from 'react';
import { FileClock, KeyRound, ShieldCheck, UserCog } from '@ui/components/ui/lineIcons';

/**
 * The brand side of the operator console's sign-in.
 *
 * Not clor.in's hero: the people who reach ops.clor.in are CLOR staff, and a
 * pitch about running your business says nothing to them. What it says
 * instead is what is true of this door — an authenticator is required, roles
 * decide what you may touch, and everything you do is written down.
 *
 * The picture (13 Nov 2026, owner: "ops portal needs an illustration like the
 * other sign-in pages") is a scene on navy in the site's own hand: the three
 * lit outlines, a console window behind a lock, an authenticator code and an
 * audit trail standing over its edges. Drawn in markup, so it is sharp at any
 * size and needs no file. No customer data, no customer names: the rows are
 * shapes, and only the console's own words are words.
 */

const POINTS = [
  { Icon: KeyRound, text: 'Authenticator required' },
  { Icon: UserCog, text: 'Access by operator role' },
  { Icon: ShieldCheck, text: 'Step-up for every change' },
  { Icon: FileClock, text: 'Every action audited' },
];

const TILES = [
  ['Accounts', 'ok'],
  ['Tickets', 'warn'],
  ['Health', 'ok'],
];
/* One row per account: how long its name and plan bars are, and its state. */
const ROWS = [
  [62, 34, 'ok'],
  [48, 40, 'ok'],
  [56, 30, 'warn'],
  [70, 36, 'ok'],
];
const TRAIL = [72, 56, 64];

function OperatorArt() {
  return (
    <div className="oa-scene" role="img" aria-label="A locked operator console with an authenticator code and an audit trail beside it.">
      <span className="oa-ring oa-ring--1" />
      <span className="oa-ring oa-ring--2" />
      <span className="oa-ring oa-ring--3" />

      <div className="oa-win">
        <div className="oa-rail">
          <span className="oa-rail-mark">
            <ShieldCheck size={16} strokeWidth={2} />
          </span>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={i === 0 ? 'is-on' : undefined} />
          ))}
        </div>
        <div className="oa-main">
          <div className="oa-bar">
            <strong>Operator console</strong>
            <span className="oa-pill">Locked</span>
          </div>
          <div className="oa-tiles">
            {TILES.map(([name, state]) => (
              <div key={name} className="oa-tile">
                <span>{name}</span>
                <i className={`oa-dot oa-dot--${state}`} />
                <b />
              </div>
            ))}
          </div>
          <ul className="oa-rows">
            {ROWS.map(([name, plan, state], i) => (
              <li key={i}>
                <i className={`oa-dot oa-dot--${state}`} />
                <b style={{ width: `${name}%` }} />
                <em style={{ width: `${plan}%` }} />
              </li>
            ))}
          </ul>
        </div>
        <span className="oa-lock">
          <KeyRound size={26} strokeWidth={2} />
        </span>
      </div>

      <div className="oa-note oa-note--code">
        <span className="oa-note-icon">
          <ShieldCheck size={18} strokeWidth={2} />
        </span>
        <div>
          <strong>Authenticator code</strong>
          <span className="oa-code">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <i key={i} />
            ))}
          </span>
          <span className="oa-code-bar">
            <i />
          </span>
        </div>
      </div>

      <div className="oa-note oa-note--trail">
        <span className="oa-note-icon oa-note-icon--warm">
          <FileClock size={18} strokeWidth={2} />
        </span>
        <div>
          <strong>Audit log</strong>
          <ul>
            {TRAIL.map((w, i) => (
              <li key={i}>
                <i />
                <b style={{ width: `${w}%` }} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function OperatorBrand() {
  return (
    <div className="oa-brand">
      <div className="ui-auth-copy">
        <p className="ui-auth-eyebrow">CLOR operator console</p>
        <h2 className="ui-auth-title">For CLOR staff only.</h2>
        <p className="ui-auth-lede">
          Sign in with your own CLOR account and your authenticator. What you can see and change depends on your operator role, and every
          change is recorded in the audit log.
        </p>
        <ul className="ui-auth-points">
          {POINTS.map(({ Icon, text }) => (
            <li key={text}>
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              {text}
            </li>
          ))}
        </ul>
      </div>
      <OperatorArt />
    </div>
  );
}
