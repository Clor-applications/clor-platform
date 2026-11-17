import { Menu as Base } from '@base-ui/react/menu';

import { popoverZIndex, useOverlayLayer } from './overlayLayer';

/**
 * A menu of actions hanging off the button that opened it, on base-ui.
 *
 * The menus in the bar were a `div role="menu"` beside their button: they said
 * "menu" to a screen reader and then ignored the arrow keys, Home, End and
 * typing a first letter, which is what the role promises. base-ui does that
 * part, places the panel so it stays on screen, closes it on Escape or a
 * click elsewhere and hands the keyboard back to the button.
 *
 *   <Menu open={open} onOpenChange={setOpen}>
 *     <MenuTrigger className="ui-icon-btn" aria-label="Help">…</MenuTrigger>
 *     <MenuPanel aria-label="Help" minWidth={248}>
 *       <MenuItem onClick={…}>Help centre</MenuItem>
 *     </MenuPanel>
 *   </Menu>
 *
 * Not modal: the page behind stays live, so one click on another control both
 * closes the menu and presses that control, as every panel here already does.
 */
export function Menu({ modal = false, ...props }) {
  return <Base.Root modal={modal} {...props} />;
}

export const MenuTrigger = Base.Trigger;

/**
 * The floating panel. `zIndex` is for chrome that outranks the app layers (the
 * platform bar's menus); everything else takes the layer it was opened from.
 */
export function MenuPanel({ children, className = '', style, side = 'bottom', align = 'start', sideOffset = 6, collisionPadding = 8, minWidth, width, zIndex, ...props }) {
  const layer = useOverlayLayer();
  return (
    <Base.Portal>
      <Base.Positioner side={side} align={align} sideOffset={sideOffset} collisionPadding={collisionPadding} positionMethod="fixed" style={{ zIndex: zIndex || popoverZIndex(layer) }}>
        <Base.Popup
          className={`ui-menu ${className}`}
          /* The panel takes focus only to hear the keys; the row in use shows where you are, so the panel draws no ring. */
          style={{ minWidth, width, outline: 'none', ...style }}
          {...props}
        >
          {children}
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );
}

export function MenuItem({ className = '', ...props }) {
  return <Base.Item className={`ui-menu-item ${className}`} {...props} />;
}

/** A row that goes somewhere else: a real link, so it opens in a new tab like one. */
export function MenuLink({ className = '', ...props }) {
  return <Base.LinkItem className={`ui-menu-item ${className}`} {...props} />;
}

/** One of several, exactly one chosen: the company list. Closes on the choice. */
export function MenuRadioItem({ className = '', closeOnClick = true, ...props }) {
  return <Base.RadioItem className={`ui-menu-item ${className}`} closeOnClick={closeOnClick} {...props} />;
}

export const MenuRadioGroup = Base.RadioGroup;
export const MenuGroup = Base.Group;

export function MenuGroupLabel({ className = '', ...props }) {
  return <Base.GroupLabel className={`ui-caption ${className}`} {...props} />;
}

export function MenuSeparator({ className = '', ...props }) {
  return <Base.Separator className={`ui-menu-sep ${className}`} {...props} />;
}

export default Menu;
