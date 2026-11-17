import { loadPriceGridMetadata, priceGridTick, type PriceGridLoader, type PriceGridMetadata } from "@/lib/market/priceGridMetadata";
import { priceStep } from "./math";
export interface FootprintGridState { tick?: number; source: string; pending: boolean; error?: string }
export interface FootprintGridInput { symbol: string; price?: number; simulated: boolean; scope: string; required?: boolean }
/** Each mounted consumer fences late replies; the loader shares network requests. */
export function createFootprintGridSource(changed: () => void, load: PriceGridLoader = loadPriceGridMetadata) {
  let scope = "", generation = 0, active = true, pending = false, at = 0, error = "";
  let metadata: PriceGridMetadata | undefined;
  const reset = () => { generation++; scope = ""; pending = false; at = 0; error = ""; metadata = undefined; active = true; };
  return { reset, dispose() { reset(); active = false; }, read(input: FootprintGridInput): FootprintGridState {
    if (!active) return { source: "Price-grid consumer stopped", pending: false };
    const next = JSON.stringify([input.symbol, input.scope, input.simulated]);
    if (scope !== next) { reset(); scope = next; }
    if (input.required === false) return { source: "Explicit price row overrides", pending: false };
    if (input.simulated) return input.price && input.price > 0 && Number.isFinite(input.price)
      ? { tick: priceStep(input.price), source: "SIMULATED display precision estimate", pending: false }
      : { source: "SIMULATED display precision estimate", pending: false, error: "Waiting for a valid chart price." };
    if (!pending && Date.now() >= at) {
      pending = true; const token = generation, symbol = input.symbol;
      void Promise.resolve().then(() => active && token === generation ? load(symbol) : undefined).then(value => {
        if (!value || !active || token !== generation) return;
        if (value.symbol !== symbol) throw new Error("Price-grid metadata belongs to another market.");
        if (value.tickSize !== undefined) priceGridTick(value);
        else if (!Number.isInteger(value.sizeDecimals) || value.sizeDecimals! < 0 || value.sizeDecimals! > 6) throw new Error("Venue price precision is unavailable.");
        metadata = { ...value }; pending = false; error = ""; at = Date.now() + 300_000; changed();
      }).catch(cause => {
        if (!active || token !== generation) return;
        metadata = undefined; pending = false; at = Date.now() + 30_000;
        error = cause instanceof Error ? cause.message : "Venue price precision is unavailable."; changed();
      });
    }
    if (metadata) {
      try { return { tick: priceGridTick(metadata, input.price), source: metadata.source, pending }; }
      catch (cause) { return { source: metadata.source, pending, error: cause instanceof Error ? cause.message : "Waiting for chart price." }; }
    }
    return { source: "Waiting for venue price-grid metadata", pending, ...(error ? { error } : {}) };
  } };
}
export function footprintGridNotice(grid: FootprintGridState, replay = false): string {
  const status = grid.tick ? `Price tick ${grid.tick} · ${grid.source}` : grid.error ? `Price grid unavailable: ${grid.error} Set an explicit price row override if needed.` : grid.source;
  return status + (replay && grid.tick && !grid.source.startsWith("SIMULATED") ? " · Current venue precision; historical rule changes are not reconstructed" : "");
}
