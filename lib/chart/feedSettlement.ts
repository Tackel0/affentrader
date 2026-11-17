import type { MarketConfig, MarketDataFeed } from "@luxalgo/vela";

/** Tracks this chart's own native history/healing requests, without delaying other charts. */
export function trackChartFeed(source: MarketDataFeed) {
  const pending = new Map<Promise<unknown>, string>();
  const key = (cfg: MarketConfig) => JSON.stringify([cfg.symbol, cfg.timeframe]);
  let closed = false;
  let release!: () => void;
  const disposed = new Promise<void>(resolve => { release = resolve; });
  const close = () => { closed = true; pending.clear(); release(); };
  function track<T>(cfg: MarketConfig, work: () => Promise<T>): Promise<T> {
    const request = work();
    if (!closed) {
      pending.set(request, key(cfg));
      const remove = () => { pending.delete(request); };
      // Observe both outcomes without changing the promise returned to Vela.
      void request.then(remove, remove);
    }
    return request;
  }
  const feed: MarketDataFeed = {
    load: cfg => track(cfg, () => source.load(cfg)),
    subscribe: (cfg, onBar) => source.subscribe(cfg, onBar),
    ...(source.loadRange ? { loadRange: (cfg, range) => track(cfg, () => source.loadRange!(cfg, range)) } satisfies Pick<MarketDataFeed, "loadRange"> : {}),
    ...(source.loadProgressive ? { loadProgressive: (cfg, onBatch, opts) => track(cfg, () => source.loadProgressive!(cfg, onBatch, opts)) } satisfies Pick<MarketDataFeed, "loadProgressive"> : {}),
    ...(source.symbolInfo ? { symbolInfo: cfg => source.symbolInfo!(cfg) } satisfies Pick<MarketDataFeed, "symbolInfo"> : {}),
    ...(source.onUnresolved ? { onUnresolved: callback => source.onUnresolved!(callback) } satisfies Pick<MarketDataFeed, "onUnresolved"> : {}),
    destroy: () => { close(); source.destroy?.(); },
  };
  return { feed, close,
    async settled(cfg: MarketConfig): Promise<boolean> {
      // Native await continuations must consume resolved snapshots before navigation reads them.
      await Promise.resolve();
      while (!closed) {
        const requests = [...pending].filter(([, identity]) => identity === key(cfg)).map(([request]) => request);
        if (!requests.length) return true;
        await Promise.race([Promise.allSettled(requests), disposed]);
        await Promise.resolve();
      }
      return false;
    } };
}
