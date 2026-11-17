// SPDX-License-Identifier: AGPL-3.0-only
// Local extension of LuxAlgo PineTS 0.13.0. The original broker remains authoritative.
export function patchMagnifier(sources) {
  const corePath = "PineTS.class.ts", utilsPath = "namespaces/strategy/utils.ts";
  let core = sources.get(corePath), utils = sources.get(utilsPath);
  if (!core || !utils) throw new Error("PineTS strategy sources are missing from the distribution source map.");
  const replace = (source, before, after, count = 1) => {
    const hits = source.split(before).length - 1;
    if (hits !== count) throw new Error(`PineTS patch drift: expected ${count} matches, found ${hits}: ${before.slice(0, 85)}`);
    return source.replaceAll(before, after);
  };
  core = replace(core, "    private _alertMode:", `    private _strategyIntrabarPaths = new Map<number, { prices: number[]; gaps: number[] }>();
    public setStrategyIntrabarPaths(paths: Map<number, { prices: number[]; gaps: number[] }>): void {
        this._strategyIntrabarPaths = paths;
    }

    private _alertMode:`);
  core = replace(core, "            context.idx = i;", "            context.idx = i;\n            (context as any)._magnifierPath = this._strategyIntrabarPaths.get(this.openTime[i]);");
  core = replace(core,
    "if (context.strategy.config?.calc_on_order_fills) await this._processBarWithOrderFills(context, transpiledFn, rawBar);",
    "if (context.strategy.config?.calc_on_order_fills || (context.strategy.config?.use_bar_magnifier && (context as any)._magnifierPath)) await this._processBarWithOrderFills(context, transpiledFn, rawBar);");
  const methodStart = "    private async _processBarWithOrderFills(context: Context, transpiledFn: Function, rawBar: OHLC | null): Promise<void> {";
  core = replace(core, methodStart, methodStart + `
        if (context.strategy?.config?.use_bar_magnifier && (context as any)._magnifierPath) {
            await this._processMagnifiedBar(context, transpiledFn, rawBar);
            return;
        }`);
  core = replace(core, "    private _snapBarForBroker(context: Context): OHLC | null {", String.raw`
    private async _processMagnifiedBar(context: Context, transpiledFn: Function, rawBar: OHLC | null): Promise<void> {
        const strategy: any = context.strategy;
        const d: any = context.data;
        const last = d.close.data.length - 1;
        const full = { open: d.open.data[last], high: d.high.data[last], low: d.low.data[last], close: d.close.data[last] };
        const scriptBar = rawBar ?? full;
        const originalRaw = (context as any)._rawBar;
        const record = (context as any)._magnifierPath as { prices: number[]; gaps: number[] };
        const path = (context as any)._exc.path as number[];
        const gaps = new Set(record.gaps);
        let snapshot: any = null;
        const setBar = (b: OHLC) => this._setBar(context, b);
        try {
            for (let k = 0; k < path.length; k++) {
                const gap = gaps.has(k);
                const from = k === 0 || gap ? path[k] : path[k - 1], to = path[k];
                setBar({ open: from, high: Math.max(from, to), low: Math.min(from, to), close: to });
                const rawFrom = k === 0 || gap ? record.prices[k] : record.prices[k - 1], rawTo = record.prices[k];
                (context as any)._rawBar = { open: rawFrom, high: Math.max(rawFrom, rawTo), low: Math.min(rawFrom, rawTo), close: rawTo };
                (context as any)._excSeg = k === 0 || gap ? { offset: k, scale: 0 } : { offset: k - 1, scale: 1 / 3 };
                const fills = strategy._fillCount ?? 0;
                processBarOrders(context);
                (context as any)._excSeg = undefined;
                for (const trade of strategy.opentrades) if (trade._intrabarEntry?.bar === context.idx) trade._intrabarEntry = undefined;
                if (!strategy.config.calc_on_order_fills || k === path.length - 1 || (strategy._fillCount ?? 0) === fills) continue;
                setBar(scriptBar);
                (context as any)._rawBar = originalRaw;
                if (!snapshot) { snapshot = this._snapshotVarState(context); snapshot.strategy = null; }
                const plotLengths = new Map<string, number>(Object.entries(context.plots ?? {}).map(([key, p]: [string, any]) => [key, p?.data?.length ?? 0]));
                const pending = new Set(strategy.pending_orders);
                context._execTick = (context._execTick || 0) + 1;
                (context as any)._fillPointPrice = to;
                await transpiledFn(context);
                (context as any)._fillPointPrice = undefined;
                for (const order of strategy.pending_orders) if (!pending.has(order) && order.bar === context.idx) order.bar = context.idx - 1;
                for (const key of Object.keys(context.plots ?? {})) {
                    const length = plotLengths.get(key);
                    if (length === undefined) delete context.plots[key];
                    else if (context.plots[key]?.data?.length > length) context.plots[key].data.length = length;
                }
                context.rollbackDrawings(context.idx);
                this._restoreVarState(context, snapshot);
            }
        } finally {
            setBar(full);
            (context as any)._rawBar = originalRaw;
            (context as any)._excSeg = undefined;
            (context as any)._fillPointPrice = undefined;
        }
        if (snapshot) context._execTick = (context._execTick || 0) + 1;
    }

    private _snapBarForBroker(context: Context): OHLC | null {`);

  const begin = "    const path = barPath(\n        Series.from(context.data.open).get(0),\n        Series.from(context.data.high).get(0),\n        Series.from(context.data.low).get(0),\n        Series.from(context.data.close).get(0),\n    );";
  utils = replace(utils, begin, `    const custom = context.strategy?.config?.use_bar_magnifier && context._magnifierPath;
    const path = custom ? custom.prices.map((price: number) => brokerPrice(context, price)) : barPath(
        Series.from(context.data.open).get(0), Series.from(context.data.high).get(0),
        Series.from(context.data.low).get(0), Series.from(context.data.close).get(0),
    );`);
  utils += `\n/** Local segment coordinates stay 0..3; the complete intrabar path can have many vertices. */
function strategyPathEnd(context: any): number {
    return context._excSeg ? 3 : Math.max(3, (context._exc?.path?.length ?? 4) - 1);
}\n`;
  utils = replace(utils, "(context._pathAt ?? 0) < 3", "(context._pathAt ?? 0) < Math.max(3, (context._exc?.path?.length ?? 4) - 1)");
  utils = replace(utils, "setFillAt(context, 3);", "setFillAt(context, strategyPathEnd(context));", 2);
  utils = replace(utils, "(at === 0 || at === 3)", "(at === 0 || at === (path?.length ?? 4) - 1)");
  utils = replace(utils, "let x = context._pathAt ?? 3;", "let x = context._pathAt ?? strategyPathEnd(context);");
  utils = replace(utils, "t._obsFrom ?? -0.5, 3, true", "t._obsFrom ?? -0.5, strategyPathEnd(context), true");
  utils = replace(utils, "r._obsFrom ?? -0.5, 3, true", "r._obsFrom ?? -0.5, strategyPathEnd(context), true");
  utils = replace(utils, "t._obsFrom = 3;", "t._obsFrom = strategyPathEnd(context);");
  utils = replace(utils, "r._obsFrom = 3;", "r._obsFrom = strategyPathEnd(context);");
  utils = replace(utils, "order.immediately ? 3 : 0", "order.immediately ? strategyPathEnd(context) : 0");
  utils = replace(utils, "checkpoint === 'close' ? 3 :", "checkpoint === 'close' ? strategyPathEnd(context) :");
  utils = replace(utils, "seg && seg.scale > 0 ?", "seg && (seg.scale > 0 || seg.offset > 0) ?");
  sources.set(corePath, core);
  sources.set(utilsPath, utils);
  return sources;
}
