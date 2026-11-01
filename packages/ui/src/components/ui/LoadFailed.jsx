import React from 'react';

/**
 * A screen whose data did not load says so, and offers to try again — instead
 * of a loading card that never ends once the error toast has gone (a 403 for
 * someone without access, a dropped connection, a server error). Renders
 * nothing when there is no error.
 */
export default function LoadFailed({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="ui-card flex flex-wrap items-center justify-between gap-3 p-4 text-sm" role="alert">
      <span style={{ color: 'rgb(var(--neg))' }}>{message}</span>
      {onRetry ? (
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
