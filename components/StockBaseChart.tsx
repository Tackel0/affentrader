import { useEffect, useRef } from "react";
import type { StockBaseRow } from "@/lib/screener/stockBase";
import { formatPrice } from "@/lib/symbols";

type ChartRow = Pick<StockBaseRow, "name" | "chart" | "resistance" | "invalidation"> & Partial<Pick<StockBaseRow, "breakoutEvidence" | "drawdownPeak">> & {
  firstLow: { session: string };
  retest: { session: string };
  recoveryLevel?: number;
  progress?: Pick<StockBaseRow["progress"], "status" | "statusSince" | "breakoutFailedOn" | "supportLostOn">;
};

export function StockBaseChart({ row }: { row: ChartRow }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const breakout = row.breakoutEvidence;
  const progress = row.progress;
  const failedOn = progress?.breakoutFailedOn ?? (progress?.status === "breakout-failed" ? progress.statusSince : undefined);
  const lostOn = progress?.supportLostOn ?? (progress?.status === "support-lost" ? progress.statusSince : undefined);
  const visibleFailure = row.chart.some(bar => bar.session === failedOn);
  const visibleLoss = row.chart.some(bar => bar.session === lostOn);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !row.chart.length) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const draw = () => {
      const width = canvas.clientWidth, height = canvas.clientHeight, ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (width < 100 || height < 50) return;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const low = Math.min(row.invalidation, ...row.chart.map(bar => bar.low));
      const high = Math.max(row.resistance, row.recoveryLevel ?? row.resistance, ...row.chart.map(bar => bar.high));
      const span = high - low || 1, left = 10, right = width - 76;
      const step = (right - left) / row.chart.length;
      const y = (price: number) => 14 + (high - price) / span * (height - 42);
      const foreground = getComputedStyle(canvas).color;
      context.font = "11px sans-serif";
      const levels: [number, string][] = [[row.resistance, "#eaa743"], [row.invalidation, "#f23645"]];
      if (row.recoveryLevel !== undefined) levels.push([row.recoveryLevel, "#5296ed"]);
      for (const [level, color] of levels) {
        context.strokeStyle = context.fillStyle = color;
        context.setLineDash([4, 4]);
        context.beginPath(); context.moveTo(left, y(level)); context.lineTo(right, y(level)); context.stroke();
        context.fillText(formatPrice(level), right + 4, y(level) + 4);
      }
      if (breakout) {
        context.strokeStyle = "#a78bfa";
        context.setLineDash([2, 3]);
        context.beginPath();
        context.moveTo(left, y(breakout.threshold));
        context.lineTo(right, y(breakout.threshold));
        context.stroke();
      }
      context.setLineDash([]);
      row.chart.forEach((bar, index) => {
        const x = left + (index + .5) * step;
        context.strokeStyle = context.fillStyle = bar.close >= bar.open ? "#089981" : "#f23645";
        context.beginPath(); context.moveTo(x, y(bar.high)); context.lineTo(x, y(bar.low)); context.stroke();
        context.fillRect(x - step * .28, y(Math.max(bar.open, bar.close)), step * .56, Math.max(1, Math.abs(y(bar.open) - y(bar.close))));
        if (bar.session === row.drawdownPeak?.session) {
          context.fillStyle = foreground;
          context.textAlign = "center";
          context.fillText("P", x, y(bar.high) - 4);
          context.textAlign = "left";
        }
        if (bar.session === row.firstLow.session || bar.session === row.retest.session) {
          context.fillStyle = foreground;
          context.fillText(bar.session === row.firstLow.session ? "1" : "2", x - 3, y(bar.low) + 13);
        }
        if (breakout && (bar.session === breakout.session || bar.session === breakout.confirmedOn)) {
          context.fillStyle = "#a78bfa";
          context.textAlign = "center";
          context.fillText(bar.session === breakout.confirmedOn ? "✓" : "↑", x, y(bar.high) - 4);
          context.textAlign = "left";
        }
        const failed = bar.session === failedOn;
        const lost = bar.session === lostOn;
        if (failed || lost) {
          context.fillStyle = "#f23645";
          context.textAlign = "center";
          context.fillText(failed && lost ? "×!" : lost ? "!" : "×", x, y(bar.low) + 13);
          context.textAlign = "left";
        }
      });
      context.fillStyle = foreground;
      context.fillText(row.chart[0].session, left, height - 3);
      context.textAlign = "right";
      context.fillText(row.chart.at(-1)!.session, right, height - 3);
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [row, breakout, failedOn, lostOn]);
  const breakoutDescription = breakout
    ? `Breakout threshold ${formatPrice(breakout.threshold)}, first clearance ${breakout.session}, confirmed ${breakout.confirmedOn}.`
    : "";
  const peakDescription = row.drawdownPeak ? ` Prior peak ${formatPrice(row.drawdownPeak.price)} on ${row.drawdownPeak.session}.` : "";
  return <figure className="stock-base-chart">
    <canvas ref={ref} role="img" aria-label={`Adjusted daily candles for ${row.name}. First low ${row.firstLow.session}, retest ${row.retest.session}, resistance ${formatPrice(row.resistance)}, invalidation ${formatPrice(row.invalidation)}.${peakDescription}${row.recoveryLevel === undefined ? "" : ` Recovery close ${formatPrice(row.recoveryLevel)}.`} ${breakoutDescription}${visibleFailure ? ` Breakout failed on ${failedOn}.` : ""}${visibleLoss ? ` Support lost on ${lostOn}.` : ""}`.trim()} />
    <figcaption>{row.drawdownPeak && "P Prior peak · "}1 First low · 2 Retest · Amber resistance · Red invalidation{row.recoveryLevel !== undefined && " · Blue recovery close"}{breakout && ` · Purple breakout threshold ${formatPrice(breakout.threshold)} · ${breakout.session === breakout.confirmedOn ? "✓ Clearance and confirmation" : "↑ First clearance · ✓ Confirmation"}`}{visibleFailure && ` · × Breakout failed on ${failedOn}`}{visibleLoss && ` · ! Support lost on ${lostOn}`}</figcaption>
  </figure>;
}
