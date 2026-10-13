import React from 'react';

/**
 * One app's screen failing must not take the platform down with it.
 *
 * Without this, a crash anywhere inside Payroll unmounts the whole React tree —
 * header, switcher, everything — and the user is left with a white page and no
 * way back. That is the failure mode a platform exists to prevent: the apps are
 * separate, so their failures should be too.
 *
 * It resets when the screen changes, so moving somewhere else is the way out,
 * rather than reloading and losing where you were.
 */
export default class ScreenBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error, info) {
    /* In the real product this is where the platform reports it — one place,
       tagged with which app failed, rather than each app rolling its own. */
    console.error(`[clor] ${this.props.appName || 'app'} screen failed:`, error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="ui-card p-6" style={{ maxWidth: '40rem' }}>
        <h1 className="ui-display text-xl">This screen could not be shown</h1>
        <p className="mt-2 text-sm ui-muted">
          Something in {this.props.appName || 'this app'} failed while drawing this page. The rest of Clor is unaffected —
          pick another screen, or another app, from the rail.
        </p>
        <pre
          className="mt-4 overflow-x-auto rounded-lg p-3 text-xs"
          style={{ backgroundColor: 'rgb(var(--surface-sunken))' }}
        >
          {String(this.state.error?.message || this.state.error)}
        </pre>
      </div>
    );
  }
}
