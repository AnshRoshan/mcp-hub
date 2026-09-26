import { Component, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { Btn } from "./ui";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Last line of defence: a throwing view must not white-screen the dashboard. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[dashboard] view crashed", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex min-h-dvh items-center justify-center p-5">
        <div className="cold-instrument w-full max-w-[420px]">
          <span className="cold-flag">
            <TriangleAlert size={11} strokeWidth={2.4} />
            Aborted
          </span>
          <div className="cold-title">This screen stopped responding</div>
          <p className="cold-copy">{error.message || "An unexpected error took the view down."}</p>
          <div className="mt-2 flex gap-2">
            <Btn variant="primary" onClick={() => this.setState({ error: null })}>
              Continue
            </Btn>
            <Btn variant="plate" onClick={() => window.location.reload()}>
              Reload
            </Btn>
          </div>
        </div>
      </div>
    );
  }
}
