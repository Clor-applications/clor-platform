import React from 'react';

/**
 * A file shown as a row with a small type badge (owner's round 12 pick):
 * PDF, IMG, DOC, XLS or FILE, read from the file's type. The badge is a
 * picture of the type; the words beside it carry the meaning, so it is
 * hidden from screen readers.
 */
export function fileKind(mime = '', name = '') {
  const m = String(mime).toLowerCase();
  const ext = String(name).toLowerCase().split('.').pop();
  if (m === 'application/pdf' || ext === 'pdf') return 'PDF';
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(ext)) return 'IMG';
  if (m.includes('spreadsheet') || m.includes('excel') || m === 'text/csv' || ['xls', 'xlsx', 'csv'].includes(ext)) return 'XLS';
  if (m.includes('word') || m.includes('document') || ['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'DOC';
  return 'FILE';
}

export function fileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileBadge({ mime, name }) {
  const kind = fileKind(mime, name);
  return <span className="ui-file-badge" data-kind={kind} aria-hidden="true">{kind}</span>;
}
