// A safety net for the screen.
//
// If one part of the app hits a bug while drawing, only that part is replaced
// by a short message with a way to carry on. Without this, a single bad piece
// of data could blank the whole window in the middle of a round.

import { Component, type ComponentChildren } from 'preact';

interface Props {
  children: ComponentChildren;
  /** What to call the broken part, e.g. "the flow". */
  what: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static override getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown): void {
    console.error(`Could not draw ${this.props.what}`, error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div class="crash" role="alert">
        <h2>Something went wrong showing {this.props.what}.</h2>
        <p>
          Your work is saved: everything you typed was written to this computer as you went. Try again first. If the problem comes back, reload the app; it reopens
          exactly where you were.
        </p>
        <div class="row-tight">
          <button class="btn btn-primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button class="btn" onClick={() => location.reload()}>
            Reload the app
          </button>
        </div>
        <details>
          <summary>Details for a bug report</summary>
          <pre class="crash-detail">{`${error.name}: ${error.message}\n${error.stack ?? ''}`.slice(0, 1500)}</pre>
        </details>
      </div>
    );
  }
}
