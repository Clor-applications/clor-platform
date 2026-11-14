import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Menu, X } from 'lucide-react';
import { Link, usePath } from '../router.jsx';
import { NAV, SITE } from '../site.js';
import { Logo, Mark, ProductName, Status } from './Brand.jsx';
import { useProducts } from '../catalogue.js';

const CATEGORIES = ['Finance', 'HR', 'Operations'];

/* Every product opens its page here first: a visitor reads about it before signing in.
   The page itself links on to the product's own address (books.clor.in) for people who have an account. */
function ProductLink({ product, className, onClick, children }) {
  return (
    <Link href={`/products/${product.slug}`} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

function ProductsMenu({ onPick }) {
  const PRODUCTS = useProducts();
  return (
    <div className="mega mega--products">
      <div className="mega-body">
        <div className="mega-grid">
          {CATEGORIES.map((cat) => (
            <div key={cat} className="mega-col">
              <p className="mega-cat">{cat}</p>
              <ul>
                {PRODUCTS.filter((p) => p.category === cat).map((p) => (
                  <li key={p.slug}>
                    <ProductLink product={p} className="mega-item" onClick={onPick}>
                      <Mark product={p} size={34} />
                      <span className="mega-text">
                        <span className="mega-name">
                          <ProductName name={p.name} /> <Status product={p} />
                        </span>
                        <span className="mega-line">{p.line}</span>
                      </span>
                    </ProductLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <Link href="/solutions/businesses" className="mega-feature" onClick={onPick}>
          <span className="mega-name">One login for every app</span>
          <span className="mega-line">Books, People, Payroll and Attendance share one list of employees and one set of books.</span>
        </Link>
      </div>
      <div className="mega-foot">
        <p className="small">Choose the products you need and add the rest later.</p>
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

const MENUS = [
  { key: 'products', label: 'Products' },
  { key: 'solutions', label: 'Solutions', items: NAV.solutions },
  { key: 'pricing', label: 'Pricing', href: '/pricing' },
  { key: 'resources', label: 'Resources', items: NAV.resources },
  { key: 'company', label: 'Company', items: NAV.company },
];

export default function Nav() {
  const PRODUCTS = useProducts();
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
  /* The control that opened a menu, so Escape can hand focus back to it. */
  const opener = useRef(null);
  const burger = useRef(null);
  const panel = useRef(null);
  const toggle = (key) => (e) => {
    opener.current = e.currentTarget;
    setOpen((cur) => (cur === key && Date.now() - hoveredAt.current > 400 ? null : key));
  };
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
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (mobile) {
        setMobile(false);
        burger.current?.focus();
      } else if (open) {
        setOpen(null);
        opener.current?.focus();
      }
    };
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(null);
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onClick);
    };
  }, [open, mobile]);

  /*
   * The open phone menu is the whole page for the moment: the page behind is
   * inert and does not scroll, and Tab circles between the close button and
   * the menu's own links.
   */
  useEffect(() => {
    if (!mobile) return undefined;
    const behind = [document.getElementById('main'), document.querySelector('body > #root > footer, footer.footer')].filter(Boolean);
    behind.forEach((el) => (el.inert = true));
    document.body.style.overflow = 'hidden';
    const items = () => [burger.current, ...panel.current.querySelectorAll('a[href], button')].filter(Boolean);
    items()[1]?.focus();
    const onTab = (e) => {
      if (e.key !== 'Tab') return;
      const list = items();
      const at = list.indexOf(document.activeElement);
      const next = e.shiftKey ? (at <= 0 ? list.length - 1 : at - 1) : at === -1 || at === list.length - 1 ? 0 : at + 1;
      e.preventDefault();
      list[next].focus();
    };
    document.addEventListener('keydown', onTab);
    return () => {
      behind.forEach((el) => (el.inert = false));
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onTab);
    };
  }, [mobile]);

  const section = (key) => (key === 'products' ? path.startsWith('/products') : MENUS.find((m) => m.key === key)?.items?.some((i) => path.startsWith(i.href)));

  return (
    <>
    <header className="nav" ref={ref}>
      <div className="wrap nav-bar">
        <Logo light />
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
          <a href={SITE.portalUrl} className="nav-quiet">
            Employee portal
          </a>
          <Link href="/contact" className="nav-quiet">
            Contact sales
          </Link>
          <a href={SITE.signInUrl} className="nav-trigger nav-signin">
            Sign in
          </a>
          <a href={SITE.startUrl} className="btn nav-trial">
            Start free trial
          </a>
          <Link href={SITE.demoUrl} className="btn btn--primary nav-demo">
            Request a demo
          </Link>
          <button type="button" ref={burger} className="nav-burger" aria-expanded={mobile} aria-controls="mobile-menu" onClick={() => setMobile(!mobile)}>
            <span className="sr-only">{mobile ? 'Close menu' : 'Open menu'}</span>
            {mobile ? <X size={20} strokeWidth={1.75} aria-hidden="true" /> : <Menu size={20} strokeWidth={1.75} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </header>

      {/* Outside the header: its backdrop blur would otherwise be the box this fixed panel is placed in. */}
      <div id="mobile-menu" ref={panel} className={`mobile${mobile ? ' is-open' : ''}`} hidden={!mobile}>
        <div className="wrap">
          <p className="mega-cat">Products</p>
          <ul className="mobile-products">
            {PRODUCTS.map((p) => (
              <li key={p.slug}>
                <ProductLink product={p} className="mega-item" onClick={close}>
                  <Mark product={p} size={32} />
                  <span className="mega-text">
                    <span className="mega-name">
                      <ProductName name={p.name} /> <Status product={p} />
                    </span>
                  </span>
                </ProductLink>
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
          <a href={SITE.startUrl} className="btn btn--trial btn--lg mobile-demo">
            Start free trial
          </a>
        </div>
      </div>
    </>
  );
}
