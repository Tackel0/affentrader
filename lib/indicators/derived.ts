import {
  registerNativeIndicator,
  type InputValue,
  type NativeIndicator,
  type NativeIndicatorContext,
} from "@luxalgo/vela";
import type { OHLCV } from "@/types/trading";
import {
  defaultParameters,
  findTaIndicator,
  source,
  type Plot,
  type PriceSource,
  type Series,
  type TaOutput,
} from "@/lib/ta";

/**
 * A derived indicator applies one study to the output of another, e.g.
 * "SMA(5) of RSI(14)" or "Bollinger Bands of MACD". Both stages come from the
 * pure TA library so results match what alerts and screeners compute.
 */
export interface DerivedSource {
  kind: "price" | "indicator";
  /** Price field when `kind` is `price`, or the field the source study reads. */
  field?: PriceSource;
  indicator?: string;
  params?: Record<string, number>;
  /** Id of the source study's plot to feed forward (defaults to its first). */
  plot?: string;
}
export interface DerivedSpec {
  source: DerivedSource;
  apply: { indicator: string; params?: Record<string, number> };
}

export const DERIVED_DEFINITION_ID = "derived";
export const DERIVED_NATIVE_TYPE = "af-derived";

export function describeSource(spec: DerivedSpec): string {
  const s = spec.source;
  if (s.kind === "price") return s.field ?? "close";
  const indicator = findTaIndicator(s.indicator ?? "");
  const params = Object.values({
    ...defaultParameters(indicator ?? ({ parameters: [] } as never)),
    ...(s.params ?? {}),
  }).join(", ");
  return `${indicator?.shortName ?? s.indicator}(${params})`;
}

export function describeDerived(spec: DerivedSpec): string {
  const apply = findTaIndicator(spec.apply.indicator);
  const params = Object.values({
    ...(apply ? defaultParameters(apply) : {}),
    ...(spec.apply.params ?? {}),
  }).join(", ");
  return `${apply?.shortName ?? spec.apply.indicator}(${params}) on ${describeSource(spec)}`;
}

export function isDerivedSpec(value: unknown): value is DerivedSpec {
  if (!value || typeof value !== "object") return false;
  const spec = value as DerivedSpec;
  if (!spec.source || !spec.apply) return false;
  const apply = findTaIndicator(spec.apply.indicator);
  if (!apply || !apply.sourceable) return false;
  if (spec.source.kind === "price") return true;
  return (
    spec.source.kind === "indicator" &&
    findTaIndicator(spec.source.indicator ?? "") !== undefined
  );
}

/** Resolve the input series the second stage consumes. */
export function derivedInput(bars: readonly OHLCV[], spec: DerivedSpec): Series {
  const s = spec.source;
  if (s.kind === "price") return source(bars, s.field ?? "close");
  const study = findTaIndicator(s.indicator ?? "");
  if (!study) throw new Error(`Unknown source study ${s.indicator}`);
  const output = study.compute(bars, {
    ...defaultParameters(study),
    ...(s.params ?? {}),
  });
  const plot =
    output.plots.find((p) => p.id === s.plot) ?? output.plots[0];
  if (!plot) throw new Error(`${study.name} has no output to feed forward.`);
  return plot.values;
}

export function computeDerived(
  bars: readonly OHLCV[],
  spec: DerivedSpec,
): TaOutput {
  if (!isDerivedSpec(spec)) throw new Error("Invalid derived indicator.");
  const apply = findTaIndicator(spec.apply.indicator)!;
  const input = derivedInput(bars, spec);
  const output = apply.compute(
    bars,
    { ...defaultParameters(apply), ...(spec.apply.params ?? {}) },
    input,
  );
  return {
    overlay: spec.source.kind === "price" ? output.overlay : false,
    plots: output.plots.map(
      (plot): Plot => ({
        ...plot,
        title: `${plot.title} · ${describeDerived(spec)}`,
      }),
    ),
  };
}

const COLORS = ["#2962ff", "#f7b955", "#089981", "#f23645"];

export function registerDerivedIndicator() {
  registerNativeIndicator({
    type: DERIVED_NATIVE_TYPE,
    title: "Indicator on indicator",
    overlay: false,
    paneHint: "new",
    inputsSchema: () => [],
    defaultInputs: () => ({ spec: "" }),
    create: () => {
      let context: NativeIndicatorContext;
      let inputs: Record<string, InputValue> = {};
      let active = true;
      const compute = () => {
        if (!context || !active) return;
        let spec: unknown;
        try {
          spec = JSON.parse(String(inputs.spec ?? ""));
        } catch {
          return;
        }
        if (!isDerivedSpec(spec)) return;
        const bars = context.bars() as OHLCV[];
        const output = computeDerived(bars, spec);
        context.emit({
          series: output.plots.map((plot, index) => ({
            id: plot.id,
            title: plot.title,
            paneId: "",
            kind: plot.style === "histogram" ? "histogram" : "line",
            points: bars.map((bar, i) => ({
              time: bar.time,
              value: Number.isFinite(plot.values[i]) ? plot.values[i] : null,
            })),
            style: {
              color:
                index === 0 && typeof inputs.color === "string"
                  ? inputs.color
                  : COLORS[index % COLORS.length],
              width: Number(inputs.lineWidth ?? 2),
              lineStyle: "solid" as const,
              ...(plot.style === "histogram" ? { base: 0 } : {}),
            },
          })),
        });
      };
      const instance: NativeIndicator = {
        start: (ctx, values) => {
          context = ctx;
          inputs = values;
          compute();
        },
        onBars: compute,
        onViewport: () => {},
        setInputs: (values) => {
          inputs = values;
          compute();
        },
        suspend: () => {
          active = false;
        },
        resume: () => {
          active = true;
          compute();
        },
        stop: () => {
          active = false;
        },
      };
      return instance;
    },
  });
}
