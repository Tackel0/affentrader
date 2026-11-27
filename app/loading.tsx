import { AffenMark } from "@/components/BrandMark";

export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Lade AffenTerminal Workspace…"
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "100dvh",
        background: "var(--bg, #07090e)",
        color: "var(--muted, #8b949e)",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        fontSize: "13px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
        <AffenMark size={56} variant="tile" />
        <span style={{ fontWeight: 650, fontSize: "16px", color: "var(--text, #f0f4f8)", letterSpacing: "-0.01em" }}>
          AffenTerminal
        </span>
        <span style={{ fontSize: "12px" }}>Market · Orderflow · Quant</span>
      </div>
    </div>
  );
}
