const HEIGHT_PROPERTY = "--panel-height";
const DEFAULT_HEIGHT = 370;
const MIN_HEIGHT = 200;
export const COMPACT_WORKSPACE_QUERY = "(max-width: 768px), (max-width: 1366px) and (pointer: coarse)";

export function bindBottomPanelResize(panel: HTMLElement, content: HTMLElement, handle: HTMLElement, chart: HTMLElement, availableHeight?: () => number) {
  const compact = window.matchMedia(COMPACT_WORKSPACE_QUERY);
  let limits = { min: 0, max: 0 };
  let drag: { pointer: number; y: number; height: number; previous: string; next: number } | null = null;
  let frame: number | null = null;
  let restoreHeight = DEFAULT_HEIGHT;

  const clamp = (height: number) => Math.max(limits.min, Math.min(limits.max, Math.round(height)));
  const stops = () => [limits.min, Math.round((limits.min + limits.max) / 2), limits.max];
  const nearestStop = (height: number) => stops().reduce((nearest, stop) =>
    Math.abs(stop - height) < Math.abs(nearest - height) ? stop : nearest);
  const announceHeight = (height: number) => {
    const rounded = Math.round(height);
    handle.setAttribute("aria-valuenow", String(rounded));
    const label = compact.matches ? ["Peek", "Half height", "Full height"][stops().lastIndexOf(rounded)] : undefined;
    if (label) handle.setAttribute("aria-valuetext", label);
    else handle.removeAttribute("aria-valuetext");
  };
  const setSize = (height: number) => {
    const next = clamp(height);
    panel.style.setProperty(HEIGHT_PROPERTY, `${next}px`);
    announceHeight(next);
  };

  const measure = () => {
    const height = content.getBoundingClientRect().height;
    const chartMin = parseFloat(getComputedStyle(chart).minHeight) || 0;
    const contentMax = parseFloat(getComputedStyle(content).maxHeight);
    // Flexbox protects the chart minimum. Any space above it can go to the panel.
    const available = availableHeight?.() ?? height + Math.max(0, chart.getBoundingClientRect().height - chartMin);
    const max = Math.max(0, Math.floor(Math.min(available, Number.isFinite(contentMax) ? contentMax : Infinity)));
    limits = { min: Math.min(MIN_HEIGHT, max), max };
    handle.setAttribute("aria-valuemin", String(limits.min));
    handle.setAttribute("aria-valuemax", String(max));
    announceHeight(height);
    return height;
  };

  const observer = new ResizeObserver(measure);
  observer.observe(chart);
  observer.observe(content);
  window.addEventListener("resize", measure);
  measure();

  const stop = (commit: boolean) => {
    if (!drag) return;
    const { pointer, previous, next, height: dragHeight } = drag;
    drag = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    delete handle.dataset.resizing;
    if (commit) setSize(compact.matches && Math.abs(next - dragHeight) >= 4 ? nearestStop(next) : next);
    else {
      panel.style.setProperty(HEIGHT_PROPERTY, previous);
      measure();
    }
    if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
  };

  const start = (event: PointerEvent) => {
    if (drag || event.button !== 0 || !event.isPrimary) return;
    const height = measure();
    handle.setPointerCapture(event.pointerId);
    drag = { pointer: event.pointerId, y: event.clientY, height, previous: panel.style.getPropertyValue(HEIGHT_PROPERTY), next: height };
    handle.dataset.resizing = "true";
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.next = drag.height + drag.y - event.clientY;
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (drag) setSize(drag.next);
    });
  };
  const finish = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const commit = event.type === "pointerup";
    if (commit) drag.next = drag.height + drag.y - event.clientY;
    stop(commit);
  };
  const maximize = () => {
    panel.style.setProperty(HEIGHT_PROPERTY, "100dvh");
    announceHeight(limits.max);
  };
  const keydown = (event: KeyboardEvent) => {
    if (drag && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      stop(false);
      return;
    }
    if (drag || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const height = measure();
    if (event.key === "End") maximize();
    else if (event.key === "Home") setSize(limits.min);
    else if (compact.matches) {
      const current = Math.round(height);
      const next = event.key === "ArrowUp"
        ? stops().find(stop => stop > current) ?? limits.max
        : stops().reverse().find(stop => stop < current) ?? limits.min;
      setSize(next);
    } else setSize(height + (event.key === "ArrowUp" ? 20 : -20));
  };

  handle.addEventListener("pointerdown", start);
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  handle.addEventListener("keydown", keydown);

  return {
    toggle() {
      if (drag) return;
      const height = measure();
      if (height >= limits.max) setSize(restoreHeight < limits.max ? restoreHeight : limits.min);
      else {
        restoreHeight = height;
        maximize();
      }
    },
    dispose() {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      handle.removeEventListener("pointerdown", start);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      handle.removeEventListener("lostpointercapture", finish);
      handle.removeEventListener("keydown", keydown);
      stop(false);
    },
  };
}
