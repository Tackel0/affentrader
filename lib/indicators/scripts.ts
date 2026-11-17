export const STRUCTURE_SCRIPT = `//@version=5
indicator("Market structure · Affentrader", overlay=true, max_lines_count=100, max_boxes_count=100)
length = input.int(5, "Swing length", minval=2)
showBlocks = input.bool(true, "Order blocks")
showGaps = input.bool(true, "Fair value gaps")
ph = ta.pivothigh(high, length, length)
pl = ta.pivotlow(low, length, length)
var float swingHigh = na
var float swingLow = na
var int trend = 0
if not na(ph)
    swingHigh := ph
if not na(pl)
    swingLow := pl
bullBreak = ta.crossover(close, swingHigh)
bearBreak = ta.crossunder(close, swingLow)
if bullBreak
    if trend == -1
        label.new(bar_index, low, "CHoCH ↑", style=label.style_label_up, color=color.orange, textcolor=color.white, size=size.tiny)
    else
        label.new(bar_index, low, "BOS ↑", style=label.style_label_up, color=color.teal, textcolor=color.white, size=size.tiny)
    trend := 1
    if showBlocks
        box.new(bar_index - 1, high[1], bar_index + 12, low[1], bgcolor=color.new(color.teal, 88), border_color=color.new(color.teal, 50))
if bearBreak
    if trend == 1
        label.new(bar_index, high, "CHoCH ↓", style=label.style_label_down, color=color.orange, textcolor=color.white, size=size.tiny)
    else
        label.new(bar_index, high, "BOS ↓", style=label.style_label_down, color=color.red, textcolor=color.white, size=size.tiny)
    trend := -1
    if showBlocks
        box.new(bar_index - 1, high[1], bar_index + 12, low[1], bgcolor=color.new(color.red, 88), border_color=color.new(color.red, 50))
if showGaps and low > high[2] and barstate.isconfirmed
    box.new(bar_index - 2, low, bar_index + 8, high[2], bgcolor=color.new(color.aqua, 90), border_color=color.new(color.aqua, 65))
if showGaps and high < low[2] and barstate.isconfirmed
    box.new(bar_index - 2, low[2], bar_index + 8, high, bgcolor=color.new(color.orange, 90), border_color=color.new(color.orange, 65))
plot(swingHigh, "Swing high", color=color.new(color.red, 40), style=plot.style_stepline)
plot(swingLow, "Swing low", color=color.new(color.teal, 40), style=plot.style_stepline)`;
export const LIQUIDITY_SCRIPT = `//@version=5
indicator("Liquidity sweeps · Affentrader", overlay=true)
length = input.int(20, "Lookback", minval=2)
upper = ta.highest(high, length)[1]
lower = ta.lowest(low, length)[1]
buySweep = low < lower and close > lower and barstate.isconfirmed
sellSweep = high > upper and close < upper and barstate.isconfirmed
plot(upper, "Buy-side liquidity", color=color.new(color.red, 50))
plot(lower, "Sell-side liquidity", color=color.new(color.teal, 50))
plotshape(buySweep, title="Bullish sweep", style=shape.triangleup, location=location.belowbar, color=color.teal, size=size.small)
plotshape(sellSweep, title="Bearish sweep", style=shape.triangledown, location=location.abovebar, color=color.red, size=size.small)`;
export const KNN_SCRIPT = `//@version=5
indicator("k-NN momentum · Affentrader", overlay=false)
length = input.int(14, "RSI length", minval=2)
lookback = input.int(80, "Training bars", minval=10, maxval=200)
k = input.int(5, "Neighbors", minval=1, maxval=10)
feature = ta.rsi(close, length)
var distances = array.new_float(0)
var labels = array.new_float(0)
array.clear(distances)
array.clear(labels)
if bar_index > lookback + length
    for i = 2 to lookback
        distance = math.abs(feature - feature[i])
        direction = close[i - 1] > close[i] ? 1.0 : -1.0
        array.push(distances, distance)
        array.push(labels, direction)
float score = 0.0
if array.size(distances) > k
    for neighbor = 0 to k - 1
        nearest = array.indexof(distances, array.min(distances))
        score += array.get(labels, nearest)
        array.set(distances, nearest, 1000000.0)
plot(score / k, "Neighbor vote", color=score >= 0 ? color.teal : color.red, style=plot.style_histogram)
hline(0, "Neutral", color=color.gray)`;
export const ICHIMOKU_SCRIPT = `//@version=5
indicator("Ichimoku Cloud", overlay=true)
conversionLength = input.int(9, "Conversion length", minval=1)
baseLength = input.int(26, "Base length", minval=1)
spanLength = input.int(52, "Span B length", minval=1)
displacement = input.int(26, "Displacement", minval=1)
conversion = (ta.highest(high, conversionLength) + ta.lowest(low, conversionLength)) / 2
base = (ta.highest(high, baseLength) + ta.lowest(low, baseLength)) / 2
spanA = (conversion + base) / 2
spanB = (ta.highest(high, spanLength) + ta.lowest(low, spanLength)) / 2
plot(conversion, "Conversion", color=color.blue)
plot(base, "Base", color=color.red)
p1 = plot(spanA, "Span A", color=color.teal, offset=displacement)
p2 = plot(spanB, "Span B", color=color.orange, offset=displacement)
fill(p1, p2, color=spanA > spanB ? color.new(color.teal, 88) : color.new(color.red, 88))
plot(close, "Lagging span", color=color.green, offset=-displacement)`;
export const STARTER_SCRIPT = `//@version=5
indicator("EMA crossover", overlay=true)
fastLength = input.int(9, "Fast length", minval=1)
slowLength = input.int(21, "Slow length", minval=1)
fast = ta.ema(close, fastLength)
slow = ta.ema(close, slowLength)
plot(fast, "Fast EMA", color=color.teal, linewidth=2)
plot(slow, "Slow EMA", color=color.orange, linewidth=2)
plotshape(ta.crossover(fast, slow), title="Bullish cross", style=shape.triangleup, location=location.belowbar, color=color.teal, size=size.small)
plotshape(ta.crossunder(fast, slow), title="Bearish cross", style=shape.triangledown, location=location.abovebar, color=color.red, size=size.small)`;
