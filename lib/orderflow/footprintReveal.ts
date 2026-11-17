import type { RendererLayerArgs } from "@luxalgo/vela";

type Position = "left" | "right" | "within";
/** Reveal is driven by raw viewport spacing, independently of bar pitch/stretch. */
export function footprintRevealTarget(spacing: number, observed: boolean): number {
  if (!observed || !Number.isFinite(spacing)) return 0;
  const t = Math.max(0, Math.min(1, (spacing - 5) / 5));
  return t * t * (3 - 2 * t);
}
export function footprintBodyModulation(opacity: number, positions: readonly Position[]) {
  const reveal = Math.max(0, Math.min(1, opacity));
  return {
    candleBodyScale: positions.some(value => value !== "within") ? 1 + (.07 - 1) * reveal : 1,
    candleBodyAlpha: positions.includes("within") ? 1 + (.07 - 1) * reveal : 1,
    gridAlpha: 1 - reveal,
  };
}
export function footprintRawSpacing(args: RendererLayerArgs): number {
  return typeof args.coords.getViewport === "function" ? args.coords.getViewport().barSpacing : args.coords.pxPerBar();
}
export function footprintCandleHalfWidth(args: RendererLayerArgs, scale = 1): number {
  const spacing = typeof args.coords.bodySpacing === "function" ? args.coords.bodySpacing() : args.coords.pxPerBar();
  return Math.max(.5, Math.floor(.7 * spacing * scale) / 2);
}
/** One clock per mounted layer. New source/Replay identities must never inherit a fade. */
export function createFootprintReveal() {
  let opacity = 0, target = 0, last: number | undefined, identity: string | undefined, through: number | undefined;
  return {
    get opacity() { return opacity; },
    get animating() { return Math.abs(opacity - target) > .001; },
    reset() { opacity = target = 0; last = undefined; identity = undefined; through = undefined; },
    update(now: number, spacing: number, observed: boolean, scope: string, replayThrough?: number) {
      if (scope !== identity || replayThrough !== undefined && through !== undefined && replayThrough < through) { opacity = 0; last = undefined; identity = scope; }
      through = replayThrough;
      target = footprintRevealTarget(spacing, observed);
      const elapsed = last === undefined ? NaN : now - last;
      last = now;
      if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 1000) opacity = target;
      else opacity += (target - opacity) * -Math.expm1(-elapsed / 140);
      if (Math.abs(opacity - target) < .001) opacity = target;
      return opacity;
    },
  };
}
