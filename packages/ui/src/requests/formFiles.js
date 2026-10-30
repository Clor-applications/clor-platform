/* Helpers for the request forms HR sets up (FormFields.jsx and the screens that use it). */

/** A file on a request: a picture or a PDF, up to 2 MB (the server's limit too). */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** What is missing before the form can be sent, in words, or ''. */
export function missingIn(fields, answers, files) {
  const need = (fields || []).find((f) => f.required && (f.type === 'FILE' ? !files?.[f.key] : !String(answers?.[f.key] ?? '').trim()));
  return need ? `${need.label} is needed.` : '';
}

/** A file from a request, opened in a new tab (a data URL from the server). */
export function openFile(file) {
  if (!file?.dataUrl) return;
  const [head, body] = String(file.dataUrl).split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] || 'application/octet-stream';
  const bytes = Uint8Array.from(atob(body || ''), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
