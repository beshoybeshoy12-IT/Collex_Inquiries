import { Component } from 'react';

/**
 * The last line of defence.
 *
 * A render error anywhere below this unmounts the whole tree and leaves a blank
 * white page — which users report as "the system is down" and which tells
 * nobody anything. This catches it, keeps the message on screen, and offers the
 * only two things that actually help: reload, or go back to a known-good page.
 *
 * The error text is shown only in development. In production it would be a
 * stack trace in front of a coordinator, which is neither useful to them nor
 * something this application should be putting on screen.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept in the console rather than sent anywhere: there is no error
    // reporting service wired up, and pretending otherwise would be worse than
    // saying so.
     
    console.error('Unhandled render error', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="d-flex vh-100 align-items-center justify-content-center p-4">
        <div className="text-center" style={{ maxWidth: 480 }}>
          <i
            className="bi bi-exclamation-octagon text-danger"
            style={{ fontSize: '3rem' }}
            aria-hidden="true"
          />
          <h1 className="h5 mt-3">Something went wrong</h1>
          <p className="text-body-secondary small">
            The page could not be displayed. Reloading usually fixes it.
          </p>

          {import.meta.env.DEV && (
            <pre className="text-start small bg-body-tertiary p-2 rounded overflow-auto mt-3" style={{ maxHeight: 200 }}>
              {String(this.state.error?.stack ?? this.state.error)}
            </pre>
          )}

          <div className="d-flex gap-2 justify-content-center mt-3">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => {
                window.location.href = '/';
              }}
            >
              Go to the dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
