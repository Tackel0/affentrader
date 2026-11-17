import type { Tick } from "@/types/trading";

export interface DeltaSummary { total: number; high: number; low: number; volume: number }
const empty = (): DeltaSummary => ({ total: 0, high: 0, low: 0, volume: 0 });
/** Concatenating two ordered execution paths preserves extrema of every prefix. */
export function joinDelta(left: DeltaSummary, right: DeltaSummary): DeltaSummary {
  const total = left.total + right.total, high = Math.max(left.high, left.total + right.high),
    low = Math.min(left.low, left.total + right.low), volume = left.volume + right.volume;
  if (![total, high, low, volume].every(Number.isFinite)) throw new Error("CVD quantity exceeds supported precision.");
  return { total, high, low, volume };
}
interface Execution { time: number; sequence: number; id: string; delta: number }
interface Node { execution: Execution; left: Node | null; right: Node | null; height: number; summary: DeltaSummary }
const height = (node: Node | null) => node?.height ?? 0;
const summary = (node: Node | null) => node?.summary ?? empty();
const single = (delta: number): DeltaSummary => ({ total: delta, high: Math.max(0, delta), low: Math.min(0, delta), volume: Math.abs(delta) });
const compare = (a: Execution, b: Execution) => a.time - b.time || a.sequence - b.sequence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function update(node: Node): Node {
  node.height = Math.max(height(node.left), height(node.right)) + 1;
  node.summary = joinDelta(joinDelta(summary(node.left), single(node.execution.delta)), summary(node.right));
  return node;
}
function left(node: Node): Node {
  const root = node.right!; node.right = root.left; root.left = update(node); return update(root);
}
function right(node: Node): Node {
  const root = node.left!; node.left = root.right; root.right = update(node); return update(root);
}
function balance(node: Node): Node {
  update(node);
  if (height(node.left) - height(node.right) > 1) {
    if (height(node.left!.left) < height(node.left!.right)) node.left = left(node.left!);
    return right(node);
  }
  if (height(node.right) - height(node.left) > 1) {
    if (height(node.right!.right) < height(node.right!.left)) node.right = right(node.right!);
    return left(node);
  }
  return node;
}
function insert(node: Node | null, execution: Execution): Node {
  if (!node) return { execution, left: null, right: null, height: 1, summary: single(execution.delta) };
  const order = compare(execution, node.execution);
  if (order < 0) node.left = insert(node.left, execution);
  else if (order > 0) node.right = insert(node.right, execution);
  return balance(node);
}
function first(node: Node): Node { while (node.left) node = node.left; return node; }
function removeFirst(node: Node): Node | null {
  if (!node.left) return node.right;
  node.left = removeFirst(node.left); return balance(node);
}
/** Bounded ordered suffix plus an irreversible prefix summary. Insertion/deletion
 * are AVL-balanced: a busy forming candle never needs a full trade re-sort per tick.
 * All timestamps below the duplicate watermark are sealed only after their IDs expire. */
export class DeltaPath {
  private root: Node | null = null;
  private prefix = empty();
  private floor = -Infinity;
  add(trade: Tick): void {
    if (trade.time < this.floor) throw new Error("CVD execution precedes the sealed timestamp watermark.");
    this.root = insert(this.root, { time: trade.time, sequence: Number.isSafeInteger(trade.seq) ? trade.seq! : Number.MAX_VALUE,
      id: trade.id, delta: trade.side === "buy" ? trade.quantity : -trade.quantity });
  }
  sealBefore(time: number): void {
    while (this.root && first(this.root).execution.time < time) {
      this.prefix = joinDelta(this.prefix, single(first(this.root).execution.delta));
      this.root = removeFirst(this.root);
    }
    this.floor = Math.max(this.floor, time);
  }
  read(): DeltaSummary { return joinDelta(this.prefix, summary(this.root)); }
}
