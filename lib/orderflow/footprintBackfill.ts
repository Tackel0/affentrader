import type { RendererLayerArgs } from "@luxalgo/vela";
import { binanceAggregateTrade } from "@/lib/market/binanceStream";
import { browserTradePager, type TradePager } from "@/lib/market/klines";
import { wireObject } from "@/lib/market/marketWire";
import { BINANCE_SYMBOL } from "@/lib/symbolId";
import type { Tick } from "@/types/trading";
import type { FootprintHistory } from "./footprintHistory";

const PAGE_SIZE = 1000;
const INITIAL_PAGES = 5;
const MAX_PAGES = 16;
const RETRY_DELAY = 30_000;

interface Request { through: number; pages: number }
interface Market {
  pages: Tick[][];
  listeners: Set<() => void>;
  pending?: AbortController;
  exhausted: boolean;
  failures: number;
  retryAt: number;
}

function parsePage(rows: unknown, symbol: string, limit: number, before: number | undefined): Tick[] {
  if (!Array.isArray(rows) || rows.length > limit) throw new Error("Invalid Binance aggregate trade page.");
  const page: Tick[] = [];
  for (const value of rows) {
    const row = wireObject(value);
    const tick = row && binanceAggregateTrade(row, symbol);
    const previous = page.at(-1);
    if (!tick || (previous && (tick.seq! <= previous.seq! || tick.time < previous.time)) || (before !== undefined && tick.seq! >= before)) {
      throw new Error("Invalid Binance aggregate trade sequence.");
    }
    page.push(tick);
  }
  return page;
}

export function footprintBackfillRequest(args: Pick<RendererLayerArgs, "bars" | "coords">): Request | undefined {
  const range = args.coords.visibleLogicalRange();
  const last = args.bars.length - 1;
  const left = Math.max(0, Math.floor(range.from));
  const right = Math.min(last, Math.ceil(range.to));
  if (!Number.isFinite(left + right) || right < left) return;
  const latest = right >= last - 1;
  const through = args.bars[Math.max(latest ? 0 : left, right - 4)]?.time;
  if (through !== undefined) return { through, pages: latest ? INITIAL_PAGES : MAX_PAGES };
}

/** One request at a time per active market, shared by all Footprint renderers. */
export class BinanceFootprintBackfill {
  private markets = new Map<string, Market>();

  constructor(private load: TradePager = browserTradePager) {}

  attach(symbol: string, changed: () => void) {
    let market = this.markets.get(symbol);
    if (!market) {
      market = { pages: [], listeners: new Set(), exhausted: false, failures: 0, retryAt: 0 };
      this.markets.set(symbol, market);
    }
    const entry = market;
    entry.listeners.add(changed);
    let history: FootprintHistory | undefined;
    let consumed = 0;
    let closed = false;
    return {
      read: (nextHistory: FootprintHistory, request?: Request): string => {
        if (closed) return "";
        if (history !== nextHistory) { history = nextHistory; consumed = 0; }
        if (consumed < entry.pages.length) {
          const pages = entry.pages.slice(consumed);
          nextHistory.add(pages.length === 1 ? pages[0] : pages.reverse().flat());
          consumed = entry.pages.length;
        }
        if (request) this.request(symbol, entry, request);
        if (entry.pending) return "Binance · loading older trades; gaps possible.";
        if (entry.failures) return "Binance trade history temporarily unavailable; live trades continue.";
        if (entry.pages.length) {
          const oldest = nextHistory.coverage.first;
          const reachedLimit = request && entry.pages.length >= request.pages && entry.pages.at(-1)![0].time > request.through;
          const from = oldest === null ? "" : ` from ${new Date(oldest).toISOString().slice(0, 16).replace("T", " ")} UTC`;
          return `Binance · observed trades${from}; ${reachedLimit ? "history limit reached; " : ""}gaps possible.`;
        }
        return entry.exhausted ? "Binance returned no recent trades." : "";
      },
      close: () => {
        if (closed) return;
        closed = true;
        entry.listeners.delete(changed);
        if (!entry.listeners.size) {
          entry.pending?.abort();
          this.markets.delete(symbol);
        }
      },
    };
  }

  private request(symbol: string, market: Market, { through, pages }: Request) {
    if (market.pending || market.exhausted || market.pages.length >= pages || market.failures >= 2 || Date.now() < market.retryAt
      || (typeof document !== "undefined" && document.hidden)) return;
    const oldest = market.pages.at(-1)?.[0];
    if (oldest && (oldest.time <= through || oldest.seq === 0)) return;
    const before = oldest?.seq;
    const limit = before === undefined ? PAGE_SIZE : Math.min(PAGE_SIZE, before);
    const fromId = before === undefined ? undefined : before - limit;
    const controller = new AbortController();
    market.pending = controller;
    void this.loadPage(symbol, market, limit, before, fromId, controller);
  }

  private async loadPage(symbol: string, market: Market, limit: number, before: number | undefined, fromId: number | undefined, controller: AbortController) {
    try {
      const rows = await this.load({ symbol, limit, fromId, signal: controller.signal });
      if (controller.signal.aborted) return;
      const page = parsePage(rows, symbol, limit, before);
      if (page.length) market.pages.push(page);
      else market.exhausted = true;
      market.failures = 0;
      market.retryAt = 0;
    } catch {
      if (controller.signal.aborted) return;
      market.failures++;
      market.retryAt = Date.now() + RETRY_DELAY;
    } finally {
      market.pending = undefined;
      if (!controller.signal.aborted) for (const changed of market.listeners) changed();
    }
  }
}

const shared = new BinanceFootprintBackfill();

export function createFootprintBackfill(changed: () => void) {
  let active: { symbol: string; session: ReturnType<BinanceFootprintBackfill["attach"]> } | undefined;
  const clear = () => { active?.session.close(); active = undefined; };
  return {
    read(symbol: string, history: FootprintHistory | undefined, args: RendererLayerArgs) {
      if (!BINANCE_SYMBOL.test(symbol) || !history || history.simulated) { clear(); return ""; }
      if (active?.symbol !== symbol) {
        clear();
        active = { symbol, session: shared.attach(symbol, changed) };
      }
      return active.session.read(history, footprintBackfillRequest(args));
    },
    clear,
  };
}
