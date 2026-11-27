import { NumericFormat } from 'react-number-format';

export default function MoneyInput({ className = '', wrapClassName = '', type, value, onChange, ...props }) {
  const controlled = value !== undefined && typeof onChange === 'function';
  // Reject a malformed edit before the formatter strips letters from a pasted amount.
  const validateAmount = event => {
    if (!/^-?[\d,]*\.?\d*$/.test(event.target.value)) event.stopPropagation();
  };
  return (
    <span className={`ui-money-field ${wrapClassName}`} onChangeCapture={controlled ? validateAmount : undefined}>
      {controlled ? (
        <NumericFormat {...props} inputMode="decimal" className={`ui-input ${className} ui-money-input`} value={value ?? ''} valueIsNumericString thousandSeparator="," thousandsGroupStyle="lakh"
          onValueChange={({ value: raw }, source) => {
            if (source.source !== 'event') return;
            const input = source.event.currentTarget || source.event.target;
            const target = new Proxy(input, {
              get(element, key) {
                if (key === 'value') return raw;
                const prop = Reflect.get(element, key, element);
                return typeof prop === 'function' ? prop.bind(element) : prop;
              },
            });
            onChange(Object.create(source.event, { target: { value: target }, currentTarget: { value: target } }));
          }} />
      ) : <input {...props} inputMode="decimal" className={`ui-input ${className} ui-money-input`} type={type} value={value} onChange={onChange} />}
    </span>
  );
}
