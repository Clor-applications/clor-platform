/**
 * What a file is, from its own first bytes (A-42).
 *
 * Uploads said what they were — `data:image/png;base64,…` or a `mime` field —
 * and that was stored and later served back with that type. A page of HTML
 * called a PNG, or a program called a PDF, went in as whatever it claimed.
 * Here the bytes decide; the claim only has to agree with them.
 */
const starts = (b: Buffer, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** Office Open XML is a ZIP; which kind is told by the part names near its start. */
const ooxmlKind = (b: Buffer) => {
  const head = b.subarray(0, Math.min(b.length, 64 * 1024)).toString('latin1');
  if (head.includes('word/')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (head.includes('xl/')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return null;
};

/** Plain text: valid UTF-8, no NUL bytes, and not markup a browser would run. */
const isPlainText = (b: Buffer) => {
  if (b.includes(0)) return false;
  const text = b.toString('utf8');
  if (Buffer.from(text, 'utf8').length !== b.length) return false;
  return !/^\s*<(?:!doctype|html|head|body|script|svg|\?xml)/i.test(text);
};

/** The type the bytes prove, or null when they prove none of the kinds accepted here. */
export function sniffMime(b: Buffer): string | null {
  if (!b?.length) return null;
  if (starts(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (starts(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'; // RIFF….WEBP
  if (starts(b, [0x50, 0x4b, 0x03, 0x04])) return ooxmlKind(b); // ZIP
  if (starts(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'application/msword'; // OLE2 (.doc)
  if (isPlainText(b)) return 'text/plain';
  return null;
}

/** The bytes' own type when it agrees with what the upload claimed (and is allowed); else null. */
export function verifiedMime(b: Buffer, claimed: string, allowed: (mime: string) => boolean): string | null {
  const real = sniffMime(b);
  if (!real || !allowed(real)) return null;
  return real === String(claimed || '').toLowerCase() ? real : null;
}
