import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch() {
    // Intentionally minimal: avoid noisy console logs in production builds.
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="ui-min-h-viewport flex items-center justify-center ui-sunken p-6">
        <div className="w-full max-w-lg ui-surface border rounded-xl p-6">
          <div className="ui-t-sec">Something went wrong</div>
          <div className="text-sm ui-muted mt-2">
            Try refreshing the page. If the problem continues, check the last change.
          </div>
          <div className="mt-4 text-xs ui-muted break-words">
            {String(this.state.error?.message || this.state.error || '')}
          </div>
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded-lg ui-primary-bg"
              onClick={() => window.location.reload()}
            >
              Refresh
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
