import {
  PineTS,
  Indicator,
  FunctionImportResolver,
} from "@/.generated/strategy-runtime";
import {
  type IProvider,
  type ISymbolInfo,
  type Kline,
  type Context,
} from "pinets";
import { nextBucket } from "@/lib/market/intervals";
import { providerOf, tickerOf } from "@/lib/symbolId";
import type {
  StrategyDataset,
  StrategyMarket,
  StrategyRunRequest,
} from "@/types/strategy";
import { buildStrategyReport, instrumentStrategy } from "./report";
import { parseStrategyDocument } from "./settings";
import { magnifierInterval, prepareMagnifier } from "./magnifier";
import {
  strategyTimeframe,
  strategyRuntimeTimeframe,
  strategyCurrency,
} from "./data";

/** Public Indicator hook accepts the provider's currency string, including USDC and GBp. */
class MarketStrategy extends Indicator {
  constructor(
    source: string,
    inputs: Record<string, unknown>,
    private readonly currency: string,
  ) {
    super(source, inputs);
  }
  override getRuntimePropOverrides(): Record<string, unknown> {
    return { ...super.getRuntimePropOverrides(), currency: this.currency };
  }
}

const resolver = (libraries: Record<string, string>) =>
  new FunctionImportResolver((path) => libraries[path] ?? null);
export async function inspectStrategy(
  source: string,
  libraries: Record<string, string>,
) {
  const script = new Indicator(source);
  await script.resolveImports(resolver(libraries));
  if (script.getDeclarationType() !== "strategy")
    throw new Error(
      "Use a Pine strategy() script. Indicator scripts belong in the Pine editor.",
    );
  script.prepare();
  return {
    inputs: script.getInputsMeta(),
    title: String(
      script.getPropsMeta().find((p) => p.name === "title")?.defval ??
        "Strategy",
    ),
  };
}
export function strategySymbolInfo(market: StrategyMarket): ISymbolInfo {
  return {
    current_contract: "",
    description: market.symbol,
    isin: "",
    main_tickerid:
      providerOf(market.symbol) === "binance"
        ? `BINANCE:${market.symbol}`
        : market.symbol,
    prefix: (market.provider ?? providerOf(market.symbol)).toUpperCase(),
    root: market.base,
    ticker: tickerOf(market.symbol),
    tickerid:
      providerOf(market.symbol) === "binance"
        ? `BINANCE:${market.symbol}`
        : market.symbol,
    type: market.type ?? "crypto",
    basecurrency: market.base,
    country: "",
    currency: strategyCurrency(market),
    timezone: market.timezone ?? "Etc/UTC",
    employees: NaN,
    industry: "",
    sector: "",
    shareholders: NaN,
    shares_outstanding_float: NaN,
    shares_outstanding_total: NaN,
    expiration_date: NaN,
    session: market.provider === "yahoo" || market.provider === "alpaca" ? "regular" : "24x7",
    volumetype: "base",
    mincontract: market.quantityStep,
    minmove: 1,
    mintick: market.tickSize,
    pointvalue: market.pointValue ?? 1,
    pricescale: Math.round(1 / market.tickSize),
    recommendations_buy: NaN,
    recommendations_buy_strong: NaN,
    recommendations_date: NaN,
    recommendations_hold: NaN,
    recommendations_sell: NaN,
    recommendations_sell_strong: NaN,
    recommendations_total: NaN,
    target_price_average: NaN,
    target_price_date: NaN,
    target_price_estimates: NaN,
    target_price_high: NaN,
    target_price_low: NaN,
    target_price_median: NaN,
  };
}
const toKlines = (dataset: StrategyDataset): Kline[] =>
  dataset.bars.map((b) => ({
    openTime: b.time,
    closeTime: nextBucket(dataset.market.timeframe, b.time),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
    quoteAssetVolume: NaN,
    numberOfTrades: NaN,
    takerBuyBaseAssetVolume: NaN,
    takerBuyQuoteAssetVolume: NaN,
    ignore: 0,
  }));
export type FetchStrategySeries = (
  symbol: string,
  timeframe: string,
  limit: number,
  from?: number,
  to?: number,
) => Promise<StrategyDataset>;
export async function executeStrategy(
  request: StrategyRunRequest,
  progress: (completed: number, total: number) => void = () => {},
  fetchSeries?: FetchStrategySeries,
) {
  const startedAt = Date.now();
  const document = parseStrategyDocument(request.document),
    settings = document.settings;
  const schema = await inspectStrategy(document.source, request.libraries);
  for (const [key, value] of Object.entries(document.inputs)) {
    const input = schema.inputs.find((i) =>
      [i.id, i.varId, i.title, i.name].includes(key),
    );
    if (!input)
      throw new Error(
        `Unknown strategy input: ${key}. Inspect the current source inputs again.`,
      );
    if (input.type === "bool" && typeof value !== "boolean")
      throw new Error(`${input.title ?? key} must be true or false.`);
    if (
      typeof input.defval === "number" &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        (input.type === "int" && !Number.isInteger(value)) ||
        (input.minval !== undefined && value < input.minval) ||
        (input.maxval !== undefined && value > input.maxval))
    )
      throw new Error(
        `${input.title ?? key} is outside its declared numeric range.`,
      );
    if (input.options && !input.options.includes(value))
      throw new Error(
        `${input.title ?? key} is not one of the declared options.`,
      );
  }
  const indicator = new MarketStrategy(
    instrumentStrategy(document.source),
    document.inputs,
    strategyCurrency(request.dataset.market),
  );
  await indicator.resolveImports(resolver(request.libraries));
  const overrides = {
    initial_capital: settings.capital,
    default_qty_type: settings.quantityType,
    default_qty_value: settings.quantity,
    commission_type: settings.commissionType,
    commission_value: settings.commission,
    slippage: settings.slippage,
    pyramiding: settings.pyramiding,
    margin_long: settings.marginLong,
    margin_short: settings.marginShort,
    process_orders_on_close: settings.fillOnClose,
    use_bar_magnifier: settings.useBarMagnifier ?? false,
    calc_on_every_tick: false,
  };
  for (const [key, value] of Object.entries(overrides))
    indicator.prop[key] = value;
  const dataset = request.dataset,
    market = dataset.market;
  const cache = new Map<string, Promise<StrategyDataset>>([
    [`${market.symbol}:${market.timeframe}`, Promise.resolve(dataset)],
  ]);
  const secondaryErrors: string[] = [];
  const getDataset = (
    ticker: string,
    timeframe: string,
    limit = 20000,
    from?: number,
    to?: number,
  ) => {
    const symbol = ticker.replace(/^BINANCE:/, "");
    const tf = strategyTimeframe(timeframe),
      key = `${symbol}:${tf}`;
    const known = cache.get(key);
    if (known) return known;
    if (!fetchSeries)
      throw new Error(
        `No backtest data is available for ${ticker} ${timeframe}.`,
      );
    const promise = fetchSeries(
      symbol,
      tf,
      Math.min(limit, 20000),
      from,
      to,
    ).then((data) => {
      for (const warning of data.warnings)
        dataset.warnings.push(`${symbol} ${tf}: ${warning}`);
      return data;
    });
    cache.set(key, promise);
    return promise;
  };
  const provider: IProvider = {
    configure(config: unknown) {
      if (config && typeof config === "object" && Object.keys(config).length)
        throw new Error(
          "A frozen strategy data provider cannot be reconfigured during a run.",
        );
    },
    async getMarketData(ticker, timeframe, limit, from, to) {
      let data: StrategyDataset;
      try {
        data = await getDataset(ticker, timeframe, limit, from, to);
      } catch (error) {
        secondaryErrors.push(
          `${ticker} ${timeframe}: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
      const klines = toKlines(data).filter(
        (b) =>
          (from === undefined || b.openTime >= from) &&
          (to === undefined || b.openTime < to),
      );
      return limit ? klines.slice(-limit) : klines;
    },
    async getSymbolInfo(ticker) {
      const symbol = ticker.replace(/^BINANCE:/, "");
      let data: StrategyDataset;
      try {
        data = await getDataset(symbol, market.timeframe);
      } catch (error) {
        secondaryErrors.push(
          `${ticker}: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
      return strategySymbolInfo(data.market);
    },
  };
  const runtime = new PineTS(
    provider,
    market.symbol,
    strategyRuntimeTimeframe(market.timeframe),
    dataset.bars.length,
    dataset.bars[0].time,
    nextBucket(market.timeframe, dataset.bars.at(-1)!.time),
  );
  runtime.setMaxLoops(100000);
  runtime.setImportResolver(resolver(request.libraries));
  runtime.setFillsOnTickGrid(true);
  if (settings.useBarMagnifier && dataset.intrabars && dataset.intrabars.timeframe !== magnifierInterval(dataset, settings.intrabarInterval ?? "auto"))
    throw new Error("Intrabar history does not match the configured magnifier interval.");
  const magnifier = prepareMagnifier(dataset, settings.useBarMagnifier ?? false);
  runtime.setStrategyIntrabarPaths(magnifier.paths);
  let context: Context | undefined;
  for await (const page of runtime.run(indicator, undefined, 500)) {
    context = page.fullContext ?? page;
    progress(
      Math.min(context.idx + 1, dataset.bars.length),
      dataset.bars.length,
    );
  }
  if (!context) throw new Error("PineTS returned no strategy context.");
  if (secondaryErrors.length)
    throw new Error(
      `Secondary strategy history failed: ${secondaryErrors.join("; ")}`,
    );
  const report = buildStrategyReport(context, request, startedAt);
  report.magnifier = magnifier.summary;
  if (magnifier.summary.enabled) {
    const m = magnifier.summary;
    report.warnings.push(`Bar magnifier: ${m.coveredBars} / ${dataset.bars.length} chart candles use ${m.timeframe} OHLC paths; ${m.fallbackBars} use the parent OHLC path (${m.incompleteBars} incomplete, ${m.mismatchedBars} mismatched). Lower candles still infer an OHLC path; they are not tick-by-tick executions. Trade times retain parent bar timestamps.`);
  }
  return report;
}
