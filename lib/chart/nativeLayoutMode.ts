import type { Vela } from "@luxalgo/vela";

export interface LayoutModeQuery {
  readonly matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

/** Dialogs use the full workspace host: choose touch presentation by viewport, not cell width. */
export function bindNativeLayoutMode(renderer: Pick<Vela["renderer"], "setLayoutMode">, supplied?: LayoutModeQuery): () => void {
  const query = supplied ?? (typeof window !== "undefined" ? window.matchMedia("(max-width: 768px)") : null);
  if (!query) return () => {};
  let disposed = false, current: "mobile" | "desktop" | undefined;
  const update = () => {
    if (disposed) return;
    const next = query.matches ? "mobile" : "desktop";
    if (current === next) return;
    current = next; renderer.setLayoutMode(next);
  };
  query.addEventListener("change", update); update();
  return () => { disposed = true; query.removeEventListener("change", update); };
}
