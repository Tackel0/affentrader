export type VolumeNodeKind = "HVN" | "LVN";

export interface VolumeNode {
  price: number;
  volume: number;
  kind: VolumeNodeKind;
  strength: number; // 0..1 normalized prominence relative to profile peak
}

export interface VolumeProfileBucketLike {
  price: number;
  total?: number;
  volume?: number;
  up?: number;
  down?: number;
  buy?: number;
  sell?: number;
}

/**
 * Identify High Volume Nodes (HVN) and Low Volume Nodes (LVN) from a contiguous Volume Profile histogram.
 * Uses a 3-point weighted smoothing kernel ([0.25, 0.5, 0.25]) and structural prominence filtering:
 * - HVN: local peak >= 55% of profile max volume (high-acceptance value cluster)
 * - LVN: local trough bounded by shoulders on both sides, <= 48% of max volume, and >= minProminenceRatio depth
 */
export function findVolumeNodes(
  rows: readonly VolumeProfileBucketLike[],
  minProminenceRatio = 0.14,
): VolumeNode[] {
  if (rows.length < 5) return [];
  const totals = rows.map((r) => {
    if (typeof r.total === "number" && Number.isFinite(r.total)) return Math.max(0, r.total);
    if (typeof r.volume === "number" && Number.isFinite(r.volume)) return Math.max(0, r.volume);
    const up = typeof r.up === "number" ? r.up : typeof r.buy === "number" ? r.buy : 0;
    const down = typeof r.down === "number" ? r.down : typeof r.sell === "number" ? r.sell : 0;
    return Math.max(0, up + down);
  });
  const maxTotal = Math.max(...totals);
  if (!(maxTotal > 0)) return [];

  const smooth = totals.map((val, i) => {
    const prev = totals[i - 1] ?? val;
    const next = totals[i + 1] ?? val;
    return prev * 0.25 + val * 0.5 + next * 0.25;
  });

  const nodes: VolumeNode[] = [];
  for (let i = 1; i < rows.length - 1; i++) {
    const curr = smooth[i];
    const prev = smooth[i - 1];
    const next = smooth[i + 1];
    const raw = totals[i];

    // High Volume Node (acceptance cluster)
    if (curr > prev && curr >= next && raw >= maxTotal * 0.55) {
      nodes.push({
        price: rows[i].price,
        volume: raw,
        kind: "HVN",
        strength: Math.min(1, Number((raw / maxTotal).toFixed(2))),
      });
      continue;
    }

    // Low Volume Node (rejection / fast-travel pocket between two shoulders)
    if (curr < prev && curr <= next && raw <= maxTotal * 0.48) {
      let leftPeak = 0;
      for (let j = i - 1; j >= 0; j--) leftPeak = Math.max(leftPeak, totals[j]);
      let rightPeak = 0;
      for (let j = i + 1; j < rows.length; j++) rightPeak = Math.max(rightPeak, totals[j]);
      const shoulder = Math.min(leftPeak, rightPeak);
      const depth = shoulder - raw;
      if (shoulder > raw && depth / maxTotal >= minProminenceRatio) {
        nodes.push({
          price: rows[i].price,
          volume: raw,
          kind: "LVN",
          strength: Math.min(1, Number((depth / maxTotal).toFixed(2))),
        });
      }
    }
  }

  return nodes.sort((a, b) => b.strength - a.strength || a.price - b.price).slice(0, 8);
}
