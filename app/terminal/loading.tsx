import { AffenMark } from "@/components/BrandMark";

export default function TerminalLoading() {
  return (
    <div
      role="status"
      aria-label="Lade AffenTerminal…"
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "100dvh",
        background: "var(--bg, #07090e)",
        color: "var(--muted, #8b949e)",
        fontFamily: "var(--font-mono, monospace)",
        fontSize: "12px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
        <AffenMark size={56} variant="tile" />
        <strong style={{ color: "var(--text, #f0f4f8)", letterSpacing: "0.06em" }}>
          AFFENTERMINAL PRO
        </strong>
        <span>Terminal-Module werden geladen…</span>
      </div>
    </div>
  );
}
