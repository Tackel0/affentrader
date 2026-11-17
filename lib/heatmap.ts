export interface HeatItem {
  symbol: string;
  label: string;
  /** Area weight; must be positive. */
  size: number;
  /** 24h change in percent. */
  change: number;
}

export interface HeatRect<T extends { size: number }> {
  item: T;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Worst aspect ratio of a row laid along the shorter side `side`. */
function worst(row: number[], side: number): number {
  const sum = row.reduce((a, b) => a + b, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/**
 * Squarified treemap (Bruls, Huizing, van Wijk): tiles are as square as
 * possible and their areas are exactly proportional to `size`. Items with a
 * non-positive size are dropped; the rest are laid out largest first.
 */
export function squarify<T extends { size: number }>(items: readonly T[], width: number, height: number): HeatRect<T>[] {
  const valid = items.filter((i) => Number.isFinite(i.size) && i.size > 0).sort((a, b) => b.size - a.size);
  if (!valid.length || !(width > 0) || !(height > 0)) return [];
  const total = valid.reduce((n, i) => n + i.size, 0);
  const scale = (width * height) / total;
  const areas = valid.map((i) => i.size * scale);
  const out: HeatRect<T>[] = [];
  let box: Box = { x: 0, y: 0, width, height };
  let index = 0;
  while (index < valid.length) {
    const side = Math.min(box.width, box.height);
    const row: number[] = [areas[index]];
    let end = index + 1;
    while (end < valid.length && worst([...row, areas[end]], side) <= worst(row, side)) {
      row.push(areas[end]);
      end++;
    }
    const sum = row.reduce((a, b) => a + b, 0);
    if (box.width >= box.height) {
      // The row is a column on the left, filling the box height.
      const w = sum / box.height;
      let y = box.y;
      row.forEach((area, k) => {
        const h = area / w;
        out.push({ item: valid[index + k], x: box.x, y, width: w, height: h });
        y += h;
      });
      box = { x: box.x + w, y: box.y, width: box.width - w, height: box.height };
    } else {
      const h = sum / box.width;
      let x = box.x;
      row.forEach((area, k) => {
        const w = area / h;
        out.push({ item: valid[index + k], x, y: box.y, width: w, height: h });
        x += w;
      });
      box = { x: box.x, y: box.y + h, width: box.width, height: box.height - h };
    }
    index = end;
  }
  return out;
}

/** Red for falls, green for gains, deeper with the size of the move (saturating at ±`limit` %). */
export function heatColor(change: number, limit = 5): string {
  if (!Number.isFinite(change)) return "#5d6573";
  const t = Math.min(1, Math.abs(change) / limit);
  if (t < 0.02) return "#5d6573";
  const from = change >= 0 ? [60, 110, 100] : [120, 70, 78];
  const to = change >= 0 ? [8, 153, 129] : [242, 54, 69];
  const mix = (i: number) => Math.round(from[i] + (to[i] - from[i]) * t);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}
