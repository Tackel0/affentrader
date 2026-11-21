export interface FootprintMagnifierSurface { mount(canvas: HTMLCanvasElement): void; acquire(dpr: number): CanvasRenderingContext2D | undefined; clear(): void; release(): void; destroy(): void }
/** Separate topmost, pointer-transparent canvas; each layer owns and clears it. */
export function createFootprintMagnifierSurface(): FootprintMagnifierSurface {
  let host: HTMLCanvasElement | undefined, canvas: HTMLCanvasElement | undefined, dirty = false;
  const clear = () => { if (!canvas || !dirty) return; const ctx = canvas.getContext("2d"); if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); } dirty = false; };
  const release = () => { if (canvas) { if (canvas.width) canvas.width = 0; if (canvas.height) canvas.height = 0; } dirty = false; };
  const destroy = () => { release(); canvas?.remove(); canvas = undefined; host = undefined; };
  return { mount(value) { if (host !== value) { destroy(); host = value; } },
    acquire(dpr) {
      const parent = host?.parentElement, doc = host?.ownerDocument; if (!host || !parent || !doc || typeof doc.createElement !== "function") return undefined;
      if (!canvas) { canvas = doc.createElement("canvas"); Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" }); canvas.dataset.footprintMagnifier = "true"; canvas.setAttribute("aria-hidden", "true"); }
      if (canvas.parentElement !== parent || parent.lastElementChild !== canvas) parent.appendChild(canvas);
      if (canvas.width !== host.width || canvas.height !== host.height) { canvas.width = host.width; canvas.height = host.height; }
      const ctx = canvas.getContext("2d"); if (!ctx) return undefined;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); dirty = true; return ctx;
    }, clear, release, destroy };
}
