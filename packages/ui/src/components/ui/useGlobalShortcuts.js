import { useEffect, useRef } from 'react';

/**
 * The shortcuts that work anywhere in the product.
 *
 *   Alt+I   new invoice        Alt+S   new sales order
 *   Alt+P   new payment        Alt+R   new receipt
 *   Alt+C   new credit note    Alt+D   dashboard
 *   Ctrl+/  command menu       ⌘K / Ctrl+K does the same
 *
 * Alt rather than Ctrl for the "new document" set, because every Ctrl+letter
 * worth having is already claimed by the browser and fighting it produces the
 * worst outcome of all: a shortcut that works on one machine.
 *
 * Two things are deliberately not here. Ctrl+S and Ctrl+Enter belong to
 * whichever form is open, since only that form knows what saving means, so
 * they are handled at the form. And Escape belongs to whatever is topmost —
 * a dropdown, then a dialog, then the palette — which is a stack, not a
 * global.
 *
 * @param actions  { newInvoice, newSalesOrder, newPayment, newReceipt,
 *                   newCreditNote, dashboard, openCommand } — any may be
 *                   omitted, in which case that key is left alone.
 */
export function useGlobalShortcuts(actions) {
  /*
   * Held in a ref so a re-render with fresh closures does not tear down and
   * re-register the listener on every keystroke elsewhere in the app. Written
   * in an effect rather than during render: a render that is thrown away must
   * not leave its handlers behind for the listener to call.
   */
  const ref = useRef(actions);
  useEffect(() => {
    ref.current = actions;
  }, [actions]);

  useEffect(() => {
    const onKey = (e) => {
      const a = ref.current || {};

      // Ctrl+/ — the sheet's command menu, alongside the ⌘K the palette
      // already registers.
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        if (!a.openCommand) return;
        e.preventDefault();
        a.openCommand();
        return;
      }

      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

      /*
       * Navigation shortcuts do not fire out from under an open dialog or
       * list. Alt+C means "new credit note" on a screen and "create the master
       * I am missing" inside a picker — Tally's meaning, and the one the hands
       * in that field expect. The same reasoning covers the rest: Alt+S while
       * searching customers should not raise a sales order, and leaving a
       * half-typed document to navigate elsewhere is never what was meant.
       */
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.closest('[role="dialog"], [role="listbox"], [role="menu"]')) return;

      /*
       * Alt+letter is safe inside a text field on every platform we support —
       * it produces no character on Windows or Linux, and on macOS the
       * combinations below are not ones that type anything a person means to
       * type in an accounting form. Composition is still respected: while an
       * IME is mid-word, nothing here fires.
       */
      if (e.isComposing) return;

      const map = {
        i: a.newInvoice,
        s: a.newSalesOrder,
        p: a.newPayment,
        r: a.newReceipt,
        c: a.newCreditNote,
        d: a.dashboard,
      };
      const run = map[String(e.key || '').toLowerCase()];
      if (!run) return;
      e.preventDefault();
      run();
    };

    /*
     * Tally's voucher keys.
     *
     * Everybody who keys accounts in this country learned them there, and they
     * are held in the fingers rather than in the head: F6 is a receipt, and a
     * person reaches for it before deciding to. They cost nothing to honour and
     * a person who has them does not have to learn this screen at all.
     *
     * Three of Tally's are the browser's and are left alone rather than fought
     * over: F5 reloads the page, F11 goes full screen and F12 opens the
     * developer tools. Taking F5 from somebody who meant to reload is a worse
     * trade than a payment voucher is worth — Alt+P raises one, and the sheet
     * on ? says so. The rest are free in a browser and are taken.
     */
    const VOUCHER_KEYS = {
      F4: 'contra',
      F6: 'newReceipt',
      F7: 'newJournal',
      F8: 'newInvoice',
      F9: 'newBill',
    };

    const onFunctionKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return;
      const name = VOUCHER_KEYS[e.key];
      if (!name) return;

      const a = ref.current || {};
      const run = a[name];
      if (!run) return;

      /* Not out from under a dialog or a list, for the same reason the letters
         are not: a key pressed inside a picker belongs to the picker. */
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.closest('[role="dialog"], [role="listbox"], [role="menu"]')) return;

      e.preventDefault();
      run();
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onFunctionKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onFunctionKey);
    };
  }, []);
}

export default useGlobalShortcuts;
