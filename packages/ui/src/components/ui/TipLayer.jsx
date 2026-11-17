import { useEffect } from 'react';

/**
 * Two of the owner's style picks (17 Nov 2026) that apply to every screen at once, outside Books:
 *
 * - Tooltips are white with a soft shadow. Screens give a hint with the plain `title` attribute;
 *   while the pointer rests on such an element its title moves to `data-ui-tip` (so the browser's
 *   own yellow box does not show as well) and a white tip is drawn beside it. The title goes back
 *   when the pointer leaves.
 * - Long text shows a letter count. A text box with a `maxlength` shows "74 / 500" under its
 *   bottom-right corner while it has focus.
 *
 * Both are drawn in one layer on `document.body`, never inside a screen's own markup, so React's
 * view of each screen is untouched. Books (`data-palette='indigo'`) and touch screens are left alone.
 */
const inBooks = () => document.documentElement.dataset.palette === 'indigo';

export default function TipLayer() {
  useEffect(() => {
    const tip = document.createElement('div');
    tip.className = 'ui-tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    const count = document.createElement('div');
    count.className = 'ui-textcount';
    count.setAttribute('aria-hidden', 'true');
    count.hidden = true;
    document.body.append(tip, count);

    let owner = null;
    let timer = 0;
    const hideTip = () => {
      clearTimeout(timer);
      tip.hidden = true;
      if (owner && owner.hasAttribute('data-ui-tip')) {
        owner.setAttribute('title', owner.getAttribute('data-ui-tip'));
        owner.removeAttribute('data-ui-tip');
        /* The name lent while the title was away goes back too. */
        if (owner.hasAttribute('data-ui-tip-label')) { owner.removeAttribute('aria-label'); owner.removeAttribute('data-ui-tip-label'); }
      }
      owner = null;
    };
    const place = (el) => {
      const r = el.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      let top = r.bottom + 8;
      if (top + t.height > window.innerHeight - 8) top = r.top - t.height - 8;
      const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - 8);
      tip.style.top = `${Math.round(top)}px`;
      tip.style.left = `${Math.round(left)}px`;
    };
    const showFor = (el, delay) => {
      const text = el.getAttribute('title');
      if (!text || !text.trim() || el.closest('svg')) return;
      hideTip();
      owner = el;
      el.setAttribute('data-ui-tip', text);
      /* An icon button named only by its title keeps that name for a screen reader while the title is away. */
      if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby') && !el.textContent.trim()) {
        el.setAttribute('aria-label', text);
        el.setAttribute('data-ui-tip-label', '');
      }
      el.removeAttribute('title');
      timer = setTimeout(() => {
        if (owner !== el || !el.isConnected) return;
        tip.textContent = text;
        tip.hidden = false;
        place(el);
      }, delay);
    };
    const onOver = (e) => {
      if (inBooks() || e.pointerType === 'touch') return;
      const el = e.target instanceof Element ? e.target.closest('[title]') : null;
      if (!el || el === owner) return;
      showFor(el, 350);
    };
    const onOut = (e) => {
      if (!owner) return;
      const to = e.relatedTarget;
      if (to instanceof Node && owner.contains(to)) return;
      hideTip();
    };

    let field = null;
    const showCount = () => {
      if (!field || !field.isConnected) { count.hidden = true; return; }
      const max = Number(field.getAttribute('maxlength'));
      count.textContent = `${field.value.length} / ${max}`;
      count.classList.toggle('is-near', field.value.length >= max * 0.9);
      const r = field.getBoundingClientRect();
      count.hidden = false;
      count.style.top = `${Math.round(r.bottom + 2)}px`;
      count.style.left = `${Math.round(r.right - count.getBoundingClientRect().width)}px`;
    };
    const onFocus = (e) => {
      const el = e.target;
      /* A help "i" reached with the keyboard shows its words too. */
      if (!inBooks() && el instanceof Element && el.classList.contains('ui-helptip') && el.hasAttribute('title')) { showFor(el, 0); return; }
      if (inBooks() || !(el instanceof HTMLTextAreaElement) || !(Number(el.getAttribute('maxlength')) > 0)) return;
      field = el;
      showCount();
    };
    const onInput = (e) => { if (e.target === field) showCount(); };
    const onBlur = (e) => { if (e.target === owner) hideTip(); if (e.target === field) { field = null; count.hidden = true; } };
    const onMove = () => { if (field) showCount(); if (owner && !tip.hidden) place(owner); };

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('pointerdown', hideTip, true);
    document.addEventListener('keydown', hideTip, true);
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('focusout', onBlur, true);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      hideTip();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('pointerdown', hideTip, true);
      document.removeEventListener('keydown', hideTip, true);
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('focusout', onBlur, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      tip.remove();
      count.remove();
    };
  }, []);
  return null;
}
