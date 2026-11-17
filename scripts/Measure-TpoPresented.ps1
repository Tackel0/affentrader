param(
  [Parameter(Mandatory = $true)][string[]]$ImagePaths,
  [string]$OutputPath,
  [int]$Left = 50,
  [int]$Top = 90,
  [int]$Width = 810,
  [int]$Height = 460
)
$ErrorActionPreference = 'Stop'
if ($Left -lt 0 -or $Top -lt 0 -or $Width -le 0 -or $Height -le 0) { throw 'Invalid screenshot region.' }
Add-Type -AssemblyName System.Drawing
$taskResults = @()
foreach ($taskImage in $ImagePaths) {
  $taskPath = (Resolve-Path -LiteralPath $taskImage).Path
  $taskBitmap = [System.Drawing.Bitmap]::new($taskPath)
  try {
    if ($Left + $Width -gt $taskBitmap.Width -or $Top + $Height -gt $taskBitmap.Height) { throw "Region exceeds screenshot: $taskImage" }
    $taskCount = 0
    for ($taskX = $Left; $taskX -lt $Left + $Width; $taskX++) {
      for ($taskY = $Top; $taskY -lt $Top + $Height; $taskY++) {
        $taskColor = $taskBitmap.GetPixel($taskX, $taskY)
        if ($taskColor.B -gt 65 -and $taskColor.B -gt $taskColor.R * 1.5 -and $taskColor.B -gt $taskColor.G * 1.5) { $taskCount++ }
      }
    }
    $taskResults += [pscustomobject]@{ image = $taskImage; width = $taskBitmap.Width; height = $taskBitmap.Height; bluePixels = $taskCount }
  } finally { $taskBitmap.Dispose() }
}
if (-not $taskResults.Count -or $taskResults[0].bluePixels -eq 0) { throw 'A nonempty blue baseline is required.' }
$taskBaseline = $taskResults[0].bluePixels
$taskReport = [ordered]@{
  basis = 'Decoded presented screenshots; no browser canvas reads or chart screenshot recomposition.'
  limitation = 'Blue EMA/text can contribute. Use an actual histogram-off negative control at unchanged geometry. This does not observe every intermediate frame.'
  region = @{ left = $Left; top = $Top; width = $Width; height = $Height }
  blueThreshold = @{ minimum = 65; redRatio = 1.5; greenRatio = 1.5 }
  samples = @($taskResults | ForEach-Object { [ordered]@{ image = $_.image; width = $_.width; height = $_.height; bluePixels = $_.bluePixels; baselineRatio = $_.bluePixels / $taskBaseline } })
}
$taskJson = $taskReport | ConvertTo-Json -Depth 6
if ($OutputPath) { Set-Content -LiteralPath $OutputPath -Value $taskJson }
Write-Output $taskJson
