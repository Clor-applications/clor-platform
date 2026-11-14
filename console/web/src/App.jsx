import React, { useCallback, useEffect, useState } from 'react';
import { Activity, GitPullRequest, KeyRound, ListChecks, LogOut, Rocket, Users } from 'lucide-react';

import ClorMark from '@ui/components/brand/ClorMark';

import { api } from './api';
import { GuardProvider, Loading, Notice } from './kit';
import Audit from './Audit';
import Enrol from './Enrol';
import Members from './Members';
import Overview from './Overview';
import Pulls from './Pulls';
import Releases from './Releases';
import SignIn from './SignIn';
import SignInCode from './SignInCode';
import YourSignIn from './YourSignIn';

const SCREENS = [
  { path: '/', label: 'Overview', icon: Activity, screen: Overview },
  { path: '/releases', label: 'Releases', icon: Rocket, screen: Releases },
  { path: '/pulls', label: 'Pull requests', icon: GitPullRequest, screen: Pulls },
  { path: '/log', label: 'Log', icon: ListChecks, screen: Audit },
  { path: '/members', label: 'Members', icon: Users, screen: Members, owner: true },
  { path: '/sign-in', label: 'Your sign-in', icon: KeyRound, screen: YourSignIn },
];
const ROLE = { OWNER: 'Owner', ENGINEER: 'Engineer', VIEWER: 'Viewer' };
function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const go = useCallback((to) => {
    window.history.pushState({}, '', to);
    setPath(to);
    window.scrollTo(0, 0);
  }, []);
  return [path, go];
}

export default function App() {
  const [me, setMe] = useState(undefined);
  const [error, setError] = useState('');
  const [path, go] = usePath();

  const load = useCallback(
    () =>
      api.me().then(setMe, (e) => {
        if (e.status === 401 || e.status === 403) setMe(null);
        else setError(e.message);
      }),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <main className="con-gate"><div className="con-gate-box"><Notice tone="bad">{error}</Notice><button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setError(''); load(); }}>Try again</button></div></main>;
  if (me === undefined) return <main className="con-gate"><Loading /></main>;
  if (me === null) return <SignIn onDone={load} />;
  if (!me.authenticator) return <Enrol me={me} onDone={load} />;
  if (me.needsCode) return <SignInCode me={me} onDone={load} />;

  const screens = SCREENS.filter((s) => !s.owner || me.role === 'OWNER');
  const current = screens.find((s) => s.path === path) || screens[0];
  const Screen = current.screen;
  const signOut = () => api.signOut().finally(() => window.location.assign('/'));

  return (
    <GuardProvider>
      <div className="con-shell">
        <a className="con-skip" href="#con-main">Skip to content</a>
        <aside className="con-side">
          <div className="con-brand">
            <ClorMark size={24} />
            <span>Console</span>
          </div>
          <nav aria-label="Console">
            <ul className="con-nav">
              {screens.map((s) => (
                <li key={s.path}>
                  <a href={s.path} className="con-nav-item" aria-current={s === current ? 'page' : undefined} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); go(s.path); }}>
                    <s.icon size={16} aria-hidden="true" />
                    <span>{s.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="con-who">
            <div className="con-who-text">
              <span className="con-who-name">{me.name}</span>
              <span className="con-quiet">{ROLE[me.role]}</span>
            </div>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={16} aria-hidden="true" /></button>
          </div>
        </aside>
        <main id="con-main" className="con-main" tabIndex={-1}>
          <Screen me={me} go={go} reloadMe={load} />
        </main>
      </div>
    </GuardProvider>
  );
}
