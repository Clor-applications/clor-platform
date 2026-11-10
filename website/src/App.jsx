import React, { useEffect, useRef, useState } from 'react';
import { Router, usePath } from './router.jsx';
import { routeFor, titleFor } from './routes.jsx';
import Nav from './components/Nav.jsx';
import Footer from './components/Footer.jsx';
import './styles/site.css';

/* Blocks that fade up as they reach the screen. Only ones below the first screen are hidden, so nothing visible on load ever blinks. */
const REVEAL =
  'main .head, main .app-sec-copy, main .app-sec-photo, main .apps > li, main .groups > li, main .links > li, main .faq-item, main .split > .stack, main .p-feature, main .closing-band-inner, main .demo-pic';

function useReveal(route) {
  useEffect(() => {
    const onScroll = () => document.documentElement.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return () => window.removeEventListener('scroll', onScroll);
    }
    const fold = window.innerHeight * 0.92;
    const els = [...document.querySelectorAll(REVEAL)].filter((el) => el.getBoundingClientRect().top > fold);
    const done = (e) => {
      if (e.target !== e.currentTarget) return;
      const el = e.currentTarget;
      el.classList.remove('rv', 'rv-in');
      el.style.removeProperty('--rv-i');
      el.removeEventListener('transitionend', done);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          en.target.classList.add('rv-in');
          io.unobserve(en.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
    );
    for (const el of els) {
      const sibs = el.parentElement ? [...el.parentElement.children] : [];
      el.style.setProperty('--rv-i', String(Math.min(sibs.indexOf(el), 5) % 6));
      el.classList.add('rv');
      el.addEventListener('transitionend', done);
      io.observe(el);
    }
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      for (const el of els) {
        el.classList.remove('rv', 'rv-in');
        el.removeEventListener('transitionend', done);
      }
    };
  }, [route]);
}

function Page() {
  const path = usePath();
  const route = routeFor(path);
  const first = useRef(true);
  const [said, setSaid] = useState('');
  useReveal(route);
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
