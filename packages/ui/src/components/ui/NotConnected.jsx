import React from 'react';
import { PlugZap } from 'lucide-react';

/**
 * A page that is built but not wired, saying so where nobody can miss it.
 *
 * The screens for billing and single sign-on exist ahead of the services behind
 * them, which is a reasonable way to build — the layout, the copy and the shape
 * of the data get settled while the integration is still a decision. What is
 * not reasonable is a screen that looks live and is not: somebody demonstrates
 * it to a customer, the customer believes the product does this today, and
 * nobody finds out until it is promised.
 *
 * So it is stated in the page, above the content, in the product's own warning
 * colour rather than a grey aside that reads as decoration.
 *
 * @param what    the thing that is not connected, named plainly
 * @param sample  whether the figures below are invented
 */
export const NotConnected = ({ what, sample = false, children }) => (
  <div
    className="flex items-start gap-3 rounded-xl p-4"
    style={{ background: 'rgb(var(--warn-soft))', color: 'rgb(var(--warn-ink))' }}
    role="status"
  >
    <PlugZap size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
    <div className="text-sm">
      <div className="font-semibold">Preview — {what} is not connected yet.</div>
      <div className="mt-0.5">
        {sample ? 'The figures below are sample data, not this account. ' : ''}
        {children}
      </div>
    </div>
  </div>
);

export default NotConnected;
