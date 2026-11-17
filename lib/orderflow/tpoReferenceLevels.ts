import type { TpoSession } from "./tpoModel";
import { executionPriceGrid } from "./priceGrid";

export interface TpoReferenceLevels { sessionStart: number; from: number; poc: number; vah: number; val: number }
/** Frozen mathematical levels of a fully covered, revealed completed session. */
export function tpoReferenceLevels(session: TpoSession): TpoReferenceLevels | null {
  if (session.completion.status !== "complete") return null;
  const { rows, valueArea } = session;
  const grid = executionPriceGrid(session.step);
  const level = (index: number) => rows[index].grid ?? grid.row(grid.index(rows[index].price));
  return { sessionStart: session.start, from: session.end, poc: level(valueArea.poc).center,
    vah: level(valueArea.high).upper, val: level(valueArea.low).lower };
}
