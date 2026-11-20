import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error) {
    // The technical text goes to the console for whoever is debugging, not on screen.
    if (import.meta.env?.DEV) console.error(error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="ui-min-h-viewport flex items-center justify-center ui-sunken p-6">
        <div className="w-full max-w-lg ui-surface border rounded-xl p-6">
          <div className="ui-t-sec">This page could not be shown</div>
          <div className="text-sm ui-muted mt-2">
            Reload the page. Nothing you saved is lost. If it happens again, write to support@clor.in.
          </div>
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded-lg ui-primary-bg"
              onClick={() => window.location.reload()}
            >
              Reload the page
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
