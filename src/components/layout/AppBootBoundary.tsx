import * as React from 'react';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

/**
 * Production boot guard. A startup/runtime exception must never leave the user
 * staring at a blank WebView; show a recoverable diagnostic screen instead.
 */
export class AppBootBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Testagram boot] React render failure', error, info);
  }

  private reload = () => window.location.reload();

  render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error?.message || 'Unknown application error';
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <section className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-xl">
          <div className="text-3xl mb-3">⚠️</div>
          <h1 className="text-xl font-black">Testagram could not start</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The app hit a startup error. Your account and wallet data are not deleted.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-xl bg-muted p-3 text-xs whitespace-pre-wrap break-words">
            {message}
          </pre>
          <button
            type="button"
            onClick={this.reload}
            className="mt-5 w-full rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground"
          >
            Reload Testagram
          </button>
        </section>
      </main>
    );
  }
}
