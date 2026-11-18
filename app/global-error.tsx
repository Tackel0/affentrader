"use client";

import { useEffect } from "react";

function readGlobalErrorDetails(error: unknown): { message: string; digest: string | null } {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "A critical application error occurred while rendering AffenTerminal.";
  const digest =
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string"
      ? (error as { digest: string }).digest
      : null;
  return { message, digest };
}

export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  const { message, digest } = readGlobalErrorDetails(error);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
        <title>AffenTerminal · Application Error</title>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding:
            "calc(20px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(20px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left))",
          background: "#08090c",
          color: "#e1e7f0",
          fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
          fontSize: "13px",
          lineHeight: 1.5,
        }}
      >
        <main
          role="alert"
          style={{
            width: "100%",
            maxWidth: "460px",
            background: "#0d0f14",
            border: "1px solid #1c202a",
            borderRadius: "4px",
            padding: "24px",
            boxShadow: "0 16px 48px rgba(0, 0, 0, 0.5)",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "#ff9e00",
              marginBottom: "10px",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            }}
          >
            AFFENTERMINAL · GLOBAL RECOVERY
          </div>
          <h1 style={{ margin: "0 0 10px", fontSize: "19px", fontWeight: 700, color: "#e1e7f0" }}>
            Application shell interrupted
          </h1>
          <p style={{ margin: "0 0 12px", color: "#94a3b8", overflowWrap: "anywhere" }}>{message}</p>
          {digest ? (
            <p
              style={{
                margin: "0 0 16px",
                fontSize: "11px",
                color: "#64748b",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              }}
            >
              Reference: <code>{digest}</code>
            </p>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "16px" }}>
            <button
              type="button"
              onClick={() => retry()}
              style={{
                minHeight: "40px",
                minWidth: "110px",
                padding: "0 16px",
                border: "1px solid #f59e0b",
                borderRadius: "2px",
                background: "#ff9e00",
                color: "#000000",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.assign("/")}
              style={{
                minHeight: "40px",
                minWidth: "110px",
                padding: "0 16px",
                border: "1px solid #1c202a",
                borderRadius: "2px",
                background: "#131720",
                color: "#e1e7f0",
                fontWeight: 600,
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Reload app
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
