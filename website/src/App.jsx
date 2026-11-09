import React, { useEffect, useRef, useState } from 'react';
import { Router, usePath } from './router.jsx';
import { routeFor, titleFor } from './routes.jsx';
import Nav from './components/Nav.jsx';
import Footer from './components/Footer.jsx';
import './styles/site.css';

function Page() {
  const path = usePath();
  const route = routeFor(path);
  const first = useRef(true);
  const [said, setSaid] = useState('');
  useEffect(() => {
    document.title = titleFor(route);
    /* The first load is the browser's own; after an in-page move, focus lands on the new page and its title is read out. */
    if (first.current) {
      first.current = false;
      return undefined;
    }
    document.getElementById('main')?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => setSaid(titleFor(route)));
    return () => cancelAnimationFrame(frame);
  }, [route]);
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1}>
        {route.page()}
      </main>
      <Footer />
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {said}
      </p>
    </>
  );
}

export default function App({ path }) {
  return (
    <Router initialPath={path}>
      <Page />
    </Router>
  );
}
