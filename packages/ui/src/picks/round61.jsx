import { useEffect, useRef, useState } from 'react';
import { ArrowUp } from '@ui/components/ui/lineIcons';

/**
 * Round 61 picks (18 Nov 2026): getting around the apps. Never in Books: every
 * global behaviour here checks `inBooks()` first.
 */
export const inBooks = () => typeof document !== 'undefined' && document.documentElement.dataset.palette === 'indigo';

/* ---------------------------------------------------------------- tabtitle A */
/* Browser tab names put the page first, then the app: "Ravi Kumar · People · CLOR".
   The shell sets the page and app; a screen showing one thing (a person) may name
   it with usePageTitle, which wins while that screen is open. */
const titleState = { page: '', app: '', own: '' };

export function pageTitle({ page = '', app = '', own = '' } = {}) {
  return [own || page, app, 'CLOR'].filter(Boolean).filter((w, i, all) => all.indexOf(w) === i).join(' · ');
}

function applyTitle() {
  if (typeof document === 'undefined' || inBooks()) return;
  document.title = pageTitle(titleState);
}

export function setShellTitle(page, app) {
  titleState.page = page || '';
  titleState.app = app || '';
  applyTitle();
}

/** A screen showing one record names the tab after it while it is open. */
export function usePageTitle(name) {
  useEffect(() => {
    if (!name) return undefined;
    titleState.own = String(name);
    applyTitle();
    return () => {
      if (titleState.own === String(name)) titleState.own = '';
      applyTitle();
    };
  }, [name]);
}

/* ---------------------------------------------------------------- externallink A */
/* A link that leaves CLOR (EPFO, a help article) opens in a new tab, so CLOR stays open.
   The ↗ mark comes from picks.css on the same links. */
export function isExternalHref(href, here = typeof window !== 'undefined' ? window.location : null) {
  if (!href || !/^https?:\/\//i.test(href)) return false;
  try {
    const u = new URL(href);
    if (!here) return true;
    if (u.host === here.host) return false;
    /* Another CLOR app (people.clor.in from app.clor.in) is not leaving CLOR. */
    return !/(^|\.)clor\.in$/i.test(u.hostname);
  } catch {
    return false;
  }
}

export function useExternalLinksInNewTab(skip) {
  const skipRef = useRef(skip);
  useEffect(() => { skipRef.current = skip; }, [skip]);
  useEffect(() => {
    const onClick = (e) => {
      if (e.defaultPrevented || inBooks() || skipRef.current?.()) return;
      const a = e.target?.closest?.('a[href]');
      if (!a || a.target || a.hasAttribute('download')) return;
      if (!isExternalHref(a.getAttribute('href'))) return;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
}

/** Marks every external link inside `root` so picks.css can draw ↗ beside it. */
export function markExternalLinks(root) {
  if (!root || inBooks()) return;
  root.querySelectorAll('a[href]').forEach((a) => {
    if (a.classList.contains('ui-btn') || a.dataset.external != null) return;
    if (isExternalHref(a.getAttribute('href'))) a.dataset.external = '';
  });
}

/* ---------------------------------------------------------------- ctrlsave A */
/* Ctrl+S (⌘S) saves the open form instead of saving the web page. The form is the one
   the cursor is in, else the top open drawer or dialog, else the only form on the page. */
/* Only plain saving words: Ctrl+S must never send, approve or create something by surprise. */
const SAVE_WORDS = /^save\b/i;

export function saveTarget(doc = document) {
  const active = doc.activeElement;
  const form = active?.closest?.('form');
  if (form) return { form };
  const layers = [...doc.querySelectorAll('[role="dialog"]')].filter((d) => d.offsetParent !== null || d.getClientRects().length);
  const scope = layers[layers.length - 1] || doc.querySelector('main') || doc.body;
  const forms = [...scope.querySelectorAll('form')];
  if (forms.length === 1) return { form: forms[0] };
  const buttons = [...scope.querySelectorAll('button')].filter((b) => !b.disabled && SAVE_WORDS.test((b.textContent || '').trim()));
  if (buttons.length === 1) return { button: buttons[0] };
  return null;
}

export function useCtrlSave(onNothing, skip) {
  const nothing = useRef(onNothing);
  const skipRef = useRef(skip);
  useEffect(() => { nothing.current = onNothing; skipRef.current = skip; }, [onNothing, skip]);
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || String(e.key).toLowerCase() !== 's') return;
      if (e.defaultPrevented || inBooks() || skipRef.current?.()) return;
      e.preventDefault();
      const t = saveTarget();
      if (t?.form) {
        /* The form's own Save, the same as clicking it; a form whose submit is not a save (Send, Approve) is left alone. */
        const submit = t.form.querySelector('button[type="submit"]:not([disabled])');
        if (submit && SAVE_WORDS.test((submit.textContent || '').trim())) submit.click();
        else if (!submit) nothing.current?.();
        else nothing.current?.(submit.textContent.trim());
      } else if (t?.button) {
        t.button.click();
      } else {
        nothing.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/* ---------------------------------------------------------------- focusfirst A */
/* When a form opens, the cursor waits in the first empty field. Not on a touch phone,
   where it would throw the keyboard over the form before the person has read it. */
const TYPING = 'input:not([type]),input[type="text"],input[type="email"],input[type="tel"],input[type="number"],input[type="search"],input[type="url"],textarea';

export function firstEmptyField(root) {
  if (!root) return null;
  return [...root.querySelectorAll(TYPING)].find((el) =>
    !el.disabled && !el.readOnly && !el.value &&
    el.getAttribute('role') !== 'combobox' && !el.hasAttribute('aria-haspopup') &&
    el.getAttribute('aria-hidden') !== 'true' && el.tabIndex !== -1) || null;
}

export function coarsePointer() {
  try { return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches; } catch { return false; }
}

/** What a newly opened panel should focus: whatever asks with data-autofocus, else the first empty field, else nothing. */
export function openingFocus(panel) {
  if (!panel) return null;
  const wants = panel.querySelector('[data-autofocus]');
  if (wants) return wants;
  if (inBooks() || coarsePointer()) return null;
  return firstEmptyField(panel);
}

/* ---------------------------------------------------------------- scrolltop A */
/* After two screens of scrolling, a small "Top ↑" brings the page back up. */
export function ScrollTop() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > window.innerHeight * 2);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  if (!shown || inBooks()) return null;
  return (
    <button type="button" className="ui-scroll-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
      Top <ArrowUp size={14} aria-hidden="true" />
    </button>
  );
}

/* ---------------------------------------------------------------- sectionjump A */
/* A long page with many sections gets a small list of them on the right that follows
   the scroll and jumps on click. Hidden on narrower screens, where the page is one column. */
export function SectionJump({ children, label = 'On this page', min = 4 }) {
  const ref = useRef(null);
  const [sections, setSections] = useState([]);
  const [current, setCurrent] = useState('');
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const read = () => {
      const heads = [...root.querySelectorAll('h2')].filter((h) => h.textContent.trim());
      heads.forEach((h, i) => { if (!h.id) h.id = `section-${i}-${h.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`; });
      setSections(heads.map((h) => ({ id: h.id, text: h.textContent.trim() })));
    };
    read();
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(read) : null;
    mo?.observe(root, { childList: true, subtree: true });
    return () => mo?.disconnect();
  }, []);
  useEffect(() => {
    if (sections.length < min) return undefined;
    const onScroll = () => {
      let at = sections[0]?.id || '';
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top < 140) at = s.id;
      }
      setCurrent(at);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [sections, min]);
  const jump = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setCurrent(id);
  };
  return (
    <div className="ui-section-jump-wrap">
      <div ref={ref} className="ui-section-jump-body">{children}</div>
      {sections.length >= min && !inBooks() ? (
        <nav className="ui-section-jump" aria-label={label}>
          <p className="ui-caption">{label}</p>
          {sections.map((s) => (
            <button key={s.id} type="button" aria-current={current === s.id ? 'true' : undefined} onClick={() => jump(s.id)}>{s.text}</button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

/** Renders nothing; keeps the browser tab's name on the page and app shown. */
export function TitleSync({ page, app }) {
  useEffect(() => { setShellTitle(page, app); }, [page, app]);
  return null;
}

/** Renders nothing; marks external links inside the page's main area as they appear, for the ↗ in picks.css. */
export function ExternalMarks({ rootId = 'main-content' }) {
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root || typeof MutationObserver === 'undefined') return undefined;
    markExternalLinks(root);
    let pending = 0;
    const mo = new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => { pending = 0; markExternalLinks(root); }, 100);
    });
    mo.observe(root, { childList: true, subtree: true });
    return () => { mo.disconnect(); clearTimeout(pending); };
  }, [rootId]);
  return null;
}
