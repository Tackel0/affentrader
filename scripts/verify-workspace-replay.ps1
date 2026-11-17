$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$culture = [Globalization.CultureInfo]::InvariantCulture
function Require($condition, $message) { if (-not $condition) { throw $message } }
function Amount($value) { [decimal]::Parse([Convert]::ToString($value, $culture), [Globalization.NumberStyles]::Float, $culture) }
function Value($text, $label) {
  $match = [regex]::Match($text, '(?m)^' + [regex]::Escape($label) + '\r?\n([^\r\n]+)')
  Require $match.Success "Missing native readout: $label"
  $match.Groups[1].Value
}
$capture = Get-Content -LiteralPath (Join-Path $root 'artifacts/kraken-recorded-replay-live.json') -Raw | ConvertFrom-Json
Require ($capture.selection.symbol -ceq 'KRK:BTC/USD' -and @($capture.trades).Count -eq 75) 'Wrong recorded sample'
$results = @()
foreach ($checkpoint in @(
  @{ name = 'fast58'; from = '10:55'; before = '10:56'; count = 58; session = $true },
  @{ name = 'fast75'; from = '10:56'; before = '10:57'; count = 75; session = $true },
  @{ name = 'slow75'; from = '10:55'; before = '11:00'; count = 75; session = $false },
  @{ name = 'back58'; from = '10:55'; before = '10:56'; count = 58; session = $true },
  @{ name = 'final-fast58'; from = '10:55'; before = '10:56'; count = 58; session = $true },
  @{ name = 'final-slow75'; from = '10:55'; before = '11:00'; count = 75; session = $false }
)) {
  $text = Get-Content -LiteralPath (Join-Path $root ('artifacts/workspace-replay-' + $checkpoint.name + '-data.txt')) -Raw
  $cut = [DateTimeOffset]::Parse('2026-11-06T' + $checkpoint.before + ':00Z').ToUnixTimeMilliseconds()
  $from = [DateTimeOffset]::Parse('2026-11-06T' + $checkpoint.from + ':00Z').ToUnixTimeMilliseconds()
  $prefix = @($capture.trades | Where-Object { $_.time -lt $cut })
  Require ($prefix.Count -eq $checkpoint.count -and $text.Contains("$($checkpoint.count) archived observations before 2026-11-06T$($checkpoint.before):00.000Z")) 'Prefix differs'
  Require ((Value $text 'Time') -ceq $checkpoint.from) 'Native candle time differs'
  foreach ($section in @('footprint', 'session')) {
    if ($section -eq 'session' -and -not $checkpoint.session) { continue }
    $rows = if ($section -eq 'session') { $prefix } else { @($prefix | Where-Object { $_.time -ge $from }) }
    $view = if ($section -eq 'session') { $text.Substring($text.IndexOf('Session Volume Profile ·', [StringComparison]::Ordinal)) } else { $text }
    [decimal]$buy = 0; [decimal]$sell = 0
    foreach ($row in $rows) { if ($row.side -eq 'buy') { $buy += Amount $row.quantity } else { $sell += Amount $row.quantity } }
    Require ((Amount (Value $view 'Ask volume (buys)')) -eq $buy -and (Amount (Value $view 'Bid volume (sells)')) -eq $sell) 'Buy/sell quantities differ'
    $volumeLabel = if ($section -eq 'session') { 'Session collected volume' } else { 'Collected volume' }
    $deltaLabel = if ($section -eq 'session') { 'Session delta (Ask − Bid)' } else { 'Delta (Ask − Bid)' }
    Require ((Amount (Value $view $volumeLabel)) -eq ($buy + $sell) -and (Amount (Value $view $deltaLabel)) -eq ($buy - $sell)) 'Volume/delta differ'
    $countLabel = if ($section -eq 'session') { 'Collected executions' } else { 'Observed executions' }
    Require ([int](Value $view $countLabel) -eq @($rows).Count) 'Execution count differs'
    if ($section -eq 'session') { Require ((Value $text 'CVD Close') -ceq ($buy - $sell).ToString('F1', $culture)) 'Rounded CVD differs' }
  }
  $results += [PSCustomObject]@{ checkpoint = $checkpoint.name; prefix = $prefix.Count; passed = $true }
}
foreach ($name in @('empty', 'slow-empty', 'back-slow-empty', 'final-slow-empty')) {
  $text = Get-Content -LiteralPath (Join-Path $root ('artifacts/workspace-replay-' + $name + '-data.txt')) -Raw
  Require ($text -match 'REPLAY' -and $text -match 'No collected executions for this candle' -and $text -notmatch 'Collected volume\r?\n|CVD Close') 'Empty prefix retained quantities'
}
$report = [PSCustomObject]@{ checkedAt = (Get-Date).ToUniversalTime().ToString('o'); checkpoints = $results; emptyCheckpoints = 4; scope = 'Native two-column 1m/5m UI readouts versus independent raw-archive decimal sums, including fresh final-build reload. CVD only displayed precision; no claim of full market history, intrabar or every layout.' }
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $root 'artifacts/workspace-replay-verification.json') -Encoding utf8
$report | ConvertTo-Json -Depth 6
