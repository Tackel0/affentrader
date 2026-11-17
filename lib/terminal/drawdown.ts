export function closingDrawdowns(prices: readonly number[]) {
  let peak = 0;
  let peakIndex = 0;
  return prices.map((price, index) => {
    if (price >= peak) {
      peak = price;
      peakIndex = index;
    }
    return { percent: 100 * (price / peak - 1), peakIndex };
  });
}
