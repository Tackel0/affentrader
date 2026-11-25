export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Lade AffenTrader Workspace…"
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "100dvh",
        background: "var(--bg, #0d1117)",
        color: "var(--muted, #8b949e)",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        fontSize: "13px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
        <span style={{ fontWeight: 600, color: "var(--text, #e6edf3)", letterSpacing: "0.04em" }}>
          AffenTrader
        </span>
        <span>Workspace wird geladen…</span>
      </div>
    </div>
  );
}
