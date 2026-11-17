export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 520;

export function clampSidebarWidth(width: number): number {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(width)));
}

interface SidebarWidthState {
  read(): number;
  commit(width: number): void;
  subscribe(changed: (width: number) => void): () => void;
}

export function bindSidebarResize(sidebar: HTMLElement, handle: HTMLElement, state: SidebarWidthState): () => void {
  let drag: { pointer: number; x: number; from: number; next: number } | null = null;
  let frame: number | null = null;
  const apply = (width: number) => {
    sidebar.style.width = `${width}px`;
    handle.setAttribute("aria-valuenow", String(width));
  };
  const cancelFrame = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
  const keydown = (event: KeyboardEvent) => {
    if (drag || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    state.commit(clampSidebarWidth(state.read() + (event.key === "ArrowLeft" ? 10 : -10)));
  };
  const start = (event: PointerEvent) => {
    if (drag || event.button !== 0 || !event.isPrimary) return;
    const width = sidebar.getBoundingClientRect().width || state.read();
    handle.setPointerCapture(event.pointerId);
    drag = { pointer: event.pointerId, x: event.clientX, from: width, next: state.read() };
    handle.dataset.resizing = "true";
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.next = clampSidebarWidth(drag.from + drag.x - event.clientX);
    if (frame === null) frame = requestAnimationFrame(() => {
      frame = null;
      if (drag) apply(drag.next);
    });
  };
  const finish = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const width = event.type === "pointerup" ? drag.next : state.read();
    drag = null;
    cancelFrame();
    delete handle.dataset.resizing;
    apply(width);
    if (width !== state.read()) state.commit(width);
  };

  apply(state.read());
  const unsubscribe = state.subscribe((width) => { if (!drag) apply(width); });
  handle.addEventListener("keydown", keydown);
  handle.addEventListener("pointerdown", start);
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  return () => {
    unsubscribe();
    cancelFrame();
    const pointer = drag?.pointer;
    drag = null;
    if (pointer !== undefined && handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
    delete handle.dataset.resizing;
    handle.removeEventListener("keydown", keydown);
    handle.removeEventListener("pointerdown", start);
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", finish);
    handle.removeEventListener("pointercancel", finish);
    handle.removeEventListener("lostpointercapture", finish);
  };
}
