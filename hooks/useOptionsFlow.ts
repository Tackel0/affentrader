"use client";
import { useEffect, useRef, useState } from "react";
import { alpacaCredentials, useAlpacaStore } from "@/stores/useAlpacaStore";
import { OPTIONS_FLOW_REFRESH_MS, OPTIONS_FLOW_SYMBOL_LIMIT, type OptionsFlowSummary } from "@/lib/market/optionsFlow";

interface Sample {
  key: string;
  result: Record<string, OptionsFlowSummary>;
  unavailable: Record<string, string>;
}
interface CachedFlow {
  sampledAt: number;
  summary?: OptionsFlowSummary;
  reason?: string;
}

export function useOptionsFlow(tickers: readonly string[]) {
  const enabled = useAlpacaStore(state => state.enabled);
  const epoch = useAlpacaStore(state => state.epoch);
  const key = enabled ? [...new Set(tickers)].sort().join(",") : "";
  const sampleKey = `${epoch}|${key}`;
  const [sample, setSample] = useState<Sample | null>(null);
  const cache = useRef<{ epoch: number; values: Map<string, CachedFlow> } | null>(null);
  useEffect(() => {
    if (!key) return;
    if (cache.current?.epoch !== epoch) cache.current = { epoch, values: new Map() };
    const values = cache.current.values, selected = key.split(",");
    let pending: AbortController | null = null;
    const publish = () => {
      const result: Sample = { key: sampleKey, result: {}, unavailable: {} };
      for (const ticker of selected) {
        const flow = values.get(ticker);
        if (flow?.summary) result.result[ticker] = flow.summary;
        if (flow?.reason) result.unavailable[ticker] = flow.reason;
      }
      setSample(result);
    };
    const load = async () => {
      if (document.hidden || pending || useAlpacaStore.getState().epoch !== epoch) return;
      const now = Date.now();
      for (const [ticker, flow] of values) if (now - flow.sampledAt > 2 * OPTIONS_FLOW_REFRESH_MS) values.delete(ticker);
      const missing = selected.filter(ticker => now - (values.get(ticker)?.sampledAt ?? 0) >= OPTIONS_FLOW_REFRESH_MS);
      if (!missing.length) { publish(); return; }
      const controller = new AbortController();
      pending = controller;
      const credentials = alpacaCredentials();
      try {
        for (let offset = 0; offset < missing.length && !controller.signal.aborted; offset += OPTIONS_FLOW_SYMBOL_LIMIT) {
          const batch = missing.slice(offset, offset + OPTIONS_FLOW_SYMBOL_LIMIT);
          let data: Omit<Sample, "key"> | undefined;
          try {
            const response = await fetch("/api/options-flow", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tickers: batch, credentials }), signal: controller.signal,
            });
            if (response.ok) data = await response.json();
          } catch { /* A later refresh can retry this batch. */ }
          if (controller.signal.aborted) return;
          for (const ticker of batch) {
            const summary = data?.result?.[ticker];
            values.set(ticker, { sampledAt: now, summary, reason: summary ? undefined : data?.unavailable?.[ticker] ?? "Optionsflow vorübergehend nicht verfügbar." });
          }
          publish();
        }
      } finally { if (pending === controller) pending = null; }
    };
    const start = setTimeout(load, 200);
    const timer = setInterval(load, OPTIONS_FLOW_REFRESH_MS);
    document.addEventListener("visibilitychange", load);
    return () => { pending?.abort(); clearTimeout(start); clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [epoch, key, sampleKey]);
  return { enabled, sample: sample?.key === sampleKey ? sample : null };
}
