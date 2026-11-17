import { getDrawingType, registerDrawingType, msg, type Drawing, type DrawingTypeKey, type Projector, type SerializedDrawing } from "@luxalgo/vela";
import { fibonacciPrice, isFibonacciType, type FibonacciType } from "./fibonacciMath";

interface FibLevel { ratio: number; color: string; enabled: boolean; label?: string }
interface FibEntryLine { color: string; label?: string; x1: number; y1: number; x2: number; y2: number; numberText: string; numberX: number; numberY: number; numberAlign: "left" | "right"; labelX: number; labelY: number }
interface NativeLevelLine { ratio:number; color:string; label?:string; price:number; x1:number; x2:number; y:number }
interface NativeFib extends Drawing {
  levels: FibLevel[];
  reverse?: boolean;
  logLevels: boolean;
  logarithmicAxis: boolean;
  entryLines(projector: Projector): FibEntryLine[] | null;
  levelLines?: (projector: Projector) => NativeLevelLine[] | null;
  levelPrice?: (ratio: number, from: number, to: number) => number;
}
const REGISTERED = Symbol.for("affentrader.fibonacci-construction.v1");

/** A projector has no scale flag. Its three positive samples distinguish affine/log-affine axes. */
export function isLogarithmicProjector(projector: Pick<Projector, "yOf">, pane: string, reference: number): boolean {
  if (!Number.isFinite(reference) || reference <= 0) return false;
  const samples = [reference / 2, reference, reference * 2].map(price => projector.yOf(price, pane));
  if (samples.some(value => value === null || !Number.isFinite(value))) return false;
  const [a, b, c] = samples as number[], span = Math.abs(c - a);
  return span > 0 && Math.abs(b - (a + c) / 2) <= span * 1e-7;
}

function augment(drawing: Drawing, type: FibonacciType, props: Record<string, unknown> = {}): Drawing {
  const fib = drawing as NativeFib;
  const serialize = drawing.serialize.bind(drawing), applyProps = drawing.applyProps.bind(drawing), schema = drawing.schema.bind(drawing);
  fib.logLevels = props.logLevels === true;
  fib.logarithmicAxis = false;
  if (type === "fibextensiontrend") fib.reverse = props.reverse === true;
  const price = (ratio: number) => fibonacciPrice(type, drawing.anchors, ratio, Boolean(fib.reverse), fib.logLevels && fib.logarithmicAxis);
  const setAxis = (projector: Projector) => { fib.logarithmicAxis = isLogarithmicProjector(projector, drawing.paneId, drawing.anchors[0]?.price ?? 1); };
  drawing.serialize = (): SerializedDrawing => {
    const doc = serialize();
    return { ...doc, props: { ...doc.props, logLevels: fib.logLevels, ...(type === "fibextensiontrend" ? { reverse: Boolean(fib.reverse) } : {}) } };
  };
  drawing.applyProps = props => {
    applyProps(props);
    if (typeof props.logLevels === "boolean") fib.logLevels = props.logLevels;
    if (type === "fibextensiontrend" && typeof props.reverse === "boolean") fib.reverse = props.reverse;
  };
  drawing.schema = () => ({ ...schema(), fields: [...schema().fields,
    { path: "logLevels", label: "Fib levels based on log scale", kind: "boolean", group: "behavior", when: { path: "logarithmicAxis", in: [true] } },
    ...(type === "fibextensiontrend" ? [{ path: "reverse", label: "Reverse", kind: "boolean" as const, group: "behavior" as const }, { path: "style.extendLeft", label: "Extend left", kind: "boolean" as const, group: "line" as const }, { path: "style.extendRight", label: "Extend right", kind: "boolean" as const, group: "line" as const }] : []),
  ] });
  if (type === "fibextensiontrend") {
    fib.entryLines = projector => {
      setAxis(projector);
      if (drawing.anchors.length < 3) return null;
      const times = drawing.anchors.map(point => projector.xOf(point.time)), x1 = drawing.style.extendLeft ? 0 : Math.min(...times), x2 = drawing.style.extendRight ? projector.width : Math.max(...times);
      return fib.levels.filter(level => level.enabled).flatMap(level => {
        const value = price(level.ratio), y = projector.yOf(value, drawing.paneId);
        return !Number.isFinite(value) || y === null || !Number.isFinite(y) ? [] : [{ color: level.color, label: level.label, x1, y1: y, x2, y2: y, numberText: `${level.ratio} (${value.toFixed(2)})`, numberX: x1 + 4, numberY: y - 7, numberAlign: "left" as const, labelX: (x1 + x2) / 2, labelY: y - 7 }];
      });
    };
  } else {
    const levelLines = fib.levelLines?.bind(fib);
    if (!levelLines || !fib.levelPrice) throw new Error(`Vela ${type} no longer exposes its native level construction.`);
    fib.levelLines = projector => { setAxis(projector); return levelLines(projector)?.filter(line=>[line.price,line.x1,line.x2,line.y].every(Number.isFinite))??null; };
    fib.levelPrice = ratio => price(ratio);
  }
  drawing.priceRange = () => {
    const prices = fib.levels.filter(level => level.enabled).map(level => price(level.ratio)).filter(Number.isFinite);
    if (type === "fibextensiontrend") prices.push(...drawing.anchors.map(point => point.price));
    return prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null;
  };
  return drawing;
}

/** Keep the native classes/painter/settings/undo path; replace only the registered construction factory. */
export function registerFibonacciConstruction(): void {
  for (const type of ["fibretracement", "fibextension", "fibextensiontrend"] as const) {
    const entry = getDrawingType(type);
    if (!entry)throw new Error(`Native Fibonacci tool ${type} is unavailable.`);
    if (Reflect.get(entry.create, REGISTERED)) continue;
    const create: typeof entry.create = init => augment(entry.create(init), type, init.props);
    Object.defineProperty(create, REGISTERED, { value: true });
    registerDrawingType({ ...entry, label: msg(`drawing.${type}.label`, entry.label), create });
  }
}

export function isRegisteredFibonacci(type: DrawingTypeKey): boolean {
  return isFibonacciType(type) && Boolean(Reflect.get(getDrawingType(type)?.create ?? {}, REGISTERED));
}
