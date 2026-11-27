import { createContext, forwardRef, useContext, useState } from 'react';
import * as Base from '@radix-ui/react-dropdown-menu';

import { popoverZIndex, useOverlayLayer } from './overlayLayer';

const TriggerToggle = createContext(null);

export function Menu({ modal = false, open, defaultOpen = false, onOpenChange, ...props }) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const isOpen = open ?? ownOpen;
  const change = (next) => {
    if (open === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  return <TriggerToggle.Provider value={() => change(!isOpen)}>
    <Base.Root modal={modal} open={isOpen} onOpenChange={change} {...props} />
  </TriggerToggle.Provider>;
}

export const MenuTrigger = forwardRef(function MenuTrigger({ onClick, ...props }, ref) {
  const toggle = useContext(TriggerToggle);
  return <Base.Trigger ref={ref} {...props} onClick={(event) => {
    onClick?.(event);
    // Radix handles pointerdown and keydown. Assistive activation can send a click alone.
    if (!event.defaultPrevented && event.detail === 0) toggle?.();
  }} />;
});

/**
 * The floating panel. `zIndex` is for chrome that outranks the app layers (the
 * platform bar's menus); everything else takes the layer it was opened from.
 */
export function MenuPanel({ children, className = '', style, side = 'bottom', align = 'start', sideOffset = 6, collisionPadding = 8, minWidth, width, zIndex, ...props }) {
  const layer = useOverlayLayer();
  return (
    <Base.Portal>
      <Base.Content side={side} align={align} sideOffset={sideOffset} collisionPadding={collisionPadding}
        className={`ui-menu ${className}`} style={{ minWidth, width, outline: 'none', zIndex: zIndex || popoverZIndex(layer), ...style }} {...props}>
        {children}
      </Base.Content>
    </Base.Portal>
  );
}

export function MenuItem({ className = '', ...props }) {
  return <Base.Item className={`ui-menu-item ${className}`} {...props} />;
}

/** A row that goes somewhere else: a real link, so it opens in a new tab like one. */
export function MenuLink({ className = '', ...props }) {
  return <Base.Item asChild><a className={`ui-menu-item ${className}`} {...props} /></Base.Item>;
}

/** One of several, exactly one chosen: the company list. Closes on the choice. */
export function MenuRadioItem({ className = '', closeOnClick = true, ...props }) {
  return <Base.RadioItem className={`ui-menu-item ${className}`} onSelect={closeOnClick ? undefined : (event) => event.preventDefault()} {...props} />;
}

export const MenuRadioGroup = Base.RadioGroup;
export const MenuGroup = Base.Group;

export function MenuGroupLabel({ className = '', ...props }) {
  return <Base.Label className={`ui-caption ${className}`} {...props} />;
}

export function MenuSeparator({ className = '', ...props }) {
  return <Base.Separator className={`ui-menu-sep ${className}`} {...props} />;
}

export default Menu;
