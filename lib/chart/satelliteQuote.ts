import type { OHLCV, Vela } from "@luxalgo/vela";

export interface SatelliteQuote {
  close: number | null;
  replaying: boolean;
}

/** The heading follows the revealed native bar throughout Replay, including intrabar updates. */
export function bindSatelliteQuote(chart: Pick<Vela, "on" | "replay">, publish: (quote: SatelliteQuote) => void) {
  let history: readonly OHLCV[] = [];
  let liveBar: OHLCV | undefined;
  let replayBar: OHLCV | undefined;
  const show = (bar: OHLCV | undefined, replaying: boolean) => {
    publish({ close: bar && Number.isFinite(bar.close) ? bar.close : null, replaying });
  };
  const update = () => {
    const { active, cursorTime } = chart.replay.state;
    if (active) {
      const revealed = cursorTime === null ? undefined
        : replayBar?.time === cursorTime ? replayBar : history.findLast((bar) => bar.time <= cursorTime);
      show(revealed, true);
      return;
    }
    const latest = history.at(-1);
    show(liveBar && (!latest || liveBar.time >= latest.time) ? liveBar : latest, false);
  };
  const off = [
    chart.on("bar", (bar) => {
      if (chart.replay.state.active) {
        replayBar = bar;
        show(bar, true);
      } else if (!liveBar || bar.time >= liveBar.time) {
        liveBar = bar;
        update();
      }
    }),
    chart.on("replay:start", () => { replayBar = undefined; update(); }),
    chart.on("replay:end", () => { replayBar = undefined; update(); }),
  ];
  return {
    setHistory(bars: readonly OHLCV[]) { history = bars; update(); },
    dispose() { off.forEach((unsubscribe) => unsubscribe()); },
  };
}
