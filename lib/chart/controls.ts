/**
 * True when a pointer event landed on one of the chart's own DOM controls
 * (Vela's Auto/Log scale buttons, legend buttons, dialogs) rather than on the
 * canvas, so the price-scale shortcuts must not swallow it.
 */
export function isChartControl(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return (target as Element).closest("button, a, input, select, textarea, [role='button'], [role='dialog']") !== null;
}

/** Leave the native price-axis double-click free to restore autoscale. A single
 * click opens the alert only once the double-click window has elapsed. */
export function priceScaleGesture(delayMs = 500) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  return { cancel, handle(event: Pick<MouseEvent, "type" | "detail" | "button" | "shiftKey">, action: () => void) {
    cancel();
    if (event.type === "dblclick" || event.detail > 1) return;
    if (event.type === "contextmenu" || event.shiftKey) { action(); return; }
    if (event.button !== 0) return;
    timer = setTimeout(() => { timer = undefined; action(); }, delayMs);
  } };
}
