import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Menu, X } from 'lucide-react';
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

/* Two doors: the company's own users, and staff who only punch, ask for leave and read payslips. */
const DOORS = [
  { href: SITE.signInUrl, name: 'Company sign-in', line: 'Owners, HR, managers and accountants.' },
  { href: SITE.portalUrl, name: 'Employee portal', line: 'Punch in, ask for leave, see your payslips.' },
];

function SignInMenu({ onPick }) {
  return (
    <div className="mega mega--list">
      <ul>
        {DOORS.map((d) => (
          <li key={d.name}>
            <a href={d.href} className="mega-item mega-item--plain" onClick={onPick}>
              <span className="mega-text">
                <span className="mega-name">{d.name}</span>
                <span className="mega-line">{d.line}</span>
              </span>
            </a>
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
  const ref = useRef(null);
  /* A mouse opens a menu on hover; the click that follows must not close it again. */
  const hoveredAt = useRef(0);
  const hover = (key) => ({
    onMouseEnter: () => {
      hoveredAt.current = Date.now();
      setOpen(key);
    },
    onMouseLeave: () => setOpen(null),
  });
  const toggle = (key) => () => setOpen((cur) => (cur === key && Date.now() - hoveredAt.current > 400 ? null : key));
  const close = () => {
    setOpen(null);
    setMobile(false);
  };

  /* A new page closes the menus: reset while rendering, not in an effect after it. */
  const [seenPath, setSeenPath] = useState(path);
  if (seenPath !== path) {
    setSeenPath(path);
    setOpen(null);
    setMobile(false);
  }
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && close();
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(null);
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onClick);
    };
  }, []);
  useEffect(() => {
    document.body.style.overflow = mobile ? 'hidden' : '';
  }, [mobile]);

  const section = (key) => (key === 'products' ? path.startsWith('/products') : MENUS.find((m) => m.key === key)?.items?.some((i) => path.startsWith(i.href)));

  return (
    <>
    <header className="nav" ref={ref}>
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
                <li key={m.key} {...hover(m.key)}>
                  <button type="button" className={`nav-trigger${section(m.key) ? ' is-current' : ''}`} aria-expanded={open === m.key} onClick={toggle(m.key)}>
                    {m.label}
                    <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                  <div className={`mega-wrap${open === m.key ? ' is-open' : ''}`}>{m.key === 'products' ? <ProductsMenu onPick={close} /> : <ListMenu items={m.items} onPick={close} />}</div>
                </li>
              )
            )}
          </ul>
        </nav>
        <div className="nav-end">
          <div className="nav-doors" {...hover('signin')}>
            <button type="button" className="nav-trigger" aria-expanded={open === 'signin'} onClick={toggle('signin')}>
              Sign in
              <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
            </button>
            <div className={`mega-wrap mega-wrap--end${open === 'signin' ? ' is-open' : ''}`}>
              <SignInMenu onPick={close} />
            </div>
          </div>
          <Link href={SITE.demoUrl} className="btn btn--primary nav-demo">
            Request a demo
          </Link>
          <button type="button" className="nav-burger" aria-expanded={mobile} aria-controls="mobile-menu" onClick={() => setMobile(!mobile)}>
            <span className="sr-only">{mobile ? 'Close menu' : 'Open menu'}</span>
            {mobile ? <X size={20} strokeWidth={1.75} aria-hidden="true" /> : <Menu size={20} strokeWidth={1.75} aria-hidden="true" />}
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
          </ul>
          <p className="mega-cat">Sign in</p>
          <ul className="mobile-list">
            {DOORS.map((d) => (
              <li key={d.name}>
                <a href={d.href}>{d.name}</a>
              </li>
            ))}
          </ul>
          <Link href={SITE.demoUrl} className="btn btn--primary btn--lg mobile-demo" onClick={close}>
            Request a demo
          </Link>
        </div>
      </div>
    </>
  );
}
