import variant from "@jitl/quickjs-singlefile-browser-release-sync";
import { newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSWASMModule, type QuickJSHandle, type QuickJSDeferredPromise } from "quickjs-emscripten-core";
import runtimeSource from "@/.generated/pine-alert-code";
import { PINE_GUEST } from "./pineGuest";
import type { PineAlertSnapshot, PineAlertResult, PineFrame, PineSeriesLoader, PineSeries } from "@/types/pineAlerts";
import { nextBucket, isTickInterval } from "@/lib/market/intervals";
import { strategyTimeframe, strategyRuntimeTimeframe } from "@/lib/strategy/data";
import { normalizeSymbol } from "@/lib/watchlist";
import { validatePineSnapshot, validatePineInputs, isPineOrderFill } from "./pineValidation";

let modulePromise: Promise<QuickJSWASMModule> | undefined;
const encode = (series: PineSeries, closedBar?: number) => ({ ...series, timeframe: strategyRuntimeTimeframe(series.timeframe), bars: series.bars.filter(b => closedBar === undefined || b.time <= closedBar).map(b => ({ ...b, end: nextBucket(series.timeframe, b.time) })) });
/** A separate interpreter per subscription: no Node, DOM, fetch, storage or host object references. */
export class PineSandbox {
  private vm?: QuickJSContext;
  private pending = new Set<Promise<void>>();
  private deferred = new Set<QuickJSDeferredPromise>();
  private deadline = 0;
  private requests = 0;
  private secondaryErrors: string[] = [];
  private initialized = false;
  private loader?: PineSeriesLoader;
  private snapshot: PineAlertSnapshot;
  constructor(snapshot: PineAlertSnapshot, private readonly budgetMs = 5000, private readonly seed = 0x7f4a7c15) { this.snapshot = structuredClone(snapshot); }
  private eval(code: string): QuickJSHandle { return this.vm!.unwrapResult(this.vm!.evalCode(code)); }
  private async create() {
    const error = validatePineSnapshot(this.snapshot); if (error) throw new Error(error);
    modulePromise ??= newQuickJSWASMModuleFromVariant(variant);
    this.vm = (await modulePromise).newContext();
    const vm = this.vm;
    vm.runtime.setMemoryLimit(128 * 1024 * 1024); vm.runtime.setMaxStackSize(1024 * 1024);
    vm.runtime.setInterruptHandler(() => Date.now() > this.deadline);
    const intl = vm.newFunction("intl", handle => {
      const value = JSON.parse(vm.getString(handle));
      const formatter = new Intl.DateTimeFormat(value.locale, value.options);
      return vm.newString(JSON.stringify(value.method === "parts" ? formatter.formatToParts(value.value) : value.method === "options" ? formatter.resolvedOptions() : formatter.format(value.value)));
    });
    vm.setProp(vm.global, "__intl", intl); intl.dispose();
    const series = vm.newFunction("series", handle => {
      const input = JSON.parse(vm.getString(handle)) as { symbol: string; timeframe: string; count: number };
      const symbol = normalizeSymbol(input.symbol.replace(/^BINANCE:/, ""));
      const timeframe = strategyTimeframe(input.timeframe);
      if (!symbol || !Number.isInteger(input.count) || input.count < 1 || input.count > 20_000 || ++this.requests > 40) throw new Error("Invalid or excessive secondary data requests.");
      if (!this.loader) throw new Error(`Secondary data unavailable: ${symbol} ${timeframe}.`);
      const promise = vm.newPromise(); this.deferred.add(promise);
      const task = this.loader(symbol, timeframe, input.count).then(data => {
        if (!vm.alive) return;
        const result = vm.newString(JSON.stringify(encode(data))); promise.resolve(result); result.dispose();
      }).catch(error => {
        if (!vm.alive) return;
        this.secondaryErrors.push(error instanceof Error ? error.message : String(error));
        const result = vm.newError(error instanceof Error ? error.message : String(error)); promise.reject(result); result.dispose();
      }).finally(() => { this.pending.delete(task); if (vm.alive) { promise.dispose(); this.deferred.delete(promise); } });
      this.pending.add(task); return promise.handle;
    });
    vm.setProp(vm.global, "__series", series); series.dispose();
    this.eval(`globalThis.console={log(){},warn(){},error(){},debug(){}};let __randomState=${this.seed >>> 0};Math.random=()=>{__randomState=(__randomState+0x6d2b79f5)|0;let t=__randomState;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};globalThis.Date=class extends Date{constructor(...args){super(...(args.length?args:[0]));}static now(){return 0;}};`).dispose();
    this.eval(runtimeSource).dispose(); this.eval(PINE_GUEST).dispose();
  }
  async run(frame: PineFrame, loader?: PineSeriesLoader): Promise<PineAlertResult> {
    if (isTickInterval(frame.series.timeframe)) throw new Error("Pine subscriptions currently require a time-based candle interval.");
    if (!frame.series.bars.length) throw new Error("No candles available for the Pine alert.");
    this.deadline = Date.now() + this.budgetMs; this.loader = loader; this.requests = 0; this.secondaryErrors = [];
    let promise: QuickJSHandle | undefined;
    try {
      if (!this.vm) await this.create();
      const data = { ...frame, series: encode(frame.series, frame.closedBar) };
      if (!data.series.bars.length) throw new Error("No confirmed candle available.");
      promise = this.eval(`__pine.${this.initialized ? "update" : "initialize"}(${this.initialized ? "" : JSON.stringify(this.snapshot) + ","}${JSON.stringify(data)})`);
      const vm = this.vm!;
      for (;;) {
        if (Date.now() > this.deadline) throw new Error("Pine alert exceeded its execution deadline.");
        const jobs = vm.runtime.executePendingJobs(1000);
        if (jobs.error) { const error = vm.dump(jobs.error); jobs.error.dispose(); throw new Error(error.message ?? "Pine job failed."); }
        const state = vm.getPromiseState(promise);
        if (state.type === "fulfilled") {
          const text = vm.getString(state.value); state.value.dispose(); this.initialized = true;
          if (text.length > 500_000) throw new Error("Pine alert output is too large.");
          const result = JSON.parse(text) as PineAlertResult;
          if (result.signals.some(signal => signal.type === "order_fill" && !isPineOrderFill(signal.fill))) throw new Error("Invalid or excessive strategy fill metadata.");
          if (this.secondaryErrors.length) throw new Error(`Secondary Pine data unavailable: ${this.secondaryErrors.join("; ")}`);
          const invalid = validatePineInputs(this.snapshot, result.inspection); if (invalid) throw new Error(invalid);
          return result;
        }
        if (state.type === "rejected") { const error = vm.dump(state.error); state.error.dispose(); throw new Error(error.message ?? "Pine execution failed."); }
        if (this.pending.size) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try { await Promise.race([...this.pending, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Pine secondary data deadline exceeded.")), Math.max(1, this.deadline - Date.now())); })]); }
          finally { if (timer) clearTimeout(timer); }
        } else if (!vm.runtime.hasPendingJob()) throw new Error("Pine script left an unresolved promise.");
      }
    } catch (error) { promise?.dispose(); promise = undefined; this.dispose(); throw error; }
    finally { promise?.dispose(); }
  }
  dispose() {
    if (this.vm?.alive) { for (const promise of this.deferred) promise.dispose(); this.deferred.clear(); this.vm.dispose(); }
    this.vm = undefined; this.initialized = false;
  }
}
