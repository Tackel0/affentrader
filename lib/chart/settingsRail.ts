let railSequence = 0;

/** Keep off-screen navigation out of focus and accessibility traversal. The native
 * settings dialog rebuilds these nodes on reset/resize, so listeners stay on the
 * rail itself and are collected with that build rather than accumulating on root. */
export function installSettingsRail(rail: HTMLElement, pane: HTMLElement, button: HTMLButtonElement, scrim: HTMLElement | null) {
  const doc = rail.ownerDocument;
  if (!rail.id) { do { rail.id = `vela-settings-rail-${++railSequence}`; } while (doc.getElementById(rail.id) && doc.getElementById(rail.id) !== rail); }
  rail.setAttribute("role", "navigation"); rail.setAttribute("aria-label", button.title || "Sections");
  button.setAttribute("aria-controls", rail.id);
  const buttons = () => [...rail.querySelectorAll<HTMLButtonElement>("button.vela-sd-tab")].filter(item => item.style.display !== "none" && !item.disabled);
  const toggle = (open?: boolean) => {
    const on = open ?? !rail.classList.contains("open");
    if (!on && rail.contains(doc.activeElement)) button.focus({ preventScroll: true });
    rail.classList.toggle("open", on); scrim?.classList.toggle("open", on);
    rail.inert = !on; rail.setAttribute("aria-hidden", String(!on));
    if (on) { const options = buttons(); (options.find(item => item.classList.contains("on")) ?? options[0])?.focus({ preventScroll: true }); }
    pane.inert = on; pane.setAttribute("aria-hidden", String(on));
    button.setAttribute("aria-expanded", String(on));
  };
  rail.addEventListener("keydown", event => {
    if (!rail.classList.contains("open") || event.altKey || event.ctrlKey || event.metaKey) return;
    const options = buttons(), current = options.indexOf(doc.activeElement as HTMLButtonElement);
    if (current < 0 || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 :
      (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[next]?.focus({ preventScroll: true });
  });
  toggle(false); return toggle;
}
