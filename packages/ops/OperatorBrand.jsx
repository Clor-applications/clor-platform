import React from 'react';
import { FileClock, KeyRound, ShieldCheck, UserCog } from 'lucide-react';

/**
 * The brand side of the operator console's sign-in.
 *
 * Not clor.in's hero: the people who reach ops.clor.in are Clor staff, and a
 * pitch about running your business says nothing to them. What it says
 * instead is what is true of this door — an authenticator is required, roles
 * decide what you may touch, and everything you do is written down.
 *
 * The drawing is a console behind a lock, an audit trail and an authenticator
 * code. No customer data, no customer names: it is all shapes.
 */

const POINTS = [
  { Icon: KeyRound, text: 'Authenticator required' },
  { Icon: UserCog, text: 'Access by operator role' },
  { Icon: ShieldCheck, text: 'Step-up for every change' },
  { Icon: FileClock, text: 'Every action audited' },
];

const ink = 'rgb(var(--auth-ink))';
const ink2 = 'rgb(var(--auth-ink-2))';
const line = 'rgb(var(--auth-line))';
const accent = 'rgb(var(--auth-accent))';
const paper = '#fff';

function OperatorArt() {
  const rows = [0, 1, 2, 3, 4];
  return (
    <svg className="ops-auth-art" viewBox="0 0 560 380" role="img" aria-label="A locked operator console beside an audit trail and an authenticator code.">
      <defs>
        <filter id="ops-auth-shadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="14" stdDeviation="16" floodColor="rgb(32 35 35)" floodOpacity="0.10" />
        </filter>
      </defs>

      {/* The console window */}
      <g filter="url(#ops-auth-shadow)">
        <rect x="24" y="36" width="360" height="270" rx="14" fill={paper} stroke={line} />
      </g>
      <rect x="24" y="36" width="360" height="34" rx="14" fill="rgb(var(--auth-bg))" />
      <rect x="24" y="56" width="360" height="14" fill="rgb(var(--auth-bg))" />
      <line x1="24" y1="70" x2="384" y2="70" stroke={line} />
      {[44, 58, 72].map((cx) => <circle key={cx} cx={cx} cy="53" r="4" fill={line} />)}
      <rect x="250" y="47" width="54" height="13" rx="6.5" fill={accent} opacity="0.14" />
      <rect x="258" y="52" width="38" height="3" rx="1.5" fill={accent} />

      {/* Sidebar */}
      <line x1="104" y1="70" x2="104" y2="306" stroke={line} />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x="38" y={88 + i * 26} width="12" height="12" rx="3" fill={i === 0 ? accent : line} />
          <rect x="56" y={92 + i * 26} width={i === 0 ? 34 : 28} height="4" rx="2" fill={i === 0 ? ink : line} />
        </g>
      ))}

      {/* Stat tiles */}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={120 + i * 86} y="86" width="76" height="48" rx="8" fill="none" stroke={line} />
          <rect x={130 + i * 86} y="96" width="30" height="4" rx="2" fill={line} />
          <rect x={130 + i * 86} y="110" width={i === 1 ? 26 : 40} height="10" rx="3" fill={i === 1 ? accent : ink} opacity={i === 1 ? 1 : 0.85} />
        </g>
      ))}

      {/* Account rows */}
      {rows.map((i) => (
        <g key={i}>
          <line x1="120" y1={154 + i * 28} x2="368" y2={154 + i * 28} stroke={line} />
          <circle cx="130" cy={168 + i * 28} r="4" fill={i === 2 ? accent : ink2} opacity={i === 2 ? 1 : 0.35} />
          <rect x="142" y={166 + i * 28} width={[78, 62, 70, 84, 58][i]} height="4" rx="2" fill={ink} opacity="0.55" />
          <rect x="300" y={166 + i * 28} width="52" height="4" rx="2" fill={line} />
        </g>
      ))}

      {/* The lock over the console */}
      <g transform="translate(244 200)">
        <circle r="44" fill={paper} stroke={line} />
        <circle r="34" fill={accent} opacity="0.12" />
        <path d="M-11 -4 v-8 a11 11 0 0 1 22 0 v8" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" />
        <rect x="-17" y="-5" width="34" height="26" rx="6" fill={ink} />
        <circle cy="6" r="3.5" fill={paper} />
        <rect x="-1.5" y="7" width="3" height="7" rx="1.5" fill={paper} />
      </g>

      {/* Audit trail card */}
      <g filter="url(#ops-auth-shadow)">
        <rect x="330" y="150" width="206" height="150" rx="12" fill={paper} stroke={line} />
      </g>
      <rect x="348" y="166" width="58" height="5" rx="2.5" fill={ink} />
      <line x1="356" y1="190" x2="356" y2="284" stroke={line} strokeWidth="2" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <circle cx="356" cy={192 + i * 30} r="5" fill={i === 0 ? accent : paper} stroke={i === 0 ? accent : ink2} strokeWidth="1.5" />
          <rect x="370" y={188 + i * 30} width={[110, 92, 120, 80][i]} height="4" rx="2" fill={ink} opacity="0.6" />
          <rect x="370" y={197 + i * 30} width="44" height="3" rx="1.5" fill={line} />
        </g>
      ))}

      {/* Authenticator code */}
      <g filter="url(#ops-auth-shadow)">
        <rect x="380" y="20" width="156" height="104" rx="12" fill={paper} stroke={line} />
      </g>
      <g transform="translate(398 38)">
        <rect width="20" height="20" rx="6" fill={accent} opacity="0.14" />
        <path d="M10 4 l6 2.5 v4.5 c0 3.5 -2.6 5.8 -6 6.8 c-3.4 -1 -6 -3.3 -6 -6.8 v-4.5 z" fill="none" stroke={accent} strokeWidth="1.6" strokeLinejoin="round" />
      </g>
      <rect x="426" y="45" width="56" height="5" rx="2.5" fill={ink} opacity="0.7" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x={398 + i * 21 + (i > 2 ? 6 : 0)} y="72" width="15" height="22" rx="4" fill="rgb(var(--auth-bg))" stroke={line} />
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle key={i} cx={405.5 + i * 21 + (i > 2 ? 6 : 0)} cy="83" r="2.6" fill={ink} />
      ))}
      <rect x="398" y="106" width="120" height="3" rx="1.5" fill={line} />
      <rect x="398" y="106" width="78" height="3" rx="1.5" fill={accent} />
    </svg>
  );
}

export default function OperatorBrand() {
  return (
    <>
      <div className="ui-auth-copy">
        <p className="ui-auth-eyebrow">Clor operator console</p>
        <h2 className="ui-auth-title">For Clor staff only.</h2>
        <p className="ui-auth-lede">
          Sign in with your own Clor account and your authenticator. What you can see and change depends on your operator role, and every
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
    </>
  );
}
