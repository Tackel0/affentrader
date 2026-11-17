import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useChartStore } from "@/stores/useChartStore";
import { priceLevelAction } from "./priceLevelAction";

export function PriceLevelMenu({ price, draw, drawArea, children }: {
  price: number;
  draw: () => void;
  drawArea?: () => void;
  children: (actions: ReturnType<typeof priceLevelAction>) => ReactNode;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const close = (restoreFocus = false) => {
    setPosition(null);
    if (restoreFocus) anchor.current?.querySelector<HTMLElement>("button, [tabindex]")?.focus();
  };
  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector("button")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setPosition(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [position]);
  const open = () => {
    const rect = anchor.current?.getBoundingClientRect();
    if (rect) setPosition({ left: Math.max(4, Math.min(rect.left, window.innerWidth - 164)), top: Math.max(4, Math.min(rect.bottom, window.innerHeight - (drawArea ? 120 : 90))) });
  };
  return <span ref={anchor}>
    {children(priceLevelAction(open))}
    {position && createPortal(<div ref={menu} role="group" aria-label={`Actions for price ${price}`}
      style={{ position: "fixed", ...position, zIndex: 2000, display: "grid", gap: 4, padding: 6, background: "Canvas", color: "CanvasText", border: "1px solid GrayText", borderRadius: 4 }}
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(true); } }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
      <button type="button" className="button small" onClick={() => { close(true); draw(); }}>Draw line</button>
      {drawArea && <button type="button" className="button small" onClick={() => { close(true); drawArea(); }}>Draw area</button>}
      <button type="button" className="button small" onClick={async () => {
        close(true);
        try {
          await navigator.clipboard.writeText(String(price));
          useChartStore.getState().toast("Price copied", String(price), "success");
        } catch {
          useChartStore.getState().toast("Could not copy price", String(price), "error");
        }
      }}>Copy price</button>
    </div>, document.body)}
  </span>;
}
