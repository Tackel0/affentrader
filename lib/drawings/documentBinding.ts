import type { Vela } from "@luxalgo/vela";

/** Vela 0.9 restores undo/redo snapshots via drawing:selected, without emitting
 * created/edited/removed. Persist the actual document on that event too, while
 * ordinary selection changes must not churn versions or workspace storage. */
export function bindDrawingDocuments(chart: Pick<Vela, "on" | "drawings">, host: {
  read(): unknown;
  write(document: ReturnType<Vela["drawings"]["toJSON"]>): void;
  selected(ids: string[]): void;
  enabled(): boolean;
}) {
  const publish = () => {
    if (!host.enabled()) return;
    const document = chart.drawings.toJSON();
    if (JSON.stringify(host.read()) !== JSON.stringify(document)) host.write(document);
  };
  const off = (["drawing:created", "drawing:edited", "drawing:removed"] as const).map(event => chart.on(event, publish));
  off.push(chart.on("drawing:selected", event => { host.selected(event.ids); publish(); }));
  return () => off.forEach(dispose => dispose());
}
