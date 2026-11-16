import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportClientError } from './client-diagnostics';

export class ClientErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    reportClientError('react.error', error);
  }

  render() {
    if (this.state.failed)
      return (
        <main role="alert" className="app-error-fallback">
          <h1>Something went wrong</h1>
          <p>Refresh the page to try again.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Refresh page
          </button>
        </main>
      );
    return this.props.children;
  }
}
