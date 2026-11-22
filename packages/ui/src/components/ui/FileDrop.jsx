import React, { useId, useRef, useState } from 'react';
import { RotateCw, Upload, X } from './lineIcons';
import FileBadge, { fileSize } from './FileBadge';

/**
 * One file field for every form that takes a file (UX reels, 22 Nov 2026).
 *
 * - The zone reacts while a file is dragged over it ("Release to attach").
 * - A chosen file shows as a row: its type, name and size, with Replace and Remove.
 * - A file over the size limit or of the wrong kind is refused in place, in words.
 * - A failure the form reports (`error`) stays beside the file, which is kept,
 *   with Try again when the form passes `onRetry`.
 *
 * `file`: the chosen File, or { name, size, type } for one already sent; null for none.
 * `onFile(File | null)`: a new file, or null when removed.
 * `maxBytes`, `accept`: checked here before `onFile` is called.
 * `hint`: what it takes, such as "PDF or picture, up to 5 MB".
 */
const accepts = (file, accept) => {
  if (!accept) return true;
  const name = String(file.name || '').toLowerCase();
  const type = String(file.type || '').toLowerCase();
  return accept.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean).some((a) => {
    if (a.startsWith('.')) return name.endsWith(a);
    if (a.endsWith('/*')) return type.startsWith(a.slice(0, -1));
    return type === a;
  });
};

const sizeWords = (bytes) => fileSize(bytes).replace(/\.0 MB$/, ' MB');

export default function FileDrop({
  id,
  label,
  required = false,
  file = null,
  onFile,
  accept = '',
  maxBytes = 0,
  hint = '',
  error = '',
  onRetry,
  retrying = false,
  disabled = false,
  compact = false,
  'aria-label': ariaLabel,
}) {
  const autoId = useId();
  const inputId = id || `${autoId}-file`;
  const noteId = `${inputId}-note`;
  const input = useRef(null);
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState('');

  const take = (f) => {
    if (!f) return;
    if (!accepts(f, accept)) { setRefused(`${f.name} is not a kind of file this takes.${hint ? ` ${hint}.` : ''}`); return; }
    if (maxBytes && f.size > maxBytes) { setRefused(`${f.name} is ${sizeWords(f.size)}. Files up to ${sizeWords(maxBytes)}.`); return; }
    setRefused('');
    onFile?.(f);
  };
  const choose = () => { if (!disabled) input.current?.click(); };
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const dragProps = disabled ? {} : {
    onDragEnter: (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current += 1; setOver(true); },
    onDragOver: (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
    onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
    onDrop: (e) => { e.preventDefault(); depth.current = 0; setOver(false); take(e.dataTransfer.files?.[0]); },
  };
  const message = refused || error;
  const name = file?.name || '';

  return (
    <div className="ui-file-drop" data-file-drop="" data-compact={compact || undefined}>
      {label ? <label className="ui-label" htmlFor={inputId}>{label}{required ? ' *' : ''}</label> : null}
      <input
        ref={input}
        id={inputId}
        type="file"
        className="sr-only"
        accept={accept || undefined}
        disabled={disabled}
        required={required && !file}
        aria-label={label ? undefined : ariaLabel}
        aria-describedby={noteId}
        aria-invalid={message ? true : undefined}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; take(f); }}
      />
      {file ? (
        <div className="ui-file-drop-row" data-over={over || undefined} data-error={error ? '' : undefined} {...dragProps}>
          <FileBadge mime={file.type} name={name} />
          <span className="ui-file-drop-name" title={name}>{over ? 'Release to replace it' : name}</span>
          {file.size ? <span className="ui-caption tabular-nums ui-file-drop-size">{sizeWords(file.size)}</span> : null}
          <span className="ui-file-drop-acts">
            {error && onRetry ? (
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={onRetry} disabled={retrying} aria-busy={retrying || undefined}>
                <RotateCw size={14} aria-hidden="true" /> Try again
              </button>
            ) : null}
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={choose} disabled={disabled}>Replace</button>
            <button type="button" className="ui-icon-btn" onClick={() => { setRefused(''); onFile?.(null); }} disabled={disabled} aria-label={`Remove ${name}`}>
              <X size={16} aria-hidden="true" />
            </button>
          </span>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled || undefined}
          aria-label={label ? `${label}: choose a file` : ariaLabel ? `${ariaLabel}: choose a file` : 'Choose a file'}
          aria-describedby={noteId}
          className="ui-dropzone"
          data-over={over || undefined}
          onClick={choose}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } }}
          {...dragProps}
        >
          <Upload size={18} aria-hidden="true" />
          <span className="text-sm">{over ? 'Release to attach' : 'Choose a file'}</span>
          {!over ? <span className="ui-caption">{hint ? `or drop it here · ${hint}` : 'or drop it here'}</span> : null}
        </div>
      )}
      <span id={noteId} className={message ? 'ui-field-error' : 'sr-only'} role={message ? 'alert' : undefined}>
        {message || (file ? `${name} is attached.` : hint)}
      </span>
    </div>
  );
}

/**
 * A file let go anywhere outside a drop field would open in the tab and lose
 * what was typed (the reel's broken frame). Installed once at start: outside a
 * [data-file-drop], a dragged file is refused instead.
 */
export function installStrayDropGuard(target = typeof window === 'undefined' ? null : window) {
  if (!target) return () => {};
  const guard = (e) => {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    if (e.target instanceof Element && e.target.closest('[data-file-drop], input[type="file"]')) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  };
  target.addEventListener('dragover', guard);
  target.addEventListener('drop', guard);
  return () => { target.removeEventListener('dragover', guard); target.removeEventListener('drop', guard); };
}
