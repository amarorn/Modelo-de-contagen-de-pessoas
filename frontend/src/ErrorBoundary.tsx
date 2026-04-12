import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[dashboard]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
            background: "#1a0505",
            color: "#fecaca",
            minHeight: "100vh",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>
            Erro ao carregar o dashboard
          </h1>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: "0.875rem",
            }}
          >
            {this.state.error.message}
          </pre>
          <p style={{ marginTop: "1rem", color: "#94a3b8", fontSize: "0.875rem" }}>
            Abra a consola do navegador (F12) para mais detalhes. Recarregue a
            página após corrigir.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
