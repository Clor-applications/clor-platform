import React, { useEffect } from 'react';
import { Router, usePath } from './router.jsx';
import { routeFor, titleFor } from './routes.jsx';
import Nav from './components/Nav.jsx';
import Footer from './components/Footer.jsx';
import './styles/site.css';

function Page() {
  const path = usePath();
  const route = routeFor(path);
  useEffect(() => {
    document.title = titleFor(route);
  }, [route]);
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main">{route.page()}</main>
      <Footer />
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
