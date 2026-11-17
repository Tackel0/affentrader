import type { Vela } from "@luxalgo/vela";
import type { ChartType, Timeframe } from "@/types/trading";
import { footprintBarCount, footprintWindow } from "@/lib/orderflow/layout";
import { recentWindow } from "./ranges";
import { tpoWindow } from "@/lib/orderflow/tpoModel";
import type { TpoPreferences } from "@/lib/orderflow/tpoSettings";

type Chart = Pick<Vela, "historyComplete" | "replay" | "market" | "setVisibleRange">;
interface RecentViewOptions {
  valid(): boolean;
  settled(market: Vela["market"]): Promise<boolean>;
  read(): { bars: readonly { time: number }[]; timeframe: Timeframe; chartType: ChartType; width: number; tpo?: TpoPreferences; symbol?: string };
}
/** Frame the current native series only after its asynchronous live restoration has landed. */
export async function frameRecentView(chart: Chart, options: RecentViewOptions): Promise<boolean> {
  await chart.historyComplete();
  if (!options.valid()) return false;
  if (!chart.replay.state.active && !await options.settled(chart.market)) return false;
  if (!options.valid()) return false;
  const view = options.read(), replay = chart.replay.state;
  const cursor = replay.active ? replay.cursorTime ?? -1 : undefined;
  const revealed = cursor === undefined ? view.bars : view.bars.filter(bar => bar.time <= cursor);
  const range = view.chartType === "footprint" ? footprintWindow(view.bars, view.timeframe, footprintBarCount(view.width), cursor) :
    view.chartType === "tpo" ? tpoWindow(revealed, view.tpo, view.symbol) : recentWindow(view.bars, 150, cursor);
  if (!range) throw new Error("Load chart history before resetting the view.");
  chart.setVisibleRange(range);
  return true;
}
