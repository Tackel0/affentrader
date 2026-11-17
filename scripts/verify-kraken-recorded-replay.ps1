$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$culture = [Globalization.CultureInfo]::InvariantCulture
function Require($condition, $message) { if (-not $condition) { throw $message } }
function Amount($value) { [decimal]::Parse([Convert]::ToString($value, $culture), [Globalization.NumberStyles]::Float, $culture) }
function Totals($trades) {
  [decimal]$buy = 0; [decimal]$sell = 0
  foreach ($trade in $trades) { if ($trade.side -eq 'buy') { $buy += (Amount $trade.quantity) } else { $sell += (Amount $trade.quantity) } }
  [PSCustomObject]@{ count = @($trades).Count; buy = $buy; sell = $sell; volume = $buy + $sell; delta = $buy - $sell }
}
function Value($text, $label) {
  $match = [regex]::Match($text, '(?m)^' + [regex]::Escape($label) + '\r?\n([^\r\n]+)')
  Require $match.Success "Missing native readout: $label"
  $match.Groups[1].Value
}
$capture = Get-Content -LiteralPath (Join-Path $root 'artifacts/kraken-recorded-replay-live.json') -Raw | ConvertFrom-Json
Require ($capture.version -eq 2 -and $capture.selection.symbol -ceq 'KRK:BTC/USD') 'Wrong capture format/market'
$trades = @($capture.trades)
Require ($trades.Count -eq 75 -and @($trades.id | Sort-Object -Unique).Count -eq 75) 'Unexpected/duplicate archive records'
Require (@($trades | Where-Object { $_.simulated -ne $false -or $_.symbol -cne 'KRK:BTC/USD' -or $_.tradeCount -ne 1 }).Count -eq 0) 'Unexpected source/count flags'
$all = Totals $trades
foreach ($label in @('buy', 'sell', 'delta')) { Require ((Amount $capture.($label + $(if ($label -eq 'delta') { '' } else { 'Volume' }))) -eq $all.$label) "Archive $label total differs" }
$checkpoints = @()
foreach ($checkpoint in @(@{ name = 'first'; cutoff = '2026-11-06T10:56:00Z'; count = 58; minute = '2026-11-06T10:55:00Z' }, @{ name = 'full'; cutoff = '2026-11-06T10:57:00Z'; count = 75; minute = '2026-11-06T10:56:00Z' })) {
  $cutoff = [DateTimeOffset]::Parse($checkpoint.cutoff).ToUnixTimeMilliseconds()
  $expected = @($trades | Where-Object { $_.time -lt $cutoff }); $totals = Totals $expected
  Require ($expected.Count -eq $checkpoint.count) 'Unexpected raw prefix size'
  $rows = @(Import-Csv -LiteralPath (Join-Path $root ('artifacts/kraken-recorded-replay-' + $checkpoint.name + '.csv')))
  Require ($rows.Count -eq $expected.Count -and @($rows.id | Sort-Object -Unique).Count -eq $expected.Count) 'Tape prefix length/IDs differ'
  foreach ($row in $rows) {
    $matches = @($expected | Where-Object { $_.id -ceq $row.id }); Require ($matches.Count -eq 1) 'Unexpected tape execution'
    $tick = $matches[0]
    Require ($row.recorded_replay -ceq 'true' -and $row.symbol -ceq 'KRK:BTC/USD' -and $row.aggressor -ceq $tick.side) 'Tape provenance differs'
    Require (([DateTimeOffset]::Parse($row.execution_utc).ToUnixTimeMilliseconds()) -eq $tick.time -and (Amount $row.quantity) -eq (Amount $tick.quantity) -and (Amount $row.price) -eq (Amount $tick.price)) 'Tape values differ'
    Require (([DateTimeOffset]::Parse($row.replay_before_utc).ToUnixTimeMilliseconds()) -eq $cutoff -and $tick.time -lt $cutoff) 'Tape leaked outside exclusive boundary'
    Require ([long]$row.sequence -eq [long]$tick.seq) 'Tape sequence differs'
  }
  $text = Get-Content -LiteralPath (Join-Path $root ('artifacts/kraken-recorded-replay-' + $checkpoint.name + '-data.txt')) -Raw
  $session = $text.Substring($text.IndexOf('Session Volume Profile ·', [StringComparison]::Ordinal))
  Require ((Value $session 'Collected executions') -eq [string]$totals.count) 'Native session count differs'
  foreach ($pair in @(@('Ask volume (buys)', 'buy'), @('Bid volume (sells)', 'sell'), @('Session collected volume', 'volume'), @('Session delta (Ask − Bid)', 'delta'))) {
    Require ((Amount (Value $session $pair[0])) -eq $totals.($pair[1])) "Native session $($pair[0]) differs"
  }
  $minute = [DateTimeOffset]::Parse($checkpoint.minute).ToUnixTimeMilliseconds()
  $bar = Totals @($expected | Where-Object { $_.time -ge $minute -and $_.time -lt $minute + 60000 })
  foreach ($pair in @(@('Ask volume (buys)', 'buy'), @('Bid volume (sells)', 'sell'), @('Collected volume', 'volume'), @('Delta (Ask − Bid)', 'delta'))) {
    Require ((Amount (Value $text $pair[0])) -eq $bar.($pair[1])) "Native footprint $($pair[0]) differs"
  }
  Require ((Value $text 'Observed executions') -eq [string]$bar.count) 'Native footprint count differs'
  Require ((Value $text 'CVD Close') -ceq $totals.delta.ToString('F1', $culture)) 'Native rounded CVD close differs'
  $checkpoints += [PSCustomObject]@{ cursorUtc = $checkpoint.minute; exclusiveCutoffUtc = $checkpoint.cutoff; prefix = $totals; footprint = $bar; nativeCvdClose = (Value $text 'CVD Close') }
}
foreach ($name in @('backward', 'restored')) {
  $text = Get-Content -LiteralPath (Join-Path $root ('artifacts/kraken-recorded-replay-' + $name + '-data.txt')) -Raw
  Require ($text -match '58 archived observations before 2026-11-06T10:56:00.000Z') 'Backward/restored boundary differs'
  Require ((Amount (Value $text 'Collected volume')) -eq $checkpoints[0].footprint.volume) 'Backward/restored quantity differs'
}
$empty = Get-Content -LiteralPath (Join-Path $root 'artifacts/kraken-recorded-replay-empty-data.txt') -Raw
$removed = Get-Content -LiteralPath (Join-Path $root 'artifacts/kraken-recorded-replay-removed-data.txt') -Raw
$gap = Get-Content -LiteralPath (Join-Path $root 'artifacts/kraken-recorded-replay-gap-data.txt') -Raw
Require ($empty -match 'No collected executions' -and $empty -match 'No recorded executions revealed' -and $empty -notmatch 'CVD Close') 'Empty prefix retained native quantities'
Require ($removed -match 'waiting for loaded recorded executions' -and $removed -notmatch 'CVD Close|Session collected volume') 'Removed archive retained native quantities'
Require ($gap -match 'No collected executions for this candle' -and $gap -match '75 archived observations before 2026-11-06T10:58:00.000Z') 'Gap lost partial-coverage provenance'
$before = @(Import-Csv -LiteralPath (Join-Path $root 'artifacts/kraken-recorded-replay-chart-before.csv'))
$after = @(Import-Csv -LiteralPath (Join-Path $root 'artifacts/kraken-recorded-replay-chart-after.csv'))
Require ($after.Count -gt 0 -and @($before | Where-Object { $_.source -cne 'Binance' }).Count -eq 0 -and @($after | Where-Object { $_.source -cne 'Kraken' -or $_.symbol -cne 'KRK:BTC/USD' }).Count -eq 0) 'Candle CSV source regression'
$beforeByTime = @{}; foreach ($row in $before) { $beforeByTime[$row.time] = $row }
foreach ($row in $after) {
  Require ($beforeByTime.ContainsKey($row.time)) 'Final candle not in overlap window'
  foreach ($field in @('time', 'open', 'high', 'low', 'close', 'volume', 'symbol', 'timeframe')) { Require ($row.$field -ceq $beforeByTime[$row.time].$field) "Candle CSV changed $field" }
  Require (([DateTimeOffset]::Parse($row.time)) -le [DateTimeOffset]::Parse('2026-11-06T10:55:00Z')) 'Candle CSV leaked later Replay bars'
}
$chartExport = [PSCustomObject]@{ beforeRows = $before.Count; afterRows = $after.Count; identicalOverlappingCandles = $after.Count; sourceBefore = 'Binance'; sourceAfter = 'Kraken'; laterReplayBarsExcluded = $true; note = 'Fresh rolling historical load starts later; every retained overlapping OHLCV row is unchanged.' }
$report = [PSCustomObject]@{ checkedAt = (Get-Date).ToUniversalTime().ToString('o'); market = $capture.selection.symbol; recorded = $all; checkpointChecks = $checkpoints; restoredAfterReload = 75; emptyPrefixCleared = $true; removedSelectionCleared = $true; backwardSeekPassed = $true; gapExcludedLiveTrades = $true; chartExport = $chartExport; scope = 'Downloaded real Kraken archive and exact tape exports checked with independent .NET decimal arithmetic against native Footprint and Session Volume Profile readouts. CVD verified only at its displayed one-decimal precision; no claim of exact unrounded native CVD values, complete venue history, original-arrival or intrabar playback.' }
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $root 'artifacts/kraken-recorded-replay-verification.json') -Encoding utf8
$report | ConvertTo-Json -Depth 10
