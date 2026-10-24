import React, { useEffect, useRef, useState } from 'react';
import { Link, usePath } from '../router.jsx';
import { NAV, PRODUCTS, SITE } from '../site.js';
import { Logo, Mark, Status } from './Brand.jsx';

const CATEGORIES = ['Finance', 'HR', 'Operations'];

function ProductsMenu({ onPick }) {
  return (
    <div className="mega mega--products">
      <div className="mega-grid">
        {CATEGORIES.map((cat) => (
          <div key={cat} className="mega-col">
            <p className="mega-cat">{cat}</p>
            <ul>
              {PRODUCTS.filter((p) => p.category === cat).map((p) => (
                <li key={p.slug}>
                  <Link href={`/products/${p.slug}`} className="mega-item" onClick={onPick}>
                    <Mark product={p} size={34} />
                    <span className="mega-text">
                      <span className="mega-name">
                        Clor {p.name} <Status product={p} />
                      </span>
                      <span className="mega-line">{p.line}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mega-foot">
        <p className="small">Choose the products you need. They share one workspace, one sign-in and one set of people.</p>
        <Link href="/products" className="btn btn--text" onClick={onPick}>
          See all products
        </Link>
      </div>
    </div>
  );
}

function ListMenu({ items, onPick }) {
  return (
    <div className="mega mega--list">
      <ul>
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="mega-item mega-item--plain" onClick={onPick}>
              <span className="mega-text">
                <span className="mega-name">{i.name}</span>
                <span className="mega-line">{i.line}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MENUS = [
  { key: 'products', label: 'Products' },
  { key: 'solutions', label: 'Solutions', items: NAV.solutions },
  { key: 'pricing', label: 'Pricing', href: '/pricing' },
  { key: 'resources', label: 'Resources', items: NAV.resources },
  { key: 'company', label: 'Company', items: NAV.company },
];

export default function Nav() {
  const path = usePath();
  const [open, setOpen] = useState(null);
  const [mobile, setMobile] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const ref = useRef(null);
  const close = () => {
    setOpen(null);
    setMobile(false);
  };

  useEffect(close, [path]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && close();
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(null);
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onClick);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onClick);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  useEffect(() => {
    document.body.style.overflow = mobile ? 'hidden' : '';
  }, [mobile]);

  const section = (key) => (key === 'products' ? path.startsWith('/products') : MENUS.find((m) => m.key === key)?.items?.some((i) => path.startsWith(i.href)));

  return (
    <>
    <header className={`nav${scrolled ? ' nav--scrolled' : ''}`} ref={ref}>
      <div className="wrap nav-bar">
        <Logo />
        <nav className="nav-main" aria-label="Main">
          <ul>
            {MENUS.map((m) =>
              m.href ? (
                <li key={m.key}>
                  <Link href={m.href} className={`nav-trigger${path === m.href ? ' is-current' : ''}`} aria-current={path === m.href ? 'page' : undefined}>
                    {m.label}
                  </Link>
                </li>
              ) : (
                <li key={m.key} onMouseEnter={() => setOpen(m.key)} onMouseLeave={() => setOpen(null)}>
                  <button type="button" className={`nav-trigger${section(m.key) ? ' is-current' : ''}`} aria-expanded={open === m.key} onClick={() => setOpen(open === m.key ? null : m.key)}>
                    {m.label}
                    <svg viewBox="0 0 12 12" aria-hidden="true" width="10" height="10">
                      <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <div className={`mega-wrap${open === m.key ? ' is-open' : ''}`}>{m.key === 'products' ? <ProductsMenu onPick={close} /> : <ListMenu items={m.items} onPick={close} />}</div>
                </li>
              )
            )}
          </ul>
        </nav>
        <div className="nav-end">
          <a className="btn btn--text nav-signin" href={SITE.signInUrl}>
            Sign in
          </a>
          <a className="btn btn--primary" href={SITE.signUpUrl}>
            Get started
          </a>
          <button type="button" className="nav-burger" aria-expanded={mobile} aria-controls="mobile-menu" onClick={() => setMobile(!mobile)}>
            <span className="sr-only">{mobile ? 'Close menu' : 'Open menu'}</span>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              {mobile ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 8h16M4 16h16" />}
            </svg>
          </button>
        </div>
      </div>
    </header>

      {/* Outside the header: its backdrop blur would otherwise be the box this fixed panel is placed in. */}
      <div id="mobile-menu" className={`mobile${mobile ? ' is-open' : ''}`} hidden={!mobile}>
        <div className="wrap">
          <p className="mega-cat">Products</p>
          <ul className="mobile-products">
            {PRODUCTS.map((p) => (
              <li key={p.slug}>
                <Link href={`/products/${p.slug}`} className="mega-item" onClick={close}>
                  <Mark product={p} size={32} />
                  <span className="mega-text">
                    <span className="mega-name">
                      Clor {p.name} <Status product={p} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {MENUS.filter((m) => m.items).map((m) => (
            <div key={m.key}>
              <p className="mega-cat">{m.label}</p>
              <ul className="mobile-list">
                {m.items.map((i) => (
                  <li key={i.href}>
                    <Link href={i.href} onClick={close}>
                      {i.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <ul className="mobile-list">
            <li>
              <Link href="/pricing" onClick={close}>
                Pricing
              </Link>
            </li>
            <li>
              <a href={SITE.signInUrl}>Sign in</a>
            </li>
          </ul>
        </div>
      </div>
    </>
  );
}
