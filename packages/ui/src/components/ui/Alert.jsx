import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from '@ui/components/ui/lineIcons';

/**
 * Inline Alert / Banner (People design spec v1 §5 "Toast / Alert"): a message
 * that stays on the page until dealt with — action required, warning, success,
 * information — with an optional action and dismiss. Errors are announced
 * (role="alert"); the rest are polite (role="status").
 */
const TONES = {
  neg: { Icon: AlertCircle, cls: 'ui-alert-neg' },
  warn: { Icon: AlertTriangle, cls: 'ui-alert-warn' },
  pos: { Icon: CheckCircle2, cls: 'ui-alert-pos' },
  info: { Icon: Info, cls: 'ui-alert-info' },
};

export default function Alert({ tone = 'info', title, children, action = null, onDismiss = null, dismissLabel = 'Dismiss' }) {
  const { Icon, cls } = TONES[tone] || TONES.info;
  return (
    <div className={`ui-alert ${cls}`} role={tone === 'neg' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden="true" className="ui-alert-icon" />
      <div className="min-w-0 flex-1">
        {title ? <p className="ui-alert-title">{title}</p> : null}
        {children ? <div className="ui-alert-body">{children}</div> : null}
      </div>
      {action ? <div className="ui-alert-action">{action}</div> : null}
      {onDismiss ? (
        <button type="button" className="ui-icon-btn" aria-label={dismissLabel} onClick={onDismiss}>
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
