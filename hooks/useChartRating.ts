"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { chartRating, type ChartRatingContext, type ChartRatingView } from "@/lib/ta/chartRating";
import { packRatingCandles, type ChartRatingRequest, type ChartRatingResponse } from "@/lib/ta/chartRatingWire";
import { MIN_RATING_BARS } from "@/lib/ta/rating";
import type { OHLCV } from "@/types/trading";

const REFRESH_MS = 200;

interface RatingScope extends ChartRatingContext {
  market: string;
}

interface Input {
  bars: readonly OHLCV[];
  scope: RatingScope;
}

/** Publish live ratings at most five times per second and keep only the latest queued bars. */
export function useChartRating(bars: readonly OHLCV[], market: string, context: ChartRatingContext) {
  const { replayActive, cursorTime, recovering, error } = context;
  const scope = useMemo<RatingScope>(() => ({
    market, replayActive, cursorTime, recovering, error,
  }), [market, replayActive, cursorTime, recovering, error]);
  const submit = useRef<((input: Input | null) => void) | null>(null);
  const [result, setResult] = useState<{ scope: RatingScope; view: ChartRatingView } | null>(null);
  const emptyView = chartRating([], scope);
  const eligible = bars.length >= MIN_RATING_BARS && emptyView.status === "insufficient";

  useEffect(() => {
    let worker: Worker | null = null;
    let useFallback = typeof Worker === "undefined";
    let active: { id: number; input: Input } | null = null;
    let pending: Input | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let nextStart = 0;
    let sequence = 0;
    let disposed = false;

    function schedule() {
      if (disposed || active || !pending || timer !== undefined) return;
      timer = setTimeout(runLatest, Math.max(0, nextStart - performance.now()));
    }

    function complete(view: ChartRatingView) {
      if (!active || disposed) return;
      const { scope } = active.input;
      active = null;
      setResult({ scope, view });
      schedule();
    }

    function fallBack() {
      if (disposed) return;
      worker?.terminate();
      worker = null;
      useFallback = true;
      pending ??= active?.input ?? null;
      active = null;
      schedule();
    }

    function runLatest() {
      timer = undefined;
      if (!pending || disposed) return;
      const input = pending;
      pending = null;
      active = { id: ++sequence, input };
      nextStart = performance.now() + REFRESH_MS;
      if (useFallback) {
        complete(chartRating(input.bars, input.scope));
        return;
      }
      try {
        if (!worker) {
          worker = new Worker(new URL("../workers/chart-rating.worker.ts", import.meta.url), { name: "Chart technicals" });
          worker.onmessage = ({ data }: MessageEvent<ChartRatingResponse>) => {
            if (data.id === active?.id) complete(data.view);
          };
          worker.onerror = (event) => {
            event.preventDefault();
            fallBack();
          };
          worker.onmessageerror = fallBack;
        }
        const candles = packRatingCandles(input.bars);
        const request: ChartRatingRequest = { id: active.id, candles, context: input.scope };
        worker.postMessage(request, [candles.buffer]);
      } catch {
        fallBack();
      }
    }

    submit.current = (input) => {
      pending = input;
      schedule();
    };
    return () => {
      disposed = true;
      submit.current = null;
      clearTimeout(timer);
      worker?.terminate();
    };
  }, []);

  useEffect(() => {
    submit.current?.(eligible ? { bars, scope } : null);
  }, [bars, eligible, scope]);

  const current = eligible && result?.scope === scope ? result.view : null;
  return { view: current ?? emptyView, calculating: eligible && !current };
}
