$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$culture = [Globalization.CultureInfo]::InvariantCulture
function Require($condition, $message) { if (-not $condition) { throw $message } }
function Readout($text, $label, $duplicate = $false) {
  $escaped = [regex]::Escape($label)
  $pattern = '(?m)^' + $escaped + '\r?\n'
  if ($duplicate) { $pattern += $escaped + '\r?\n' }
  $match = [regex]::Match($text, $pattern + '(-?\d+(?:\.\d+)?)\r?$')
  Require $match.Success "Missing numeric native readout: $label"
  [decimal]::Parse($match.Groups[1].Value, $culture)
}
$capture = Get-Content -LiteralPath (Join-Path $root 'artifacts/kraken-recorded-replay-live.json') -Raw | ConvertFrom-Json
$trades = @($capture.trades | Sort-Object time, seq, id)
Require ($capture.selection.symbol -ceq 'KRK:BTC/USD' -and $trades.Count -eq 75) 'Wrong archive sample'
Require (@($trades.id | Sort-Object -Unique).Count -eq 75) 'Duplicate archived IDs'
foreach ($trade in $trades) {
  Require ($trade.symbol -ceq 'KRK:BTC/USD' -and $trade.simulated -eq $false -and $trade.tradeCount -eq 1 -and $trade.side -in @('buy','sell')) 'Invalid count evidence'
}
$results = @()
foreach ($checkpoint in @(
  @{ name='fast58'; from='10:55'; before='10:56'; prefix=58 },
  @{ name='fast75'; from='10:56'; before='10:57'; prefix=75 },
  @{ name='slow75'; from='10:55'; before='11:00'; prefix=75 },
  @{ name='back'; from='10:55'; before='10:56'; prefix=58 },
  @{ name='restored'; from='10:55'; before='10:56'; prefix=58 }
)) {
  $text = Get-Content -LiteralPath (Join-Path $root ('artifacts/trade-count-replay-' + $checkpoint.name + '.txt')) -Raw
  $from = [DateTimeOffset]::Parse('2026-11-06T' + $checkpoint.from + ':00Z').ToUnixTimeMilliseconds()
  $cut = [DateTimeOffset]::Parse('2026-11-06T' + $checkpoint.before + ':00Z').ToUnixTimeMilliseconds()
  $prefix = @($trades | Where-Object { $_.time -lt $cut })
  Require ($prefix.Count -eq $checkpoint.prefix -and $text.Contains("$($checkpoint.prefix) archived observations before 2026-11-06T$($checkpoint.before):00.000Z")) 'Wrong Replay boundary'
  Require ($text -match ('(?m)^Time\r?\n' + $checkpoint.from + '\r?$')) 'Wrong inspected candle'
  [long]$running=0; [long]$buy=0; [long]$sell=0
  foreach ($trade in $prefix) {
    if ($trade.time -ge $from) { break }
    $running += $(if ($trade.side -eq 'buy') { 1 } else { -1 })
  }
  $open=$running; $high=$running; $low=$running
  foreach ($trade in @($prefix | Where-Object { $_.time -ge $from })) {
    if ($trade.side -eq 'buy') { $buy++; $running++ } else { $sell++; $running-- }
    $high=[Math]::Max($high,$running); $low=[Math]::Min($low,$running)
  }
  Require ((Readout $text 'Trade Count' $true) -eq ($buy+$sell)) 'Total count differs'
  Require ((Readout $text 'Trade Count Delta' $true) -eq ($buy-$sell)) 'Signed count differs'
  foreach ($field in @(@('open',$open),@('high',$high),@('low',$low),@('close',$running))) {
    Require ((Readout $text ('CTCD '+$field[0])) -eq $field[1]) ('CTCD '+$field[0]+' differs')
  }
  $results += [PSCustomObject]@{ checkpoint=$checkpoint.name; prefix=$prefix.Count; buy=$buy; sell=$sell; total=($buy+$sell); delta=($buy-$sell); open=$open; high=$high; low=$low; close=$running; passed=$true }
}
foreach ($name in @('empty','slow-empty','gap','cleared')) {
  $text = Get-Content -LiteralPath (Join-Path $root ('artifacts/trade-count-replay-' + $name + '.txt')) -Raw
  Require ($text -match 'REPLAY' -and $text -notmatch '(?m)^CTCD open\r?$|^Trade Count\r?\nTrade Count\r?\n-?\d|^Trade Count Delta\r?\nTrade Count Delta\r?\n-?\d') 'Empty/cleared candle retained count values'
}
$report = [PSCustomObject]@{ checkedAt=(Get-Date).ToUniversalTime().ToString('o'); checkpoints=$results; emptyCheckpoints=4; scope='Actual native two-column 1m/5m UI readouts versus independent count-only raw-archive paths; forward, backward, missing bar and remove/restore. UTC Day sample only; no whole-market, integer-format or pixel-parity claim.' }
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $root 'artifacts/trade-count-replay-verification.json') -Encoding utf8
$report | ConvertTo-Json -Depth 6
