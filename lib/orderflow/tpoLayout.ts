import type { RendererLayerArgs } from "@luxalgo/vela";
import type { TpoSession } from "./tpoModel";
import type { TpoPreferences } from "./tpoSettings";
export function tpoPeriodWindow(session: TpoSession, period: number, minutes: number) {
  const span = session.periodSpans?.find(s => period >= s.first && period < s.first + s.count);
  const start = span ? span.start + (period - span.first) * minutes * 60000 : session.start + period * minutes * 60000;
  return { start, end: Math.min(span?.end ?? session.end, start + minutes * 60000) };
}
export function tpoSessionLayout(args: RendererLayerArgs, session: TpoSession, style: TpoPreferences) {
  const { coords } = args, split = session.expanded ?? style.splitPeriods;
    const packedStart = (style.sessionPeriod ?? "Day") !== "Day" && !split ? Math.max(session.start, session.coverage.firstBar) : session.start;
    const rawLeft = coords.timeToX(packedStart), rawEnd = coords.timeToX(session.end), rail = rawEnd - rawLeft < 14;
    const left = rail ? rawLeft : rawLeft + 4, end = rail ? rawEnd : rawEnd - 4;
    const slots = session.rows.reduce((maximum, row) => Math.max(maximum, split ? (row.periodIndices.at(-1) ?? -1) + 1 : row.count), 1);
    const labelLength = session.rows.reduce((maximum, row) => Math.max(maximum, row.periods.at(-1)?.length ?? 1), 1);
    const cellWidth = Math.max(1, Math.min(labelLength * 7 + 1, (end - left) / slots));
    const columns = new Map<number, { x: number; width: number } | null>();
    const cellAt = (item: number, period: number) => {
      if (!split) return { x: left + item * cellWidth, width: cellWidth };
      if (!columns.has(period)) {
        // Chart coordinates carry the actual time-axis spacing (including
        // compressed gaps). Candle timestamps mark centers, so both edges are
        // shifted half a bar to bracket the candles in this block's window.
        const { start, end: until } = tpoPeriodWindow(session, period, Number(style.blockMinutes));
        const x = coords.timeToX(start) - coords.pxPerBar() / 2;
        const right = coords.timeToX(until) - coords.pxPerBar() / 2;
        columns.set(period, Number.isFinite(x) && Number.isFinite(right) && right > x ? { x, width: right - x } : null);
      }
      return columns.get(period)!;
    };
  return { left, end, cellWidth, cellAt, split, rail };
}

