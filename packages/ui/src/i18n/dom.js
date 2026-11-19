/**
 * Shows a part of the page in another language without the screens knowing:
 * every text the page renders is looked up as it appears (and again whenever
 * React changes it), so the English in the code stays the one source, and
 * end-to-end tests that read English keep working with English on.
 *
 * React renders "Apply for {type}" as two text nodes in one element; a
 * language may need the words in another order, so an element whose children
 * are all text is translated as one line, then written back into its first
 * node (the rest emptied). React still owns those nodes: when it writes a new
 * value into one, that value is the new English and is looked up again.
 *
 * Left alone: what people type (inputs, textareas, editable areas),
 * identifiers set in `.ui-mono`, and anything inside `[data-no-translate]`.
 * Stopping puts every English line back.
 */

/* data-word: words drawn by CSS from an attribute, like the password box's Show and Hide. */
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt', 'data-word'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'svg', 'SVG', 'NOSCRIPT']);

export function startDomTranslation(root, t) {
  if (!root || typeof MutationObserver === 'undefined') return () => {};
  /* text node → its English; text node → what was last written into it. */
  const english = new WeakMap();
  const written = new WeakMap();
  /* element → { attribute: English } */
  const englishAttr = new WeakMap();
  const writtenAttr = new WeakMap();

  const skipped = (el) => {
    for (let n = el; n && n !== root.parentNode; n = n.parentNode) {
      if (n.nodeType !== 1) continue;
      if (SKIP_TAGS.has(n.tagName) || n.isContentEditable) return true;
      if (n.hasAttribute('data-no-translate') || n.classList?.contains('ui-mono')) return true;
    }
    return false;
  };

  /** The English of a text node: kept from before, unless React has written something new since. */
  const englishOf = (node) => {
    if (written.has(node) && written.get(node) === node.nodeValue) return english.get(node);
    english.set(node, node.nodeValue);
    written.delete(node);
    return node.nodeValue;
  };
  const write = (node, value) => {
    written.set(node, value);
    if (node.nodeValue !== value) node.nodeValue = value;
  };

  const translateElement = (el) => {
    if (!el || el.nodeType !== 1 || skipped(el)) return;
    const kids = Array.from(el.childNodes);
    const texts = kids.filter((k) => k.nodeType === 3);
    if (!texts.length) return;
    if (texts.length > 1 && texts.length === kids.length) {
      const originals = texts.map(englishOf);
      const whole = t.keepingSpace(originals.join(''));
      if (whole != null) {
        texts.forEach((n, i) => write(n, i === 0 ? whole : ''));
        return;
      }
      texts.forEach((n, i) => {
        const one = t.keepingSpace(originals[i]);
        write(n, one ?? originals[i]);
      });
      return;
    }
    texts.forEach((n) => {
      const original = englishOf(n);
      const one = t.keepingSpace(original);
      if (one != null) write(n, one);
      else if (written.has(n)) write(n, original);
    });
  };

  const translateAttrs = (el) => {
    /* An input's own words (its placeholder) turn; what is typed in it never does. */
    if (el.nodeType !== 1 || skipped(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el.parentNode || el : el)) return;
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      const now = el.getAttribute(a);
      const mine = writtenAttr.get(el) || {};
      const orig = englishAttr.get(el) || {};
      if (mine[a] !== now) orig[a] = now;
      const out = t(orig[a]);
      englishAttr.set(el, orig);
      if (out != null && out !== now) {
        mine[a] = out;
        writtenAttr.set(el, mine);
        el.setAttribute(a, out);
      } else if (out != null) {
        mine[a] = out;
        writtenAttr.set(el, mine);
      }
    }
  };

  const walk = (node) => {
    if (node.nodeType === 3) return translateElement(node.parentNode);
    if (node.nodeType !== 1) return;
    translateAttrs(node);
    translateElement(node);
    const all = node.querySelectorAll('*');
    for (const el of all) {
      translateAttrs(el);
      translateElement(el);
    }
  };

  const observer = new MutationObserver((records) => {
    const parents = new Set();
    for (const r of records) {
      if (r.type === 'characterData') {
        if (written.get(r.target) === r.target.nodeValue) continue;
        parents.add(r.target.parentNode);
      } else if (r.type === 'childList') {
        r.addedNodes.forEach((n) => (n.nodeType === 3 ? parents.add(n.parentNode) : walk(n)));
        if (r.removedNodes.length) parents.add(r.target);
      } else if (r.type === 'attributes') {
        const mine = writtenAttr.get(r.target) || {};
        if (mine[r.attributeName] !== r.target.getAttribute(r.attributeName)) translateAttrs(r.target);
      }
    }
    parents.forEach((p) => p && translateElement(p));
    /* What was just written here is not news. */
    observer.takeRecords();
  });

  walk(root);
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });

  return () => {
    observer.disconnect();
    /* Back to English: what is on the page now (nodes React removed are gone anyway). */
    const walker = root.ownerDocument.createTreeWalker(root, 4);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (written.has(n) && written.get(n) === n.nodeValue) n.nodeValue = english.get(n);
    }
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const mine = writtenAttr.get(el);
      if (!mine) continue;
      const orig = englishAttr.get(el) || {};
      for (const a of ATTRS) if (mine[a] != null && el.getAttribute(a) === mine[a]) el.setAttribute(a, orig[a]);
    }
  };
}
