import fs from 'node:fs';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node tools/bracecheck.js <file>');
  process.exit(1);
}

const s = fs.readFileSync(filePath, 'utf8');
const lines = s.split(/\r?\n/);

let braceBal = 0;
let parenBal = 0;
let bracketBal = 0;

let lastZeroBrace = 0;
let lastZeroParen = 0;
let lastZeroBracket = 0;

// NOTE: This is a lightweight scan. It ignores line and block comments and
// double-quoted/backtick strings. It does NOT fully handle all JS edge cases.
let inBlockComment = false;
let inD = false;
let inT = false;
let esc = false;

for (let i = 0; i < lines.length; i++) {
  let line = lines[i];

  let j = 0;
  while (j < line.length) {
    const ch = line[j];
    const nx = line[j + 1];

    if (inBlockComment) {
      if (ch === '*' && nx === '/') {
        inBlockComment = false;
        j += 2;
        continue;
      }
      j++;
      continue;
    }

    if (!inD && !inT) {
      if (ch === '/' && nx === '*') {
        inBlockComment = true;
        j += 2;
        continue;
      }
      if (ch === '/' && nx === '/') {
        break; // ignore rest of line
      }
    }

    if (inD) {
      if (!esc && ch === '\\') {
        esc = true;
        j++;
        continue;
      }
      if (!esc && ch === '"') {
        inD = false;
      }
      esc = false;
      j++;
      continue;
    }

    if (inT) {
      if (!esc && ch === '\\') {
        esc = true;
        j++;
        continue;
      }
      if (!esc && ch === '`') {
        inT = false;
      }
      esc = false;
      j++;
      continue;
    }

    if (ch === '"') {
      inD = true;
      j++;
      continue;
    }
    if (ch === '`') {
      inT = true;
      j++;
      continue;
    }

    if (ch === '{') braceBal++;
    if (ch === '}') braceBal--;
    if (ch === '(') parenBal++;
    if (ch === ')') parenBal--;
    if (ch === '[') bracketBal++;
    if (ch === ']') bracketBal--;

    j++;
  }

  if (braceBal === 0) lastZeroBrace = i + 1;
  if (parenBal === 0) lastZeroParen = i + 1;
  if (bracketBal === 0) lastZeroBracket = i + 1;
}

console.log(
  JSON.stringify(
    {
      totals: { lines: lines.length },
      finalBalance: { braces: braceBal, parens: parenBal, brackets: bracketBal },
      lastZeroLine: { braces: lastZeroBrace, parens: lastZeroParen, brackets: lastZeroBracket },
    },
    null,
    2
  )
);
