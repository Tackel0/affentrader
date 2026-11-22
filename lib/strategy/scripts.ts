export const STRATEGY_EXAMPLES: Record<string, string> = {
  "EMA crossover": `//@version=6
strategy("EMA crossover", overlay=true)
fastLength = input.int(12, "Fast length", minval=1, maxval=500)
slowLength = input.int(26, "Slow length", minval=2, maxval=1000)
allowShort = input.bool(true, "Allow short entries")
fast = ta.ema(close, fastLength)
slow = ta.ema(close, slowLength)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    if allowShort
        strategy.entry("Short", strategy.short)
    else
        strategy.close("Long")
plot(fast, "Fast EMA", color=color.blue)
plot(slow, "Slow EMA", color=color.orange)
`,
  "RSI mean reversion": `//@version=6
strategy("RSI mean reversion", overlay=true)
length = input.int(14, "RSI length", minval=2, maxval=500)
oversold = input.float(30, "Oversold", minval=1, maxval=49)
overbought = input.float(70, "Overbought", minval=51, maxval=99)
r = ta.rsi(close, length)
if ta.crossover(r, oversold)
    strategy.entry("Long", strategy.long)
if ta.crossunder(r, overbought)
    strategy.close("Long")
`,
  "Donchian breakout": `//@version=6
strategy("Donchian breakout", overlay=true)
length = input.int(20, "Channel length", minval=2, maxval=500)
atrLength = input.int(14, "ATR length", minval=2, maxval=500)
atrMultiple = input.float(2, "ATR stop multiple", minval=0.1, step=0.1)
upper = ta.highest(high, length)[1]
lower = ta.lowest(low, length)[1]
atrValue = ta.atr(atrLength)
if close > upper
    strategy.entry("Long", strategy.long)
if close < lower
    strategy.entry("Short", strategy.short)
if strategy.position_size > 0
    strategy.exit("Long stop", "Long", stop=strategy.position_avg_price - atrValue * atrMultiple)
if strategy.position_size < 0
    strategy.exit("Short stop", "Short", stop=strategy.position_avg_price + atrValue * atrMultiple)
plot(upper, "Upper channel", color=color.green)
plot(lower, "Lower channel", color=color.red)
`,
  "Trend pullback with ATR bracket": `//@version=6
strategy("Trend pullback with ATR bracket", overlay=true)
fast = ta.ema(close, 20)
trend = ta.ema(close, 100)
risk = ta.atr(14)
reclaim = ta.crossover(close, fast)
if strategy.position_size == 0 and reclaim and fast > trend
    strategy.entry("Long", strategy.long)
if strategy.position_size > 0
    strategy.exit("Bracket", "Long", stop=strategy.position_avg_price - 2 * risk, limit=strategy.position_avg_price + 4 * risk)
if ta.crossunder(close, trend)
    strategy.close("Long")
plot(fast, "Pullback EMA", color=color.blue)
plot(trend, "Trend EMA", color=color.orange)
`,
  "Volatility contraction breakout": `//@version=6
strategy("Volatility contraction breakout", overlay=true)
fastAtr = ta.atr(7)
slowAtr = ta.atr(30)
upper = ta.highest(high, 15)[1]
lower = ta.lowest(low, 10)[1]
baseline = ta.ema(close, 50)
if strategy.position_size == 0 and close > upper and fastAtr[1] < slowAtr[1] and close > baseline
    strategy.entry("Long", strategy.long)
if strategy.position_size > 0
    strategy.exit("ATR stop", "Long", stop=strategy.position_avg_price - 2.5 * slowAtr)
    if close < lower
        strategy.close("Long")
plot(upper, "Breakout level", color=color.green)
plot(lower, "Exit channel", color=color.red)
`,
};
