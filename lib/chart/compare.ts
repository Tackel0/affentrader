import type { OHLCV } from "@/types/trading";
import { ema, sma, type Series } from "@/lib/ta";
import { isSymbolId } from "@/lib/symbolId";

/**
 * Formula engine for spread / ratio / custom comparison charts. Expressions
 * combine symbols with arithmetic and a few functions, e.g.
 * `BTCUSDT / ETHUSDT`, `(SOLUSDT - AVAXUSDT) / 2`, `log(BTCUSDT.close)`,
 * `sma(BTCUSDT, 20) - BTCUSDT`. It is a small recursive-descent parser; nothing
 * is ever passed to `eval`.
 */
export type Field = "open" | "high" | "low" | "close" | "volume" | "hl2" | "hlc3";
export type Node =
  | { t: "num"; v: number }
  | { t: "sym"; symbol: string; field: Field }
  | { t: "neg"; e: Node }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "%" | "^"; l: Node; r: Node }
  | { t: "fn"; name: string; args: Node[] };

const FIELDS: Field[] = ["open", "high", "low", "close", "volume", "hl2", "hlc3"];
const FUNCTIONS: Record<string, { min: number; max: number }> = {
  abs: { min: 1, max: 1 },
  log: { min: 1, max: 1 },
  ln: { min: 1, max: 1 },
  log10: { min: 1, max: 1 },
  sqrt: { min: 1, max: 1 },
  exp: { min: 1, max: 1 },
  min: { min: 2, max: 2 },
  max: { min: 2, max: 2 },
  sma: { min: 2, max: 2 },
  ema: { min: 2, max: 2 },
  change: { min: 1, max: 2 },
};

interface Token {
  type: "num" | "id" | "op" | "(" | ")" | "," | "." | "end";
  text: string;
  /** A `{YF:AAPL}` symbol written in braces. */
  quoted?: boolean;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c) && !(c === "." && !/[0-9]/.test(text[i + 1] ?? ""))) {
      let j = i;
      while (j < text.length && /[0-9.]/.test(text[j])) j++;
      if (/[eE]/.test(text[j] ?? "") && /[0-9+-]/.test(text[j + 1] ?? "")) {
        j += 2;
        while (j < text.length && /[0-9]/.test(text[j])) j++;
      }
      tokens.push({ type: "num", text: text.slice(i, j) });
      i = j;
    } else if (c === "{") {
      const close = text.indexOf("}", i);
      if (close < 0) throw new Error("Missing } in formula.");
      tokens.push({ type: "id", text: text.slice(i + 1, close).trim(), quoted: true });
      i = close + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
      tokens.push({ type: "id", text: text.slice(i, j) });
      i = j;
    } else if ("+-*/%^".includes(c)) {
      tokens.push({ type: "op", text: c });
      i++;
    } else if (c === "(" || c === ")" || c === "," || c === ".") {
      tokens.push({ type: c, text: c });
      i++;
    } else throw new Error(`Unexpected character "${c}" in formula.`);
  }
  tokens.push({ type: "end", text: "" });
  return tokens;
}

export function parseFormula(text: string): Node {
  if (text.length > 500) throw new Error("Formula is too long.");
  const tokens = tokenize(text);
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const expect = (type: Token["type"]) => {
    const token = take();
    if (token.type !== type)
      throw new Error(`Expected "${type}" but found "${token.text || "end"}".`);
    return token;
  };
  const depth = { value: 0 };
  const enter = () => {
    if (++depth.value > 40) throw new Error("Formula is nested too deeply.");
  };
  function additive(): Node {
    let node = multiplicative();
    while (peek().type === "op" && "+-".includes(peek().text)) {
      const op = take().text as "+" | "-";
      node = { t: "bin", op, l: node, r: multiplicative() };
    }
    return node;
  }
  function multiplicative(): Node {
    let node = power();
    while (peek().type === "op" && "*/%".includes(peek().text)) {
      const op = take().text as "*" | "/" | "%";
      node = { t: "bin", op, l: node, r: power() };
    }
    return node;
  }
  function power(): Node {
    const base = unary();
    if (peek().type === "op" && peek().text === "^") {
      take();
      return { t: "bin", op: "^", l: base, r: power() };
    }
    return base;
  }
  function unary(): Node {
    if (peek().type === "op" && (peek().text === "-" || peek().text === "+")) {
      const sign = take().text;
      enter();
      const inner = unary();
      depth.value--;
      return sign === "-" ? { t: "neg", e: inner } : inner;
    }
    return primary();
  }
  function primary(): Node {
    const token = take();
    if (token.type === "num") {
      const v = Number(token.text);
      if (!Number.isFinite(v)) throw new Error(`Invalid number "${token.text}".`);
      return { t: "num", v };
    }
    if (token.type === "(") {
      enter();
      const inner = additive();
      depth.value--;
      expect(")");
      return inner;
    }
    if (token.type === "id") {
      const name = token.text;
      if (!token.quoted && peek().type === "(") {
        const fn = name.toLowerCase();
        const spec = FUNCTIONS[fn];
        if (!spec) throw new Error(`Unknown function "${name}".`);
        take();
        const args: Node[] = [];
        if (peek().type !== ")") {
          do {
            if (peek().type === ",") take();
            enter();
            args.push(additive());
            depth.value--;
          } while (peek().type === ",");
        }
        expect(")");
        if (args.length < spec.min || args.length > spec.max)
          throw new Error(`${fn}() takes ${spec.min === spec.max ? spec.min : `${spec.min}-${spec.max}`} argument(s).`);
        return { t: "fn", name: fn, args };
      }
      const symbol = name.toUpperCase();
      if (token.quoted ? !isSymbolId(symbol) : !/^[A-Z0-9]{3,24}$/.test(symbol))
        throw new Error(`"${name}" is not a valid symbol.`);
      let field: Field = "close";
      if (peek().type === ".") {
        take();
        const f = expect("id").text.toLowerCase() as Field;
        if (!FIELDS.includes(f)) throw new Error(`Unknown field "${f}".`);
        field = f;
      }
      return { t: "sym", symbol, field };
    }
    throw new Error(`Unexpected "${token.text || "end of formula"}".`);
  }
  const root = additive();
  if (peek().type !== "end") throw new Error(`Unexpected "${peek().text}".`);
  return root;
}

export function collectSymbols(node: Node, into = new Set<string>()): Set<string> {
  switch (node.t) {
    case "sym":
      into.add(node.symbol);
      break;
    case "neg":
      collectSymbols(node.e, into);
      break;
    case "bin":
      collectSymbols(node.l, into);
      collectSymbols(node.r, into);
      break;
    case "fn":
      node.args.forEach((a) => collectSymbols(a, into));
      break;
  }
  return into;
}

function fieldValue(bar: OHLCV, field: Field): number {
  switch (field) {
    case "hl2":
      return (bar.high + bar.low) / 2;
    case "hlc3":
      return (bar.high + bar.low + bar.close) / 3;
    default:
      return bar[field];
  }
}

/** Sample `bars` at every timeline instant, carrying the last known value forward. */
export function alignToTimeline(
  bars: readonly OHLCV[],
  timeline: readonly number[],
  field: Field,
): Series {
  const out = new Array<number>(timeline.length).fill(Number.NaN);
  let j = -1;
  for (let i = 0; i < timeline.length; i++) {
    while (j + 1 < bars.length && bars[j + 1].time <= timeline[i]) j++;
    if (j >= 0) out[i] = fieldValue(bars[j], field);
  }
  return out;
}

function constantArgument(node: Node, name: string): number {
  if (node.t === "num") return node.v;
  if (node.t === "neg" && node.e.t === "num") return -node.e.v;
  throw new Error(`${name}() needs a number for its length.`);
}

export function evaluateFormula(
  node: Node,
  data: Record<string, readonly OHLCV[]>,
  timeline: readonly number[],
): Series {
  const n = timeline.length;
  const evaluate = (current: Node): Series => {
    switch (current.t) {
      case "num":
        return new Array<number>(n).fill(current.v);
      case "sym": {
        const bars = data[current.symbol];
        if (!bars) throw new Error(`No data loaded for ${current.symbol}.`);
        return alignToTimeline(bars, timeline, current.field);
      }
      case "neg":
        return evaluate(current.e).map((v) => -v);
      case "bin": {
        const l = evaluate(current.l);
        const r = evaluate(current.r);
        return l.map((a, i) => {
          const b = r[i];
          switch (current.op) {
            case "+":
              return a + b;
            case "-":
              return a - b;
            case "*":
              return a * b;
            case "/":
              return b === 0 ? Number.NaN : a / b;
            case "%":
              return b === 0 ? Number.NaN : a % b;
            default:
              return a ** b;
          }
        });
      }
      case "fn": {
        const [first, second] = current.args;
        switch (current.name) {
          case "abs":
            return evaluate(first).map(Math.abs);
          case "log":
          case "ln":
            return evaluate(first).map((v) => (v > 0 ? Math.log(v) : Number.NaN));
          case "log10":
            return evaluate(first).map((v) => (v > 0 ? Math.log10(v) : Number.NaN));
          case "sqrt":
            return evaluate(first).map((v) => (v >= 0 ? Math.sqrt(v) : Number.NaN));
          case "exp":
            return evaluate(first).map(Math.exp);
          case "min":
          case "max": {
            const a = evaluate(first);
            const b = evaluate(second);
            const pick = current.name === "min" ? Math.min : Math.max;
            return a.map((v, i) => pick(v, b[i]));
          }
          case "sma":
            return sma(evaluate(first), constantArgument(second, "sma"));
          case "ema":
            return ema(evaluate(first), constantArgument(second, "ema"));
          default: {
            const lag = second ? constantArgument(second, "change") : 1;
            const values = evaluate(first);
            return values.map((v, i) => (i >= lag ? v - values[i - lag] : Number.NaN));
          }
        }
      }
    }
  };
  return evaluate(node);
}

/** Symbols a compare series needs data for (empty if its formula is invalid). */
export function compareSymbols(series: {
  kind: "symbol" | "formula";
  symbol?: string;
  expression?: string;
}): string[] {
  if (series.kind === "symbol") return series.symbol ? [series.symbol] : [];
  try {
    return [...collectSymbols(parseFormula(series.expression ?? ""))];
  } catch {
    return [];
  }
}

export interface FormulaResult {
  points: { time: number; value: number }[];
  symbols: string[];
}

/** Evaluate a formula over `timeline`, dropping instants where it is undefined. */
export function runFormula(
  text: string,
  data: Record<string, readonly OHLCV[]>,
  timeline: readonly number[],
): FormulaResult {
  const ast = parseFormula(text);
  const values = evaluateFormula(ast, data, timeline);
  return {
    symbols: [...collectSymbols(ast)],
    points: timeline.flatMap((time, i) =>
      Number.isFinite(values[i]) ? [{ time, value: values[i] }] : [],
    ),
  };
}
