import React, { useState } from 'react';

import SuggestInput from '../components/ui/SuggestInput';
import { MAX_FILE_BYTES } from './formFiles';

/*
 * The fields of a request type HR set up (People, gap 25), the same in
 * People's My requests and in the employee app: text, a number, a date, one
 * of a list, a file (a picture or a PDF up to 2 MB, read here and sent as a
 * data URL). Answers are private to the person and HR, so text fields
 * suggest nothing.
 *
 * `answers`: { [key]: value }; `files`: { [key]: { name, dataUrl } }.
 */
function FileField({ value, onChange, id }) {
  const [error, setError] = useState('');
  const pick = (file) => {
    setError('');
    if (!file) { onChange(null); return; }
    if (file.size > MAX_FILE_BYTES) { setError('Files up to 2 MB.'); onChange(null); return; }
    const reader = new FileReader();
    reader.onload = () => onChange({ name: file.name, dataUrl: String(reader.result) });
    reader.onerror = () => setError('The file could not be read.');
    reader.readAsDataURL(file);
  };
  return (
    <>
      <input id={id} type="file" className="ui-input w-full" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => pick(e.target.files?.[0] || null)} />
      <span className={`ui-caption ${error ? 'ui-text-neg' : ''}`}>{error || (value ? `${value.name} is attached.` : 'A picture or a PDF, up to 2 MB.')}</span>
    </>
  );
}

export default function FormFields({ fields, answers, files, onAnswer, onFile, idPrefix = 'rf' }) {
  return (
    <>
      {(fields || []).map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const label = `${f.label}${f.required ? ' *' : ''}`;
        const value = answers?.[f.key] ?? '';
        return (
          <div key={f.key} className="block">
            <label className="ui-label" htmlFor={id}>{label}</label>
            {f.type === 'TEXT' ? <SuggestInput id={id} maxLength={2000} value={value} onChange={(v) => onAnswer(f.key, v)} suggestions={[]} /> : null}
            {f.type === 'NUMBER' ? <input id={id} className="ui-input w-full tabular-nums" inputMode="decimal" value={value} onChange={(e) => onAnswer(f.key, e.target.value)} /> : null}
            {f.type === 'DATE' ? <input id={id} type="date" className="ui-input w-full" value={value} onChange={(e) => onAnswer(f.key, e.target.value)} /> : null}
            {f.type === 'CHOICE' ? (
              <select id={id} className="ui-select w-full" value={value} onChange={(e) => onAnswer(f.key, e.target.value)}>
                <option value="">Choose…</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : null}
            {f.type === 'FILE' ? <FileField id={id} value={files?.[f.key] || null} onChange={(v) => onFile(f.key, v)} /> : null}
          </div>
        );
      })}
    </>
  );
}
