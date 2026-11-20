import React, { useState } from "react";
import Drawer from "@ui/components/ui/Drawer";

/*
 * The shared Drawer, with its unsaved-changes guard switched on for Payroll.
 *
 * Eighteen of Payroll's drawers held forms whose edits were lost to Escape, a
 * click on the scrim or the Back arrow (design audit, Batch 3). Rather than
 * each screen working out whether its form differs from where it started, a
 * drawer here counts as dirty once anything inside it has been typed in or
 * changed, and clean again whenever it opens, closes or a form in it is sent. A screen that knows
 * better passes `dirty` itself, and that wins.
 */
export default function EditDrawer({ dirty, open, children, ...rest }) {
  const [touched, setTouched] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  /* Reset while rendering the open or close, not in an effect after it. */
  if (open !== wasOpen) {
    setWasOpen(open);
    setTouched(false);
  }
  const mark = () => {
    if (!touched) setTouched(true);
  };
  return (
    <Drawer open={open} dirty={dirty === undefined ? touched : dirty} {...rest}>
      {/* A form sent counts as saved: a panel that stays open after its own save does not then ask to discard it. */}
      <div className="contents" onChange={mark} onInput={mark} onSubmit={() => setTouched(false)}>
        {children}
      </div>
    </Drawer>
  );
}
