"use client";
import { useCallback, useEffect, useState } from "react";
import { resolveOptionsTarget, type OptionsAnalytics } from "@/lib/market/optionsAnalytics";

const CLIENT_TTL_MS = 90_000;
const clientCache = new Map<string, { at: number; data: OptionsAnalytics }>();
const inflight = new Map<string, Promise<OptionsAnalytics>>();

export async function fetchOptionsChain(
  symbol: string,
  expiry = "near",
  force = false,
): Promise<OptionsAnalytics> {
  const target = resolveOptionsTarget(symbol);
  if (!target) {
    throw new Error(
      "Optionsketten ohne API-Key werden für US-Aktien/ETFs/Indizes (z. B. SPY, QQQ, NVDA, AAPL, TSLA) sowie BTC, ETH & SOL unterstützt.",
    );
  }
  const key = `${target.assetClass}:${target.ticker}:${expiry}`;
  const now = Date.now();
  const cached = clientCache.get(key);
  if (!force && cached && now - cached.at < CLIENT_TTL_MS) {
    return cached.data;
  }

  const existing = !force ? inflight.get(key) : undefined;
  if (existing) return existing;

  const qs = new URLSearchParams({ symbol: target.ticker, expiry });
  const promise: Promise<OptionsAnalytics> = (async () => {
    const res = await fetch(`/api/options-chain?${qs}`, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as (OptionsAnalytics & { error?: string }) | { error?: string } | null;
    if (!res.ok || !body || typeof body.error === "string" || !("ticker" in body)) {
      throw new Error(body?.error || "Optionsdaten vorübergehend nicht verfügbar.");
    }
    const analytics: OptionsAnalytics = body;
    clientCache.set(key, { at: Date.now(), data: analytics });
    if (clientCache.size > 60) {
      const oldest = clientCache.keys().next().value;
      if (oldest) clientCache.delete(oldest);
    }
    return analytics;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (inflight.get(key) === promise) inflight.delete(key);
  }
}

export function useOptionsChain(symbol: string, expiry = "near", enabled = true) {
  const target = resolveOptionsTarget(symbol);
  const key = enabled && target ? `${target.assetClass}:${target.ticker}:${expiry}` : "";
  const [state, setState] = useState<{
    key: string;
    data: OptionsAnalytics | null;
    error: string | null;
    loading: boolean;
  }>(() => {
    const cached = key ? clientCache.get(key) : undefined;
    if (cached && Date.now() - cached.at < CLIENT_TTL_MS) {
      return { key, data: cached.data, error: null, loading: false };
    }
    return { key, data: null, error: null, loading: Boolean(key) };
  });

  const load = useCallback(
    async (force = false) => {
      if (!enabled || !target) return;
      const reqKey = `${target.assetClass}:${target.ticker}:${expiry}`;
      setState((prev) => ({
        key: reqKey,
        data: prev.key === reqKey ? prev.data : null,
        error: null,
        loading: true,
      }));
      try {
        const data = await fetchOptionsChain(symbol, expiry, force);
        setState({ key: reqKey, data, error: null, loading: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Optionsdaten nicht verfügbar.";
        setState({ key: reqKey, data: null, error: message, loading: false });
      }
    },
    [enabled, expiry, symbol, target],
  );

  useEffect(() => {
    if (!key) {
      setState({ key: "", data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    const cached = clientCache.get(key);
    if (cached && Date.now() - cached.at < CLIENT_TTL_MS) {
      setState({ key, data: cached.data, error: null, loading: false });
      return;
    }
    setState((prev) => ({
      key,
      data: prev.key === key ? prev.data : null,
      error: null,
      loading: true,
    }));
    fetchOptionsChain(symbol, expiry, false)
      .then((data) => {
        if (!cancelled) setState({ key, data, error: null, loading: false });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            key,
            data: null,
            error: err instanceof Error ? err.message : "Optionsdaten nicht verfügbar.",
            loading: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [expiry, key, symbol]);

  return {
    supported: Boolean(target),
    target,
    data: state.key === key ? state.data : null,
    error: state.key === key ? state.error : null,
    loading: state.key === key ? state.loading : Boolean(key),
    refresh: () => void load(true),
  };
}
