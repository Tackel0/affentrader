"use client";
import { useEffect } from "react";
import { marketService } from "@/lib/market/service";
import { useChartStore } from "@/stores/useChartStore";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { LIQUID_MARKETS_ID } from "@/lib/watchlistPresets";
import { useAlertStore } from "@/stores/useAlertStore";
import { AlertEvaluator } from "@/lib/alerts/engine";
import {
  browserNotify,
  playChime,
  unlockAudio,
} from "@/lib/alerts/notifications";
import { describeSymbol, formatPrice } from "@/lib/symbols";
import { LAYOUTS, useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { compareSymbols } from "@/lib/chart/compare";
import { useAlertRules } from "./useAlertRules";
import { usePaperTrading } from "./usePaperTrading";
import { usePaperStore } from "@/stores/usePaperStore";
import { ruleMarketSubscriptions } from "@/lib/alerts/dependencies";
import { useAlertOwnership } from "./useAlertOwnership";
import { browserAlertOwner, editAlerts } from "@/lib/alerts/browserOwnership";
import { useAlpacaStore } from "@/stores/useAlpacaStore";
import { useTradeRecorder } from "./useTradeRecorder";
import { useReplayDepthCapture } from "./useReplayDepthCapture";
export function useMarketData(options?: { watchQuotesActive?: boolean; phoneMode?: boolean }) {
  useTradeRecorder();
  useReplayDepthCapture();
  const role = useAlertOwnership();
  useAlertRules(role);
  usePaperTrading();
  const paperSymbols = usePaperStore((s) =>
    [
      ...s.live.positions.map((p) => p.symbol),
      ...s.live.orders.filter((o) => o.status === "working").map((o) => o.symbol),
    ].join(","),
  );
  const symbol = useChartStore((s) => s.symbol);
  const mode = useChartStore((s) => s.feedMode);
  const iexEpoch = useAlpacaStore(s => s.epoch);
  const lists = useWatchlistStore((s) => s.lists);
  const activeListId = useWatchlistStore(s => s.activeId);
  const visibleWatchSymbols = useChartStore(s => s.visibleWatchSymbols);
  const alerts = useAlertStore((s) => s.alerts);
  const rules = useAlertStore((s) => s.rules);
  const compares = useChartStore((s) => s.compares);
  const cells = useWorkspaceStore((s) => s.cells),
    layout = useWorkspaceStore((s) => s.layout);
  const visible = cells.slice(0, LAYOUTS.find((l) => l.id === layout)!.count);
  const ruleMarkets = ruleMarketSubscriptions(rules);
  const phoneMode = Boolean(options?.phoneMode);
  const watchQuotesActive = options?.watchQuotesActive ?? true;
  const quotedLists = phoneMode
    ? (watchQuotesActive ? lists.filter(list => list.id === activeListId) : [])
    : lists.filter(list => list.id !== LIQUID_MARKETS_ID || list.id === activeListId);
  const symbolsKey = [
    ...new Set([
      symbol,
      ...visible.map((c) => c.symbol),
      ...alerts.filter((a) => a.status === "active").map((a) => a.symbol),
      ...compares.filter((c) => c.visible).flatMap(compareSymbols),
      ...(paperSymbols ? paperSymbols.split(",") : []),
      ...ruleMarkets.streams,
    ]),
  ]
    .sort()
    .join(",");
  const rawQuoteSymbols = [
    ...new Set([...quotedLists.flatMap((l) => l.symbols).filter((s) => !s.startsWith("###")), ...ruleMarkets.quotes]),
  ];
  const quoteKey = (phoneMode ? rawQuoteSymbols.slice(0, 80) : rawQuoteSymbols)
    .sort()
    .join(",");
  const quotePriority = (phoneMode && !watchQuotesActive
    ? []
    : [...new Set([...visibleWatchSymbols, ...(lists.find(list => list.id === activeListId)?.symbols ?? [])])]
        .filter(symbol => symbol.startsWith("HL:") || symbol.startsWith("IEX:") || symbol.startsWith("BYBIT:") ||
          (activeListId === LIQUID_MARKETS_ID && symbol.startsWith("YF:")))
        .slice(0, phoneMode ? 50 : 150)
  ).join(",");
  useEffect(() => {
    marketService.start(
      symbolsKey.split(","),
      mode,
      quoteKey ? quoteKey.split(",") : [],
      quotePriority ? quotePriority.split(",") : [],
    );
  }, [symbolsKey, quoteKey, quotePriority, mode, iexEpoch]);
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt > 0 && Date.now() - hiddenAt >= 6_000) {
        marketService.resumeFromBackground();
      }
      hiddenAt = 0;
    };
    const onOnline = () => {
      marketService.resumeFromBackground();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      marketService.stop();
    };
  }, []);
  useEffect(() => {
    useChartStore
      .getState()
      .set({
        trades: marketService.tradesFor(symbol),
        candles: [],
        orderBook: null,
      });
  }, [symbol]);
  useEffect(() => {
    if (role.status !== "primary") return;
    let disposed = false;
    const valid = () => !disposed && browserAlertOwner().owns(role.epoch);
    const evaluator = new AlertEvaluator((symbol, timeframe) => marketService.barsFor(symbol, timeframe).at(-1)?.time);
    const evaluate = async (
      symbol: string,
      price: number,
      time: number,
      simulated: boolean,
      frequency: "tick" | "close",
      timeframe?: string,
    ) => {
      if(!valid()||!useAlertStore.getState().alerts.some(alert=>alert.status==="active"&&alert.symbol===symbol))return;
      const firings = await editAlerts(store => {
        const ids = evaluator.evaluate(
        store.alerts,
        symbol,
        price,
        time,
        simulated,
        frequency,
        timeframe,
        Date.now(),
      );
        return ids.flatMap(id => {
        const alert = store.alerts.find((a) => a.id === id)!;
        const log = store.trigger(id, price, time, simulated, evaluator.firedBar(id));
          return log ? [{alert,log}] : [];
        });
      }, valid);
      if (!valid()) return;
      for (const {alert} of firings ?? []) {
        const body = `${symbol} reached ${formatPrice(price)} ${describeSymbol(symbol).quote}${simulated ? " · SIMULATION" : ""}`;
        useChartStore.getState().toast(alert.name, body, "success");
        if (alert.sound) playChime();
        if (alert.browserNotification) browserNotify(alert.name, body);
      }
    };
    const offTick = marketService.onTick((t) =>
      { void evaluate(t.symbol, t.price, t.time, t.simulated, "tick").catch(error => useChartStore.getState().toast("Price alert not saved", String(error), "error")); },
    );
    const offClose = marketService.onClose((symbol, tf, bar, simulated) =>
      { void evaluate(symbol, bar.close, bar.time, simulated, "close", tf).catch(error => useChartStore.getState().toast("Price alert not saved", String(error), "error")); },
    );
    const offIex = marketService.onQuote(q => { if (q.symbol.startsWith("IEX:")) void evaluate(q.symbol, q.price, q.time, q.simulated, "tick").catch(() => useChartStore.getState().toast("Price alert not saved", "The IEX alert could not be saved.", "error")); });
    document.addEventListener("pointerdown", unlockAudio, { once: true });
    return () => {
      disposed = true;
      offTick();
      offClose();
      offIex();
      document.removeEventListener("pointerdown", unlockAudio);
    };
  }, [mode, role.status, role.epoch]);
}


