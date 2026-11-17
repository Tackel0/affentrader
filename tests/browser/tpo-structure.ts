import type { RendererLayerArgs } from "@luxalgo/vela";
import { buildTpoSessions } from "@/lib/orderflow/tpoModel";
import { defaultTpo } from "@/lib/orderflow/tpoSettings";
import { paintTpoSessions } from "@/lib/orderflow/tpoRenderer";

const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const ctx = canvas.getContext("2d")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const report = document.querySelector<HTMLTextAreaElement>("#report")!;
const minute = 60000, base = Date.UTC(2026, 9, 30);
const bar = (offset: number, low: number, high = low) => ({ time: base + offset * minute, low, high, open: low, close: high, volume: 1 });
const initial = [bar(0, 100, 104), bar(30, 100), bar(60, 104)];
const revisited = [...initial, bar(90, 101, 103)];
const style = { ...defaultTpo(), rowSize: 1, poorHighVisible: true, poorLowVisible: true, singlePrintsVisible: true,
  lettersVisible: false, histogramVisible: false, ibVisible: false, candlesVisible: false, boundariesVisible: false, pocVisible: false, valueAreaVisible: false };
function paint(bars = initial, enabled = true) {
  canvas.width = Math.max(320, Math.round(canvas.getBoundingClientRect().width)); canvas.height = 430;
  const sessions = buildTpoSessions(bars, style, "30m", "SIMULATED");
  const args = { bars, bounds: { top: 0, height: 430 }, scale: { min: 99, max: 107 }, theme: { textColor: "#d1d4dc" },
    coords: { width: canvas.width, timeToX: (time: number) => 20 + (time - base) / 86400000 * (canvas.width - 45),
      priceToY: (price: number) => (107 - price) * 50 } } as unknown as RendererLayerArgs;
  paintTpoSessions(ctx, args, sessions, { ...style, poorHighVisible: enabled, poorLowVisible: enabled, singlePrintsVisible: enabled });
  document.querySelector("#model")!.textContent = JSON.stringify(sessions[0].structure);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let orange = 0, purple = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], alpha = pixels[i + 3];
    if (alpha > 20 && r > 180 && g > 70 && g < 190 && b < 80) orange++;
    if (alpha > 20 && r > 100 && b > 140 && g < 120) purple++;
  }
  return { orange, purple, structure: sessions[0].structure };
}
function check() {
  try {
    const positive = paint(), hidden = paint(initial, false), repaired = paint(revisited);
    if (positive.structure.singlePrintZones.length !== 1 || positive.structure.singlePrintZones[0].rows !== 3 || positive.orange < 100 || positive.purple < 100)
      throw Error("Positive structure/raster was not painted.");
    if (hidden.orange || hidden.purple) throw Error("Visibility negative control did not clear all structural pixels.");
    if (repaired.structure.singlePrintZones.length || repaired.purple || repaired.orange < 100) throw Error("Revisited single prints were not removed.");
    paint(); report.value = JSON.stringify({ positive, hidden, repaired }, null, 2);
    status.textContent = "PASS · positive Canvas2D raster · hidden negative control · revisited zone removal";
  } catch (error) { status.textContent = `FAIL · ${error instanceof Error ? error.message : String(error)}`; }
}
document.querySelector("#run")!.addEventListener("click", check);
document.querySelector("#revisit")!.addEventListener("click", () => { paint(revisited); status.textContent = "REVISITED · no interior single-print zone remains"; });
document.querySelector("#restore")!.addEventListener("click", () => { paint(); status.textContent = "SIMULATED · orange poor extremes, purple interior single-print zone"; });
paint(); status.textContent = "READY · simulated prices only";
