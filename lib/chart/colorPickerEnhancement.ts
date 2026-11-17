export interface PickerColor { hex: string; alpha: number }

/** An explicit opaque selection must not be confused with a legacy six-digit
 * theme-default marker. Eight-digit CSS retains identical pixels and intent. */
export function explicitPickerColor(value: string): string {
  return /^#[\da-f]{6}$/i.test(value) ? `${value}ff` : value;
}

export function parsePickerHex(value: string, alpha: number): PickerColor | null {
  let hex = value.trim().replace(/^#/, "").toLowerCase();
  if (!/^(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/.test(hex)) return null;
  if (hex.length <= 4) hex = [...hex].map(c => c + c).join("");
  return { hex: `#${hex.slice(0, 6)}`, alpha: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : alpha };
}

export function paletteDestination(index: number, key: string, count: number, control = false): number {
  const last = count - 1;
  const destinations: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1,
    ArrowUp: index - 10, ArrowDown: index + 10,
    Home: control ? 0 : Math.floor(index / 10) * 10,
    End: control ? last : Math.floor(index / 10) * 10 + 9 };
  return key in destinations ? Math.max(0, Math.min(last, destinations[key])) : index;
}

interface PickerOptions {
  swatches: HTMLButtonElement[];
  recentSwatches: HTMLElement;
  recentColors: () => string[];
  track: HTMLElement;
  pctBox: HTMLInputElement;
  customInput: HTMLInputElement;
  read: () => PickerColor;
  commit: (color: PickerColor) => void;
}

/** Adds keyboard and exact-color controls to the pinned native picker without replacing its painting. */
export function installColorPickerFields(root: HTMLElement, options: PickerOptions) {
  const doc = root.ownerDocument;
  const row = doc.createElement("div");
  row.style.cssText = "display:flex;gap:6px;align-items:center;";
  const input = doc.createElement("input");
  input.type = "text";
  input.setAttribute("aria-label", "Hex color");
  input.placeholder = "#RRGGBB";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.style.cssText = "min-width:0;flex:1;width:130px;background:var(--vela-bg);color:var(--vela-fg);border:1px solid var(--vela-border);border-radius:5px;padding:6px;font:inherit;";
  const apply = doc.createElement("button");
  apply.type = "button";
  apply.textContent = "Apply";
  apply.setAttribute("aria-label", "Apply hex color");
  apply.style.cssText = "background:var(--vela-bg);color:var(--vela-fg);border:1px solid var(--vela-border);border-radius:5px;padding:6px;cursor:pointer;font:inherit;";
  const status = doc.createElement("div");
  status.setAttribute("role", "status");
  status.style.cssText = "font-size:11px;color:var(--vela-fg-muted);";
  status.hidden = true;
  row.append(input, apply);
  root.append(row, status);
  let dirty = false;
  const sync = () => {
    const current = options.read();
    if (doc.activeElement !== input || !dirty) {
      input.value = current.hex + (current.alpha < .999 ? Math.round(current.alpha * 255).toString(16).padStart(2, "0") : "");
      input.removeAttribute("aria-invalid");
      status.hidden = true;
    }
    const selected = options.swatches.findIndex(sw => sw.dataset.c?.toLowerCase() === current.hex.toLowerCase());
    options.swatches.forEach((sw, index) => {
      sw.setAttribute("aria-label", `Color ${sw.dataset.c}`);
      sw.setAttribute("aria-pressed", String(index === selected));
      sw.tabIndex = index === Math.max(0, selected) ? 0 : -1;
    });
    [...options.recentSwatches.children].forEach((sw, index) => {
      const color = options.recentColors()[index];
      sw.setAttribute("aria-label", `Recent color ${color}`);
      sw.setAttribute("aria-pressed", String(color?.toLowerCase() === current.hex.toLowerCase()));
    });
    options.track.setAttribute("aria-valuenow", String(Math.round(current.alpha * 100)));
  };
  const commit = () => {
    if (!dirty) return;
    const current = options.read(), next = parsePickerHex(input.value, current.alpha);
    if (!next) {
      input.setAttribute("aria-invalid", "true");
      status.textContent = "Use 3, 4, 6 or 8 hexadecimal digits.";
      status.hidden = false;
      return;
    }
    dirty = false;
    options.commit(next);
    sync();
  };
  input.addEventListener("input", () => { dirty = true; });
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") { dirty = false; return; }
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commit(); }
  });
  apply.addEventListener("click", e => { e.stopPropagation(); commit(); });
  options.swatches.forEach((sw, index) => sw.addEventListener("keydown", e => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    options.swatches[paletteDestination(index, e.key, options.swatches.length, e.ctrlKey || e.metaKey)]?.focus();
  }));
  options.customInput.setAttribute("aria-label", "More colors");
  options.pctBox.setAttribute("aria-label", "Opacity percent");
  options.track.setAttribute("role", "slider");
  options.track.setAttribute("aria-label", "Color opacity");
  options.track.setAttribute("aria-valuemin", "0");
  options.track.setAttribute("aria-valuemax", "100");
  options.track.tabIndex = 0;
  options.track.addEventListener("keydown", e => {
    const current = options.read(), percent = Math.round(current.alpha * 100);
    const values: Record<string, number> = { ArrowLeft: percent - 1, ArrowDown: percent - 1,
      ArrowRight: percent + 1, ArrowUp: percent + 1, PageDown: percent - 10, PageUp: percent + 10, Home: 0, End: 100 };
    if (!(e.key in values)) return;
    e.preventDefault(); e.stopPropagation();
    const alpha = Math.max(0, Math.min(100, values[e.key])) / 100;
    if (alpha !== current.alpha) options.commit({ ...current, alpha });
    sync();
  });
  sync();
  return { sync };
}
