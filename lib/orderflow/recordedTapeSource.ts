import { captureRecordedTimeSales } from "./timeSales";
import type { ReplayStudyInput } from "./studyTradeSource";

export interface RecordedTapeContext {
  symbol: string; timeframe: string; replay: boolean; simulated: boolean; source?: string;
  ready: boolean; through: number | null; revision: number;
}
/** The adapter asks only the archive prefix port, never the live market service. */
export function recordedTapeSource(context: RecordedTapeContext, archive: { replay(symbol: string, through: number | null): ReplayStudyInput | undefined; revision(symbol: string): number }, capturedAt = Date.now()) {
  if (!context.replay || context.simulated || context.source !== "exchange" || !context.ready || context.through === null)
    return { value: null, error: "Recorded tape is waiting for a matching exchange chart and its completed Replay boundary." };
  try {
    if (archive.revision(context.symbol) !== context.revision) return { value: null, error: "The archive selection changed. Wait for its current recorded tape." };
    const input = archive.replay(context.symbol, context.through);
    if (!input || input.through !== context.through) return { value: null, error: "Load an observed archive selection for this market. Live trades are never used as a Replay fallback." };
    return { value: captureRecordedTimeSales(input, context.symbol, capturedAt), error: "" };
  } catch (error) { return { value: null, error: error instanceof Error ? error.message : "Recorded tape unavailable." }; }
}
