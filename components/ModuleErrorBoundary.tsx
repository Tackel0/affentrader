"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export interface ModuleErrorBoundaryProps {
  moduleName: string;
  resetKey?: string | number;
  compact?: boolean;
  onReset?: () => void;
  children: ReactNode;
}

interface ModuleErrorBoundaryState {
  hasError: boolean;
  message: string;
  prevResetKey: string | number | undefined;
}

function sanitizeErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error && error.message
      ? error.message
      : typeof error === "string" && error.trim()
        ? error
        : "Unexpected rendering error.";
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return "Unexpected rendering error.";
  return collapsed.length > 220 ? `${collapsed.slice(0, 217)}…` : collapsed;
}

export class ModuleErrorBoundary extends Component<
  ModuleErrorBoundaryProps,
  ModuleErrorBoundaryState
> {
  constructor(props: ModuleErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      message: "",
      prevResetKey: props.resetKey,
    };
  }

  static getDerivedStateFromError(error: unknown): Partial<ModuleErrorBoundaryState> {
    return {
      hasError: true,
      message: sanitizeErrorMessage(error),
    };
  }

  static getDerivedStateFromProps(
    props: ModuleErrorBoundaryProps,
    state: ModuleErrorBoundaryState,
  ): Partial<ModuleErrorBoundaryState> | null {
    if (props.resetKey !== state.prevResetKey) {
      return {
        hasError: false,
        message: "",
        prevResetKey: props.resetKey,
      };
    }
    return null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ModuleErrorBoundary:${this.props.moduleName}]`, error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({
      hasError: false,
      message: "",
      prevResetKey: this.props.resetKey,
    });
    this.props.onReset?.();
  };

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        className={`module-error-boundary${this.props.compact ? " is-compact" : ""}`}
        role="alert"
      >
        <div className="module-error-header">
          <AlertTriangle size={16} aria-hidden="true" />
          <strong>{this.props.moduleName} encountered an error</strong>
        </div>
        <p className="module-error-message">{this.state.message}</p>
        <div className="module-error-actions">
          <button type="button" className="button primary small" onClick={this.handleReset}>
            <RotateCcw size={12} aria-hidden="true" />
            Retry module
          </button>
        </div>
      </div>
    );
  }
}
