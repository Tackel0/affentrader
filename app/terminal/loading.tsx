export default function TerminalLoading() {
  return (
    <div
      role="status"
      aria-label="Lade AffenTerminal…"
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "100dvh",
        background: "var(--bg, #0d1117)",
        color: "var(--muted, #8b949e)",
        fontFamily: "var(--font-mono, monospace)",
        fontSize: "12px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
        <strong style={{ color: "var(--text, #e6edf3)", letterSpacing: "0.06em" }}>
          AFFENTERMINAL PRO
        </strong>
        <span>Terminal-Module werden geladen…</span>
      </div>
    </div>
  );
}
