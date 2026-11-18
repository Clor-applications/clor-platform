import React, { useState } from 'react';

/*
 * Round 25 pick (uan, A): the PF number is asked as a question first. Someone
 * who had PF at an earlier job keeps their UAN for life, so the form asks for
 * it; someone new to PF has none yet, and a blank box would only invite a
 * made-up number. A UAN already on file answers the question itself.
 */
export default function UanQuestion({ value, onChange, id = 'employee-uan' }) {
  const [hadPf, setHadPf] = useState(value ? 'yes' : '');
  const name = `${id}-had-pf`;
  return (
    <fieldset className="sm:col-span-2 space-y-2">
      <legend className="ui-label">Had PF before, at an earlier job?</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {[['yes', 'Yes'], ['no', 'No']].map(([v, label]) => (
          <label key={v} className="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              className="ui-radio"
              name={name}
              checked={hadPf === v}
              onChange={() => {
                setHadPf(v);
                if (v === 'no' && value) onChange('');
              }}
            />
            {label}
          </label>
        ))}
      </div>
      {hadPf === 'yes' ? (
        <div className="sm:max-w-xs">
          <label className="ui-label" htmlFor={id}>UAN</label>
          <input id={id} className="ui-input ui-mono w-full" inputMode="numeric" maxLength={12} value={value || ''} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} aria-describedby={`${id}-hint`} />
          <p id={`${id}-hint`} className="ui-caption mt-1">12 digits, from an old payslip or the PF portal. Their old PF moves across with it.</p>
        </div>
      ) : null}
      {hadPf === 'no' ? <p className="ui-caption">No UAN yet. One is made when they are first on a PF return.</p> : null}
    </fieldset>
  );
}
