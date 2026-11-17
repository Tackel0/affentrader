# Stock bases and the research terminal

Open **Screener → Stock bases** and choose the US, Xetra or London market. One scan walks the complete curated universe for that market in batches of 24 and ranks the returned candidates together. Each batch has a bounded server request and reports failed symbols separately. A zero-result scan can mean no qualifying structure or unavailable data, as shown by the evaluated count.

The scanner reconstructs up to 12 completed sessions using only candles through each observation date. Select a stock to see the earliest observed match and stage changes for the same pair of pivot lows. Enable **Include recent inactive setups** to see the last qualifying snapshot beside the latest close. The status distinguishes a breach of support, a failed confirmed breakout and a setup that no longer meets the screening rules. The earliest match refers to the 12-session window and uses the provider's current adjusted history.

In **Terminal**, `MARKETS` opens the global overview. It compares the last completed daily close with the closes 1, 5 and 20 observations earlier. Each row shows its session date and opens the matching daily chart. Index levels are in points. FX and continuous futures use the quote currency returned by Yahoo Finance. Continuous futures changes can include roll effects.

The scanner uses Yahoo Finance dividend-adjusted daily OHLC and published share volume. It waits until the next date in the exchange time zone before accepting a daily candle. A stock and its benchmark must have the same latest completed session. The matched benchmarks are the S&P 500, DAX and FTSE 100.

The setup requires a drawdown of at least 12% and four ATR from a preceding high, followed by two confirmed pivots at least four sessions apart. Each pivot needs two subsequent sessions. The retest must hold within the allowed band around the first low, price must rebound into the upper half of the base, and matched-session returns must beat the benchmark by at least 0.5%. The retest range may not exceed 115% of the preceding selloff range. A close above resistance needs volume at least 1.25 times the prior 20-session mean or two consecutive qualifying closes to count as a confirmed breakout. The table lists earlier stages separately. RSI at the first low is context only. The score ranks these rules and has no backtested probability interpretation.

Open **Terminal** in the workspace panel strip. `HELP` lists commands. `SCAN`, `NEWS` and `MACRO` open the corresponding workspace views. `AAPL GP` opens the daily chart and `AAPL CAPM` runs the benchmark analysis using the current benchmark and rate. CAPM uses up to one year of completed daily data. Each paired return must share both session endpoints. The regression computes beta, Jensen alpha, R², annualized volatility, estimated CAPM return and Sharpe. The annual risk-free rate is an editable input with a zero default. The CAPM module is adapted from [OPNB](https://github.com/kindermerendero/open-bloomberg-terminal/tree/e98f8410327ade867cab41447bb4c43b129a18d9). See [third-party notices](../THIRD_PARTY_NOTICES.md) for attribution and the MIT license.

The scanner compares stock and benchmark session dates across up to 82 completed sessions, covering the peak search and the 12-session reconstruction. An unmatched date in that window is shown as unavailable. The check relies on the provider's reported sessions, so gaps shared by both series cannot be detected by this comparison.

Recovery participation compares average volume on higher-close and lower-close sessions after the retest. Unchanged closes are omitted. Both directions need at least two observations. The ratio adjusts ranking by up to six points in either direction. It measures volume by daily price direction, not aggressor-side executions.

Choose **Active watchlist** to scan its Yahoo symbols for the selected market. Batches of up to 24 send only ticker symbols and the selected market to the scanner. Yahoo instrument metadata excludes non-stocks.

Scan batches are combined only when benchmark session dates and adjusted closes match across the batches. If they change during a scan, the UI reports the mismatch and retains only the earlier comparable groups.

The stock must also advance from its retest close and outperform the benchmark over that same interval. The detail view and CSV show both measures.
