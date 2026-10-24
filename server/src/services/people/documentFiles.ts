import { verifiedMime } from '../../services/fileType.js';

/** The file on an employee document (docs/people/02-PRD.md DOC-01, DOC-06): what may be uploaded and how it is read. */
export const DOC_MAX_BYTES = 5 * 1024 * 1024;
export const DOC_MIMES = /^(application\/pdf|image\/(jpeg|png|webp)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|application\/msword|text\/plain)$/;

/** data:<mime>;base64,… or bare base64 — the file itself, decoded and checked. */
export function decodeDocument(input: unknown, mimeHint?: unknown): { mime: string; data: Buffer } | { error: string } {
  const str = String(input || '');
  if (!str) return { error: 'The file did not come through.' };
  const m = /^data:([\w.+/-]+);base64,(.+)$/s.exec(str);
  const mime = (m ? m[1] : String(mimeHint || '')).toLowerCase();
  if (!DOC_MIMES.test(mime)) return { error: 'PDF, JPEG, PNG, WebP, Word, Excel or plain text only.' };
  let data: Buffer;
  try {
    data = Buffer.from(m ? m[2] : str, 'base64');
  } catch {
    return { error: 'The file could not be read.' };
  }
  if (!data.length) return { error: 'The file is empty.' };
  if (data.length > DOC_MAX_BYTES) return { error: 'Files up to 5 MB.' };
  /* A-42: the file's own bytes have to agree with what it says it is. */
  if (!verifiedMime(data, mime, (t) => DOC_MIMES.test(t))) return { error: 'That file is not what its name says. Upload the PDF, picture or document itself.' };
  return { mime, data };
}
