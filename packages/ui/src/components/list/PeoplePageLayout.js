import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useOverlayLayer } from '../ui/overlayLayer';

export const PeoplePageLayout = createContext(null);

// Only pair a single register with a single toolbar. Multiple independent tables
// (for example in reports) keep their controls with their own records.
export function usePeoplePageLayout() {
  const [slots, setSlots] = useState({ heading: [], toolbar: [], table: [] });
  const register = useCallback((kind, previous, next) => {
    setSlots((current) => {
      const nodes = current[kind].filter((node) => node !== previous);
      if (next) nodes.push(next);
      return { ...current, [kind]: nodes };
    });
  }, []);
  return useMemo(() => ({
    register,
    helpTarget: slots.heading.length === 1 ? slots.heading[0] : null,
    columnsTarget: slots.table.length === 1 && slots.toolbar.length <= 1
      ? slots.toolbar[0] || (slots.heading.length === 1 ? slots.heading[0] : null) : null,
  }), [register, slots]);
}

export function usePeoplePageSlot(kind, enabled = true) {
  const layout = useContext(PeoplePageLayout);
  const layer = useOverlayLayer();
  const register = enabled && layer === 'page' ? layout?.register : null;
  const previous = useRef(null);
  const ref = useCallback((node) => {
    if (previous.current === node) return;
    register?.(kind, previous.current, node);
    previous.current = node;
  }, [kind, register]);
  return [register ? ref : null, register ? layout : null];
}
