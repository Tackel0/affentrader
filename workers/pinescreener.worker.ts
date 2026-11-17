import { runPineOnBars, type PineValues } from "@/lib/screener/pine";
import type { OHLCV } from "@/types/trading";

export interface PineScreenRequest {
  id: string;
  symbol: string;
  timeframe: string;
  source: string;
  libraries: Record<string, string>;
  bars: OHLCV[];
}
export interface PineScreenResponse {
  id: string;
  symbol: string;
  values: PineValues;
  error?: string;
}

const scope = self as unknown as {
  postMessage: (message: PineScreenResponse) => void;
  onmessage: ((event: MessageEvent<PineScreenRequest>) => void) | null;
};

scope.onmessage = async ({ data }) => {
  try {
    const values = await runPineOnBars(data.source, data.bars, data.timeframe, data.libraries);
    scope.postMessage({ id: data.id, symbol: data.symbol, values });
  } catch (error) {
    scope.postMessage({
      id: data.id,
      symbol: data.symbol,
      values: {},
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
