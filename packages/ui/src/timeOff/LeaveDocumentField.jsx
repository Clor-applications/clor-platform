import React, { useState } from 'react';
import FileDrop from '../components/ui/FileDrop';

/**
 * The document a long request of some types asks for (a medical certificate):
 * a PDF or a picture up to 5 MB, read here and sent with the request as a
 * data URL. `value`: { name, data, mime } or null.
 */
export default function LeaveDocumentField({ typeName, afterDays, value, onChange, note = '', required = false }) {
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState(null);
  const read = (file) => {
    setError('');
    const reader = new FileReader();
    reader.onload = () => onChange({ name: file.name, data: String(reader.result), mime: file.type });
    reader.onerror = () => { setError('The file could not be read.'); onChange(null); };
    reader.readAsDataURL(file);
  };
  const pick = (file) => {
    setChosen(file);
    if (!file) { setError(''); onChange(null); return; }
    read(file);
  };
  const shown = chosen || (value ? { name: value.name, type: value.mime } : null);
  return (
    <div className="block space-y-1">
      <FileDrop label="Document" required={required} file={shown} onFile={pick} accept="application/pdf,image/jpeg,image/png,image/webp" maxBytes={5 * 1024 * 1024}
        hint="PDF or picture, up to 5 MB" error={error} onRetry={chosen ? () => read(chosen) : undefined} compact />
      <span className="block ui-caption">{`${typeName || 'This type'} for more than ${afterDays ?? '—'} ${afterDays === 1 ? 'day' : 'days'} asks for a document, such as a medical certificate.${note ? ` ${note}` : ''}`}</span>
    </div>
  );
}
