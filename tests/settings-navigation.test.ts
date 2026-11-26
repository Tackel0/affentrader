import { describe, expect, it, vi } from "vitest";
import { installSettingsRail } from "@/lib/chart/settingsRail";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

class Element extends EventTarget {
  id = ""; title = "Sections"; inert = false; disabled = false; style = { display: "" }; children: Element[] = [];
  attributes = new Map<string, string>(); tokens = new Set<string>();
  classList = { contains: (key: string) => this.tokens.has(key), toggle: (key: string, on: boolean) => { if (on) this.tokens.add(key); else this.tokens.delete(key); } };
  constructor(readonly ownerDocument: { activeElement: Element | null; getElementById(id: string): Element | null }) { super(); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  focus() { this.ownerDocument.activeElement = this; }
  contains(value: unknown): boolean { return value === this || this.children.some(child => child.contains(value)); }
  querySelectorAll() { return this.children; }
}
function setup() {
  const doc = { activeElement: null as Element | null, getElementById: (_id: string): Element | null => null };
  const rail = new Element(doc), pane = new Element(doc), button = new Element(doc), scrim = new Element(doc);
  rail.children = Array.from({ length: 5 }, () => new Element(doc)); rail.children[2].tokens.add("on");
  rail.children[1].style.display = "none"; rail.children[3].disabled = true;
  const toggle = installSettingsRail(rail as unknown as HTMLElement, pane as unknown as HTMLElement, button as unknown as HTMLButtonElement, scrim as unknown as HTMLElement);
  const key = (key: string, ctrlKey = false) => {
    const event = new Event("keydown", { cancelable: true }); Object.defineProperties(event, { key: { value: key }, ctrlKey: { value: ctrlKey } });
    rail.dispatchEvent(event); return event;
  };
  return { doc, rail, pane, button, scrim, toggle, key };
}
describe("native mobile settings navigation", () => {
  it("excludes the closed rail and exposes the pane with a linked collapsed Sections control", () => {
    const h = setup(); expect(h.rail.inert).toBe(true); expect(h.pane.inert).toBe(false);
    expect(h.rail.attributes.get("aria-hidden")).toBe("true"); expect(h.rail.attributes.get("role")).toBe("navigation");
    expect(h.button.attributes.get("aria-expanded")).toBe("false"); expect(h.button.attributes.get("aria-controls")).toBe(h.rail.id);
  });
  it("focuses the current section and returns focus before hiding the rail", () => {
    const h = setup(); h.toggle(true);
    expect(h.doc.activeElement).toBe(h.rail.children[2]); expect(h.pane.inert).toBe(true); expect(h.rail.inert).toBe(false);
    expect(h.pane.attributes.get("aria-hidden")).toBe("true"); expect(h.scrim.tokens.has("open")).toBe(true);
    h.toggle(false); expect(h.doc.activeElement).toBe(h.button); expect(h.rail.inert).toBe(true); expect(h.pane.inert).toBe(false);
    expect(h.button.attributes.get("aria-expanded")).toBe("false");
  });
  it("moves between visible enabled entries and leaves modified/closed navigation keys alone", () => {
    const h = setup(); h.toggle(true);
    expect(h.key("ArrowDown").defaultPrevented).toBe(true); expect(h.doc.activeElement).toBe(h.rail.children[4]);
    h.key("ArrowDown"); expect(h.doc.activeElement).toBe(h.rail.children[0]);
    h.key("End"); expect(h.doc.activeElement).toBe(h.rail.children[4]);
    h.key("Home"); expect(h.doc.activeElement).toBe(h.rail.children[0]);
    h.key("ArrowUp"); expect(h.doc.activeElement).toBe(h.rail.children[4]);
    expect(h.key("ArrowUp", true).defaultPrevented).toBe(false);
    h.toggle(false); expect(h.key("ArrowDown").defaultPrevented).toBe(false);
  });
  it("retains a connected rail identity and does not steal unrelated focus on repeated close", () => {
    const h = setup(), other = new Element(h.doc); h.doc.activeElement = other; h.toggle(false); expect(h.doc.activeElement).toBe(other);
    const connected = new Element(h.doc); h.doc.getElementById = id => id === connected.id ? connected : null;
    installSettingsRail(connected as unknown as HTMLElement, h.pane as unknown as HTMLElement, h.button as unknown as HTMLButtonElement, null);
    expect(connected.id).not.toBe(h.rail.id);
  });
  it("keeps native Escape scoped to the focused settings menu and preserves palette priority", () => {
    const require = createRequire(import.meta.url), dist = path.dirname(require.resolve("@luxalgo/vela")); let tested = 0;
    for (const name of readdirSync(dist).filter(name => /\.(?:js|cjs)$/.test(name) && !name.endsWith(".min.js"))) {
      const source = readFileSync(path.join(dist, name), "utf8"); if (!source.includes("/* Affentrader settings rail Escape */")) continue;
      const callback = source.match(/onEscapeKeyDown: (\(event\) => \{ \/\* Affentrader settings rail Escape \*\/[\s\S]*?\n\s*\}),\n\s*closeOnInteractOutside/)?.[1];
      expect(callback).toBeTruthy(); const click = vi.fn(), preventDefault = vi.fn(); let palette = false, menu = true, focusedSettings = true;
      const settings = { querySelector: (selector: string) => selector.endsWith(".open") ? menu ? {} : null : { click } };
      const doc = { activeElement: { closest: () => focusedSettings ? settings : null } };
      const onEscape = new Function("isPopoverOpen", "document", `return ${callback}`)(() => palette, doc);
      onEscape({ preventDefault }); expect(preventDefault).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce();
      palette = true; onEscape({ preventDefault }); expect(click).toHaveBeenCalledOnce();
      palette = false; menu = false; preventDefault.mockClear(); onEscape({ preventDefault }); expect(preventDefault).not.toHaveBeenCalled();
      menu = true; focusedSettings = false; onEscape({ preventDefault }); expect(preventDefault).not.toHaveBeenCalled(); tested++;
    }
    expect(tested).toBe(6);
  });
  it("installs the helper and current-page semantics exactly once in all five pinned settings bundles", () => {
    const require = createRequire(import.meta.url), dist = path.dirname(require.resolve("@luxalgo/vela")); let tested = 0;
    for (const name of readdirSync(dist).filter(name => /\.(?:js|cjs)$/.test(name) && !name.endsWith(".min.js"))) {
      const source = readFileSync(path.join(dist, name), "utf8"); if (!source.includes("var SettingsDialog = class {")) continue;
      expect(source.split("/* Affentrader settings navigation begin */")).toHaveLength(2);
      expect(source).toContain('p.tab.setAttribute("aria-current", i === idx ? "page" : "false")');
      expect(source.split("this.toggleRail = affentraderSettingsNavigation.installSettingsRail(")).toHaveLength(2); tested++;
    }
    expect(tested).toBe(5);
  });
});
