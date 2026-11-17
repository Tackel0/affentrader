/** Compact reference formatting; exact source quantities stay in readouts/CSV. */
export function footprintNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const size = Math.abs(value);
  return size >= 1000 ? `${(value / 1000).toFixed(size >= 10000 ? 0 : 1)}k` : size >= 100 || Number.isInteger(value) ? value.toFixed(0) : size >= 1 ? value.toFixed(1) : value.toFixed(2).replace(/0$/, "");
}

export function footprintSignedNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value === 0 ? "0" : `${value > 0 ? "+" : "-"}${footprintNumber(Math.abs(value))}`;
}
