import React from 'react';
import { Check, ChevronDown, Search } from './lineIcons';
import { Menu as UiMenu, MenuPanel, MenuRadioGroup, MenuRadioItem, MenuTrigger } from './Menu';
import './filter-select.css';

/**
 * A form field that picks one value from a list, with a search box once the list is long
 * (DESIGN.md "Fields": five or more options get one). It stands in for a native <select>
 * where the list can run long (people, departments, branches, states): a native select
 * cannot be searched, so finding one name in two hundred means scrolling.
 *
 * It takes the same parts as the <select> it replaces, so a swap is the tag name:
 *
 *   <SelectField id="emp" className="ui-input w-full" value={who} onChange={(e) => setWho(e.target.value)}>
 *     <option value="">Choose a person</option>
 *     {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
 *   </SelectField>
 *
 * `onChange` gets `{ target: { value, name } }`, so `e.target.value` handlers keep working.
 * A `name` also writes a hidden input, so a form read with FormData still sees the value.
 * The field opens a menu under itself (it flips to stay on screen), arrows move through
 * it, Escape closes it and gives focus back.
 */
export const SEARCH_FROM = 5;

function readOptions(children, out = []) {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment || child.type === 'optgroup') {
      readOptions(child.props.children, out);
      return;
    }
    if (child.type !== 'option') return;
    const label = React.Children.toArray(child.props.children).join('');
    const value = child.props.value === undefined ? label : String(child.props.value);
    out.push({ value, label, disabled: Boolean(child.props.disabled) });
  });
  return out;
}

export function SelectField({
  id, name, value, defaultValue, onChange, children, className = 'ui-input', disabled = false, required = false,
  searchable, width, 'aria-label': ariaLabel, 'aria-describedby': describedBy, ...rest
}) {
  const options = readOptions(children);
  const [own, setOwn] = React.useState(defaultValue ?? options[0]?.value ?? '');
  const current = value === undefined ? own : String(value ?? '');
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const chosen = options.find((o) => o.value === current) || options[0];
  const withSearch = searchable ?? options.length >= SEARCH_FROM;
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const autoId = React.useId();
  const valueId = `${id || autoId}-value`;
  const trigger = React.useRef(null);
  const findBox = React.useRef(null);
  const [labelText, setLabelText] = React.useState('');

  /* The field's label names it, and would hide the chosen value from a screen reader, so the value
     is its description. The label's words also name the search box ("Find employee"). */
  React.useEffect(() => {
    const label = trigger.current?.labels?.[0];
    if (!label) return;
    const own = label.contains(trigger.current) ? trigger.current.textContent || '' : '';
    setLabelText((label.textContent || '').replace(own, ''));
  }, []);

  /* The menu takes focus as it opens; the search box takes it straight back, so the first
     letter typed after the click lands in the box. */
  React.useEffect(() => {
    if (!open || !withSearch) return undefined;
    const f = requestAnimationFrame(() => findBox.current?.focus());
    return () => cancelAnimationFrame(f);
  }, [open, withSearch]);

  const onOpenChange = (next) => {
    setOpen(next);
    if (!next) setQuery('');
  };
  const pick = (v) => {
    if (value === undefined) setOwn(v);
    if (v !== current) onChange?.({ target: { value: v, name }, currentTarget: { value: v, name } });
    onOpenChange(false);
  };
  const what = (ariaLabel || labelText).replace(/[*:]/g, '').trim().toLowerCase();

  return (
    <>
      <UiMenu open={open} onOpenChange={disabled ? undefined : onOpenChange}>
        <MenuTrigger
          ref={trigger}
          id={id}
          type="button"
          className={`${className} ui-select-field`}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-describedby={[valueId, describedBy].filter(Boolean).join(' ')}
          {...rest}
        >
          <span id={valueId} className="ui-select-field-v">{chosen?.label || ''}</span>
          <ChevronDown size={16} aria-hidden="true" className="ui-select-field-caret" />
        </MenuTrigger>
        <MenuPanel aria-label={ariaLabel || what || 'Choose'} minWidth="max(12rem, var(--anchor-width))" width={width} sideOffset={4} style={{ maxHeight: '20rem', overflowY: 'auto' }}>
          {withSearch ? (
            <div className="ui-chip-search ui-select-field-find">
              <Search size={14} aria-hidden="true" />
              <input
                ref={findBox}
                className="ui-input ui-chip-search-input"
                type="search"
                value={query}
                placeholder={what ? `Find ${what}` : 'Find'}
                aria-label={what ? `Find ${what}` : 'Find'}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
                /* The menu reads letters as "jump to the item that starts with…"; in the box they are typing.
                   Arrow down, Escape and Tab still go to the menu. Enter takes the only match. */
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const live = shown.filter((o) => !o.disabled);
                    if (live.length === 1) pick(live[0].value);
                    return;
                  }
                  if (e.key !== 'ArrowDown' && e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation();
                }}
              />
            </div>
          ) : null}
          <MenuRadioGroup value={current} onValueChange={pick}>
            {shown.map((o) => (
              <MenuRadioItem key={o.value || '__none'} value={o.value} disabled={o.disabled} className="ui-chip-item">
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.value === current ? <Check size={14} aria-hidden="true" /> : null}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          {withSearch && !shown.length ? <p className="ui-chip-none">Nothing matches “{query.trim()}”.</p> : null}
        </MenuPanel>
      </UiMenu>
      {required ? (
        /* A required field stops the form while it is empty, as a native select does: the browser
           checks this stand-in, and its "please choose" sends focus back to the field. */
        <input
          className="ui-select-field-check"
          name={name}
          value={current}
          required
          tabIndex={-1}
          aria-hidden="true"
          onChange={() => {}}
          onFocus={() => trigger.current?.focus()}
        />
      ) : name ? <input type="hidden" name={name} value={current} /> : null}
    </>
  );
}

export default SelectField;
