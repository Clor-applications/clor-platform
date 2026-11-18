#!/usr/bin/env node
/**
 * Lists the English words the employee app can show, by walking its import graph
 * from apps/attendance/src/portal/EmployeePortal.jsx. Used to keep a language file
 * complete:   node scripts/i18n-strings.mjs            (prints JSON of every string)
 *             node scripts/i18n-strings.mjs --missing hi   (strings the Hindi file lacks)
 * Only text a person reads: JSX text, and string literals in UI attributes or in
 * calls such as notify(), plus plain sentences in code. Class names, keys and paths
 * are left out.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseMod from '@babel/traverse';

const traverse = traverseMod.default || traverseMod;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALIAS = { '@ui/': join(root, 'packages/ui/src/'), '@platform/': join(root, 'packages/platform/') };
const START = [join(root, 'apps/attendance/src/portal/EmployeePortal.jsx')];

function resolveImport(from, spec) {
  let base;
  if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else {
    const a = Object.keys(ALIAS).find((k) => spec.startsWith(k));
    if (!a) return null;
    base = ALIAS[a] + spec.slice(a.length);
  }
  for (const ext of ['', '.jsx', '.js', '/index.jsx', '/index.js']) {
    const p = base + ext;
    if (existsSync(p) && !p.endsWith('/')) { try { readFileSync(p); return p; } catch { /* a folder */ } }
  }
  return null;
}

const UI_ATTRS = new Set(['placeholder', 'aria-label', 'title', 'alt', 'label', 'hint', 'empty', 'emptyText', 'helper', 'help', 'note', 'confirmLabel', 'cancelLabel', 'description', 'caption', 'heading', 'subtitle', 'actionLabel', 'message', 'words']);
const looksLikeText = (s) => {
  const t = s.trim();
  if (t.length < 2 || !/[A-Za-z]/.test(t)) return false;
  if (/^(ui-|people-|r\d+-|pc-|is-|has-)/.test(t)) return false;
  if (/^[a-z0-9_.:/#?=&%-]+$/.test(t)) return false; /* keys, class names, paths */
  if (/^[A-Z0-9_]+$/.test(t)) return false; /* CODES */
  if (/^(https?:|mailto:|tel:|\/|#|\.|data:)/.test(t)) return false;
  if (/\b(flex|grid|gap-|text-|px-|py-|mt-|mb-|rounded|items-|justify-|space-|w-|h-)\S*/.test(t) && !/[.!?]$/.test(t)) return false;
  if (/^[\w-]+\/[\w./-]+$/.test(t)) return false;
  if (/::|rgb\(|var\(--|^\((max|min)-width|^\(pointer|^\(display-mode|^\d[\d.]* \d|^(Arrow|Escape$|Enter$|Tab$|Backspace$)/.test(t)) return false;
  if (/^[^A-Za-z]*\{\}[^A-Za-z]*(\{\}[^A-Za-z]*)*$/.test(t)) return false; /* holes and punctuation only */
  return /^[A-Z₹"“(0-9]/.test(t) || /\s/.test(t);
};

export function collectStrings() {
const seen = new Set();
const strings = new Map();
const add = (s, file) => {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!looksLikeText(t)) return;
  if (!strings.has(t)) strings.set(t, file.replace(root + '/', ''));
};

const queue = [...START];
while (queue.length) {
  const file = queue.shift();
  if (seen.has(file) || /\.test\.|__tests__|lineIcons|navEmoji|[\\/]i18n[\\/]/.test(file)) continue;
  seen.add(file);
  let ast;
  try { ast = parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] }); } catch { continue; }
  traverse(ast, {
    ImportDeclaration(p) { const r = resolveImport(file, p.node.source.value); if (r) queue.push(r); },
    ExportNamedDeclaration(p) { if (p.node.source) { const r = resolveImport(file, p.node.source.value); if (r) queue.push(r); } },
    CallExpression(p) {
      if (p.node.callee.type === 'Import' && p.node.arguments[0]?.type === 'StringLiteral') { const r = resolveImport(file, p.node.arguments[0].value); if (r) queue.push(r); }
    },
    JSXText(p) { add(p.node.value, file); },
    /* Words with values inside one element ("Apply for {type}") reach the page as one line. */
    JSXElement(p) {
      const kids = p.node.children.filter((c) => !(c.type === 'JSXExpressionContainer' && c.expression.type === 'JSXEmptyExpression'));
      if (kids.some((c) => c.type === 'JSXElement' || c.type === 'JSXFragment')) return;
      if (!kids.some((c) => c.type === 'JSXExpressionContainer') || !kids.some((c) => c.type === 'JSXText' && /[A-Za-z]{2}/.test(c.value))) return;
      const joined = kids.map((c) => {
        if (c.type === 'JSXText') return c.value;
        if (c.expression.type === 'StringLiteral') return c.expression.value;
        return '{}';
      }).join('');
      add(joined, file);
    },
    StringLiteral(p) {
      const parent = p.parent;
      if (parent.type === 'ImportDeclaration' || parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportAllDeclaration') return;
      if (parent.type === 'JSXAttribute') { const n = parent.name.name; if (UI_ATTRS.has(n) || /label|title|text|hint|placeholder|words|empty|note/i.test(n)) add(p.node.value, file); return; }
      if (parent.type === 'ObjectProperty' && parent.key === p.node) return;
      if (parent.type === 'MemberExpression') return;
      if (p.node.value.includes(' ') || /^[A-Z][a-z]/.test(p.node.value)) add(p.node.value, file);
    },
    TemplateLiteral(p) {
      if (p.parent.type === 'TaggedTemplateExpression') return;
      /* A sentence with holes: kept as a pattern with {} for each hole. */
      const parts = p.node.quasis.map((q) => q.value.cooked);
      const joined = parts.join('{}');
      if (/[A-Za-z]{3,}/.test(parts.join('')) && /\s/.test(joined)) add(joined, file);
    },
  });
}

return { strings: [...strings.keys()].sort(), files: seen.size };
}

/** The lines a language file does not have yet (strings never shown left out). */
export async function missingFor(lang) {
  const { NOT_SHOWN } = await import(join(root, 'packages/ui/src/i18n/notShown.js'));
  const pack = (await import(join(root, `packages/ui/src/i18n/${lang}.js`))).default;
  const { strings, files } = collectStrings();
  return { missing: strings.filter((s) => !NOT_SHOWN.has(s) && !pack.words[s]), total: strings.length, files };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const want = process.argv.indexOf('--missing');
  if (want > 0) {
    const { missing, total, files } = await missingFor(process.argv[want + 1]);
    console.log(JSON.stringify(missing, null, 1));
    console.error(`${missing.length} of ${total} missing (${files} files)`);
    if (missing.length) process.exitCode = 1;
  } else {
    const { strings, files } = collectStrings();
    console.log(JSON.stringify(strings, null, 1));
    console.error(`${strings.length} strings from ${files} files`);
  }
}
