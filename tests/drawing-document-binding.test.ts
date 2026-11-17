import { expect, it, vi } from "vitest";
import type { Vela } from "@luxalgo/vela";
import { bindDrawingDocuments } from "@/lib/drawings/documentBinding";

function harness() {
  let current = { version: 1, drawings: [{ id: "one" }, { id: "two" }] }, saved = structuredClone(current), enabled = true;
  const listeners = new Map<string, (event: { ids: string[] }) => void>();
  const chart = { drawings: { toJSON: () => structuredClone(current) }, on: (event: string, listener: (event: { ids: string[] }) => void) => {
    listeners.set(event, listener); return () => { listeners.delete(event); };
  } } as unknown as Pick<Vela, "on" | "drawings">;
  const write = vi.fn(document => { saved = structuredClone(document); }), selected = vi.fn();
  const off = bindDrawingDocuments(chart, { read: () => saved, write, selected, enabled: () => enabled });
  return { write, selected, off, saved: () => saved, listeners, enable: (value: boolean) => { enabled = value; },
    emit: (name: string, ids: string[] = []) => listeners.get(name)?.({ ids }), snapshot: (ids: string[]) => { current = { version: 1, drawings: ids.map(id => ({ id })) }; } };
}
it("persists undo/redo snapshots announced only as a selection event", () => {
  const h = harness(); h.snapshot(["one"]); h.emit("drawing:selected");
  expect(h.saved().drawings.map(d => d.id)).toEqual(["one"]); expect(h.write).toHaveBeenCalledTimes(1);
  h.snapshot(["one", "two"]); h.emit("drawing:selected", ["two"]);
  expect(h.saved().drawings.map(d => d.id)).toEqual(["one", "two"]); expect(h.write).toHaveBeenCalledTimes(2); h.off();
});
it("does not rewrite an unchanged document when selecting or after duplicate mutation notifications", () => {
  const h = harness(); h.emit("drawing:selected", ["one"]); expect(h.write).not.toHaveBeenCalled(); expect(h.selected).toHaveBeenCalledWith(["one"]);
  h.snapshot(["one"]); h.emit("drawing:removed"); h.emit("drawing:selected"); expect(h.write).toHaveBeenCalledTimes(1); h.off();
});
it("fences restore-time publication and detaches every listener", () => {
  const h = harness(); h.enable(false); h.snapshot([]); h.emit("drawing:edited"); h.emit("drawing:selected"); expect(h.write).not.toHaveBeenCalled();
  h.enable(true); h.emit("drawing:created"); expect(h.write).toHaveBeenCalledTimes(1); h.off(); expect(h.listeners.size).toBe(0);
});
