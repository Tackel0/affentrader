import type { OHLCV, Tick, Timeframe } from "@/types/trading";
import { getSymbol, INTERVAL_MS } from "@/lib/symbols";
export function generateHistory(
  symbol: string,
  timeframe: Timeframe,
  count = 600,
  end = Date.now(),
  seedPrice = getSymbol(symbol).seedPrice,
): OHLCV[] {
  let seed = [...symbol].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const step = INTERVAL_MS[timeframe];
  const final = Math.floor(end / step) * step;
  seedPrice=Number.isFinite(seedPrice)&&seedPrice>0?seedPrice:1;
  let price = seedPrice * 0.975;
  const bars: OHLCV[] = [];
  for (let i = 0; i < count; i++) {
    const open = price;
    const volatility = Math.min(0.012, 0.0006 * Math.sqrt(step / 60000));
    price = Math.max(
      open * 0.2,
      open *
        (1 +
          (random() - 0.48) * volatility +
          Math.sin(i / 23) * volatility * 0.15),
    );
    bars.push({
      time: final - (count - 1 - i) * step,
      open,
      close: price,
      high: Math.max(open, price) * (1 + random() * volatility * 0.5),
      low: Math.min(open, price) * (1 - random() * volatility * 0.5),
      volume:
        (random() * 40 + 2) *
        (60000 / Math.max(price, 0.001)) *
        Math.sqrt(step / 60000),
    });
  }
  const ratio = seedPrice / bars[bars.length - 1].close;
  return bars.map((b) => ({
    ...b,
    open: b.open * ratio,
    high: b.high * ratio,
    low: b.low * ratio,
    close: b.close * ratio,
  }));
}
export function generateTick(
  symbol: string,
  price: number,
  time = Date.now(),
): Tick {
  const change = (Math.random() - 0.495) * 0.00038;
  return {
    id: `sim-${symbol}-${time}`,
    symbol,
    time,
    price: Math.max(1e-10, price * (1 + change)),
    quantity: (Math.random() * 800) / Math.max(price, 0.000001),
    side: change >= 0 ? "buy" : "sell",
    simulated: true,
    tradeCount: 1,
  };
}
