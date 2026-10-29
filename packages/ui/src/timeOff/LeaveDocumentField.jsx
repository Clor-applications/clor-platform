import React, { useState } from 'react';

/**
 * The document a long request of some types asks for (a medical certificate):
 * a PDF or a picture up to 5 MB, read here and sent with the request as a
 * data URL. `value`: { name, data, mime } or null.
 */
export default function LeaveDocumentField({ typeName, afterDays, value, onChange, note = '', required = false }) {
  const [error, setError] = useState('');
  const pick = (file) => {
    setError('');
    if (!file) { onChange(null); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Files up to 5 MB.'); onChange(null); return; }
    const reader = new FileReader();
    reader.onload = () => onChange({ name: file.name, data: String(reader.result), mime: file.type });
    reader.onerror = () => setError('The file could not be read.');
    reader.readAsDataURL(file);
  };
  return (
    <label className="block">
      <span className="ui-label">{required ? 'Document *' : 'Document'}</span>
      <input type="file" className="ui-input w-full" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => pick(e.target.files?.[0] || null)} />
      <span className={`ui-caption ${error ? 'ui-text-neg' : ''}`}>{error || `${typeName || 'This type'} for more than ${afterDays ?? '—'} ${afterDays === 1 ? 'day' : 'days'} asks for a document, such as a medical certificate.${value ? ` ${value.name} is attached.` : ''}${note ? ` ${note}` : ''}`}</span>
    </label>
  );
}
