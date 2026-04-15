import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleDismiss = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '2rem',
          maxWidth: '600px',
          margin: '4rem auto',
          fontFamily: 'system-ui, sans-serif',
          color: '#e0e0e0',
          background: '#1a1a2e',
          borderRadius: '8px',
          border: '1px solid #e74c3c',
        }}>
          <h2 style={{ color: '#e74c3c', marginTop: 0 }}>Something went wrong</h2>
          <p>The UI encountered an error. Your agent runs may still be active in the background.</p>
          <pre style={{
            background: '#0d0d1a',
            padding: '1rem',
            borderRadius: '4px',
            overflow: 'auto',
            fontSize: '0.85rem',
            maxHeight: '200px',
          }}>
            {this.state.error?.message}
          </pre>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button onClick={this.handleDismiss} style={{
              padding: '0.5rem 1rem',
              border: '1px solid #555',
              background: '#2a2a3e',
              color: '#e0e0e0',
              borderRadius: '4px',
              cursor: 'pointer',
            }}>
              Try to recover
            </button>
            <button onClick={this.handleReload} style={{
              padding: '0.5rem 1rem',
              border: 'none',
              background: '#e74c3c',
              color: '#fff',
              borderRadius: '4px',
              cursor: 'pointer',
            }}>
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
