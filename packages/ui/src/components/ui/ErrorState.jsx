import React from 'react';
import { AlertCircle, Clock, Lock, SearchX, WifiOff, RefreshCw } from 'lucide-react';

/**
 * ErrorState (People design spec v1 §8): one place that says what went wrong
 * and what to do, without losing work. `errorKind(err)` reads an apiFetch
 * error: a network failure (no answer) is "offline"; a server answer is told
 * apart by status. The browser's online flag is only a hint (§8): a request
 * that failed while "online" is still a failed request.
 */
export function errorKind(err) {
  if (!err) return null;
  if (err.network) return 'offline';
  const s = Number(err.status || 0);
  if (s === 401) return 'signedOut';
  if (s === 403) return 'forbidden';
  if (s === 404) return 'notFound';
  if (s === 409) return 'conflict';
  if (s === 429) return 'tooMany';
  if (s >= 500 || !s) return 'unavailable';
  return 'failed';
}

const COPY = {
  offline: { Icon: WifiOff, title: 'No connection', body: 'Check your connection and try again. Anything you entered is still here.' },
  unavailable: { Icon: AlertCircle, title: 'Something went wrong on our side', body: 'Nothing was changed. Try again in a moment.' },
  signedOut: { Icon: Lock, title: 'You were signed out', body: 'Sign in again to carry on. What you typed is kept on this page.' },
  forbidden: { Icon: Lock, title: 'You don’t have access to this', body: 'Ask an admin if you need it.' },
  notFound: { Icon: SearchX, title: 'Not found', body: 'It may have been removed, or the link is out of date.' },
  conflict: { Icon: RefreshCw, title: 'Someone else changed this', body: 'Reload to see their changes, then make yours again. Nothing was overwritten.' },
  tooMany: { Icon: Clock, title: 'Too many requests', body: 'Wait a minute, then try again.' },
  failed: { Icon: AlertCircle, title: 'That didn’t work', body: '' },
  slow: { Icon: Clock, title: 'Taking longer than usual', body: 'Still working on it. This can take a few more seconds.' },
};

export default function ErrorState({ kind, error = null, title, body, onRetry = null, retryLabel = 'Retry', onCancel = null, onBack = null, compact = false }) {
  const k = kind || errorKind(error) || 'failed';
  const c = COPY[k] || COPY.failed;
  const Icon = c.Icon;
  const message = body ?? (k === 'failed' && error?.message ? error.message : c.body);
  const ref = error?.requestId;
  return (
    <div className={`ui-error-state ${compact ? 'is-compact' : ''}`} role={k === 'slow' ? 'status' : 'alert'}>
      <Icon size={compact ? 20 : 32} aria-hidden="true" className="ui-error-state-icon" />
      <p className="ui-error-state-title">{title || c.title}</p>
      {message ? <p className="ui-error-state-body">{message}</p> : null}
      {ref && (k === 'unavailable' || k === 'failed') ? <p className="ui-caption">Reference: <span className="tabular-nums">{ref}</span></p> : null}
      <div className="ui-error-state-actions">
        {onBack && k === 'notFound' ? <button type="button" className="ui-btn ui-btn-secondary" onClick={onBack}>Go back</button> : null}
        {onCancel && k === 'slow' ? <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel}>Cancel</button> : null}
        {onRetry && !['forbidden', 'notFound', 'slow'].includes(k) ? <button type="button" className="ui-btn ui-btn-primary" onClick={onRetry}>{k === 'conflict' ? 'Reload' : retryLabel}</button> : null}
      </div>
    </div>
  );
}
