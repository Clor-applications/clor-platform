import React from 'react';

/**
 * One Books screen failing must not take Books' menu with it.
 *
 * Books routes its own screens inside the shell's one boundary for the app, and
 * its rail sits inside that boundary too. Without this, a screen that throws
 * replaced the whole of Books, rail included, and every screen opened after it
 * showed the same error until the page was reloaded (found 16 Nov 2026: the
 * Trial Balance screen took every other screen down after it). This sits
 * around the open screen only and clears itself when the screen changes.
 */
export const ThrowError = ({ error }) => {
  throw error;
};

export default class ScreenErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error, info) {
    console.error(`[clor] Books screen "${this.props.resetKey}" failed:`, error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="py-6" style={{ maxWidth: '40rem' }}>
        <h1 className="ui-t-page">This screen could not be shown</h1>
        <p className="mt-2 ui-t-body ui-muted">
          Something failed while drawing this page. Nothing you saved is lost — pick another screen from the menu on the left, or try again.
        </p>
        <p className="mt-3 text-xs ui-muted break-words">{String(this.state.error?.message || this.state.error)}</p>
        <button type="button" className="ui-btn ui-btn-secondary mt-4" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
