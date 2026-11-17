import type { HyperliquidAsset } from "@/lib/market/hyperliquid";
import { findIndicator } from "@/lib/indicators/catalog";
import type { IndicatorInstance } from "@/types/trading";
import { providerOf, tickerOf } from "@/lib/symbolId";

export interface EquityOrderflowResolution {
  symbol: string;
  chartType: "footprint" | "candles";
  mappedFrom: string | null;
  liveOrderflow: boolean;
  studies: string[];
  notice?: string;
}

/**
 * Resolves equity or crypto symbols when opening "Footprint & Orderflow":
 * - Crypto/IEX/Hyperliquid venues support direct live trades -> Footprint chart.
 * - Yahoo equities (`YF:TSLA`, `YF:NVDA`, etc.) check Hyperliquid builder-DEX perps (`HL:<dex>:<TICKER>`)
 *   so stocks with live perp L1/trade streams seamlessly render genuine Bid×Ask Footprints.
 * - Equities without a live perp trade feed open in Candles + OHLCV Orderflow Proxy studies
 *   (Volume Nodes HVN/LVN, VPVR, Est. Delta Divergence, Absorption/Exhaustion proxy) instead of breaking.
 */
export function resolveOrderflowTarget(
  symbol: string,
  hlAssets: readonly Pick<HyperliquidAsset, "coin" | "symbol" | "name" | "dex" | "volume">[] = [],
  options: { iexEnabled?: boolean } = {},
): EquityOrderflowResolution {
  const provider = providerOf(symbol);
  if (provider === "binance" || provider === "kraken" || provider === "hyperliquid" || provider === "alpaca") {
    return {
      symbol,
      chartType: "footprint",
      mappedFrom: null,
      liveOrderflow: true,
      studies: ["volume-nodes", "orderflow-signals", "delta-divergence"],
    };
  }

  const cleanTicker = tickerOf(symbol).toUpperCase();
  const rawTicker = cleanTicker.replace(/\.[A-Z]+$/, "");
  const candidates = hlAssets
    .filter((asset) => asset.name.toUpperCase() === rawTicker)
    .sort((a, b) => b.volume - a.volume);

  if (candidates.length > 0) {
    return {
      symbol: candidates[0].symbol,
      chartType: "footprint",
      mappedFrom: symbol,
      liveOrderflow: true,
      studies: ["volume-nodes", "orderflow-signals", "delta-divergence"],
      notice: `Orderflow mapped: ${symbol} -> ${candidates[0].symbol} (Hyperliquid Perp live trades).`,
    };
  }

  if (options.iexEnabled && !cleanTicker.includes(".")) {
    return {
      symbol: `IEX:${cleanTicker}`,
      chartType: "footprint",
      mappedFrom: symbol,
      liveOrderflow: true,
      studies: ["volume-nodes", "orderflow-signals", "delta-divergence"],
      notice: `Orderflow mapped: ${symbol} -> IEX:${cleanTicker} (Alpaca IEX live trades).`,
    };
  }

  return {
    symbol,
    chartType: "candles",
    mappedFrom: null,
    liveOrderflow: false,
    studies: ["volume-nodes", "orderflow-signals", "delta-divergence", "vpvr"],
    notice: `${symbol} has no live HL/IEX tick feed: OHLCV Orderflow Proxy active (HVN/LVN, VPVR, Est. Delta Div & ABS*/EXH*).`,
  };
}

/**
 * Returns missing IndicatorInstance records so HVN/LVN, Absorption/Exhaustion,
 * Delta Divergence, and VPVR (when in proxy mode) render immediately without duplicating studies.
 */
export function buildMissingOrderflowIndicators(
  existing: readonly IndicatorInstance[],
  definitionIds: readonly string[],
): IndicatorInstance[] {
  const palette = ["#38bdf8", "#f59e0b", "#22c55e", "#8e91ff"];
  const added: IndicatorInstance[] = [];
  for (const defId of definitionIds) {
    if (existing.some((i) => i.definitionId === defId)) continue;
    const def = findIndicator(defId);
    if (!def) continue;
    added.push({
      id: `of-${def.id}-${Math.random().toString(36).slice(2, 8)}`,
      definitionId: def.id,
      name: def.shortName,
      visible: true,
      inputs: { ...def.defaults },
      color: palette[(existing.length + added.length) % palette.length],
      lineWidth: 2,
      source: "close",
      script: def.script,
    });
  }
  return added;
}
