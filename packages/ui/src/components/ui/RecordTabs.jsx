import * as Tabs from '@radix-ui/react-tabs';
import { motion as Motion, useReducedMotion } from 'motion/react';
import React, { useId, useLayoutEffect, useState } from 'react';

/**
 * Record tabs (People design spec v1 §5 "Tabs"): distinct sections of one
 * record. A tablist with roving focus — Left/Right/Home/End move and select,
 * as the WAI-ARIA tabs pattern does — and one tabpanel. The caller keeps the
 * chosen tab in the address (shell `updateParams`) so Back and refresh keep it.
 * Tabs the viewer may not open are simply not passed in.
 */
/*
 * The underline slides from the tab you left to the one you chose, so the eye
 * follows the change of section. It measures the active tab after layout and
 * after any resize; without a measurement yet it is not drawn and the tab's
 * own underline shows instead.
 */
export function useTabIndicator(listRef, activeKey) {
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const place = () => {
      const tab = list.querySelector('[role="tab"][aria-selected="true"]');
      setBox(tab ? { left: tab.offsetLeft, width: tab.offsetWidth } : null);
    };
    place();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    ro?.observe(list);
    return () => ro?.disconnect();
  }, [listRef, activeKey]);
  if (!box) return null;
  /* Moved and stretched with transform alone, so the slide never animates layout (width); a 100px line scaled
     to the tab's width. Every app but Books, which keeps its own (interaction audit 21 Nov 2026). */
  if (typeof document !== 'undefined' && document.documentElement.dataset.palette !== 'indigo') {
    return <span className="ui-tab-indicator" data-scaled="" aria-hidden="true" style={{ width: 100, transformOrigin: '0 0', transform: `translateX(${box.left}px) scaleX(${box.width / 100})` }} />;
  }
  return <span className="ui-tab-indicator" aria-hidden="true" style={{ transform: `translateX(${box.left}px)`, width: box.width }} />;
}

export default function RecordTabs({ tabs, value, onChange, label = 'Sections', children }) {
  const base = useId();
  const current = tabs.some((tab) => tab.key === value) ? value : tabs[0]?.key;
  const reduced = useReducedMotion();
  const many = tabs.length >= 7;
  return (
    <Tabs.Root value={current} onValueChange={onChange} className={`ui-record-tabs ${many ? 'is-many' : ''}`}>
      <Tabs.List aria-label={label} className="ui-record-tablist has-indicator">
        {tabs.map((tab) => (
          <Tabs.Trigger key={tab.key} value={tab.key} className={`ui-tab relative ${tab.key === current ? 'is-active' : ''}`}
            onKeyDown={(event) => {
              if (!many || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
              event.preventDefault();
              const triggers = Array.from(event.currentTarget.parentNode.querySelectorAll('[role="tab"]'));
              triggers[(triggers.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1) + triggers.length) % triggers.length].focus();
            }}>
            {tab.label}
            {tab.count != null && <span className="ui-caption tabular-nums ml-1">{tab.count}</span>}
            {tab.key === current && <Motion.span aria-hidden="true" className="ui-tab-indicator" layoutId={`record-tab-${base}`}
              style={{ left: 0, right: 0 }} transition={{ duration: reduced ? 0 : 0.15 }} />}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content key={current} value={current} className="ui-record-tabpanel ui-panel-in">{children}</Tabs.Content>
    </Tabs.Root>
  );
}
