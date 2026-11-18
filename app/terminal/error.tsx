"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

function readErrorDetails(error: unknown): { message: string; digest: string | null } {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "An unexpected error interrupted AffenTerminal.";
  const digest =
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string"
      ? (error as { digest: string }).digest
      : null;
  return { message, digest };
}

export default function TerminalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[TerminalError]", error);
  }, [error]);

  const { message, digest } = readErrorDetails(error);

  return (
    <main className="route-fallback-screen" role="alert">
      <section className="route-fallback-card">
        <span className="route-fallback-brand">
          <AlertTriangle size={14} aria-hidden="true" />
          AFFENTERMINAL · TERMINAL RECOVERY
        </span>
        <h1>AffenTerminal view interrupted</h1>
        <p>{message}</p>
        {digest ? (
          <p className="route-fallback-digest">
            Reference: <code>{digest}</code>
          </p>
        ) : null}
        <div className="route-fallback-actions">
          <button type="button" className="button primary" onClick={() => retry()}>
            <RotateCcw size={14} aria-hidden="true" />
            Try again
          </button>
          <Link href="/terminal" className="button">
            Reset Terminal
          </Link>
          <Link href="/" className="button">
            Chart Workspace
          </Link>
        </div>
      </section>
    </main>
  );
}
