$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectPath
$runtimePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
if (Test-Path -LiteralPath (Join-Path $runtimePath 'node\bin\node.exe')) {
  $env:PATH = "$(Join-Path $runtimePath 'node\bin');$(Join-Path $runtimePath 'bin\fallback');$env:PATH"
}
$packageManager = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $packageManager) { throw 'pnpm was not found. Install Node.js and pnpm, then start this launcher again.' }
$selectedPort = 3000
while ($selectedPort -le 3010) {
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:$selectedPort" -UseBasicParsing -TimeoutSec 2
    if ($response.Content -match 'AffenTerminal|Affentrader') {
      Write-Host "AffenTerminal is already running: http://localhost:$selectedPort" -ForegroundColor Green
      Write-Host 'Open this URL in your browser. You can close this launcher.'
      Read-Host 'Press Enter to close' | Out-Null
      exit 0
    }
    $selectedPort++
  } catch {
    $listener = Get-NetTCPConnection -LocalPort $selectedPort -State Listen -ErrorAction SilentlyContinue
    if ($listener) { $selectedPort++ } else { break }
  }
}
if ($selectedPort -gt 3010) { throw 'Ports 3000-3010 are occupied. Free a port and run the launcher again.' }
if (-not (Test-Path -LiteralPath 'node_modules')) { & $packageManager.Source install; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' } }
if (-not (Test-Path -LiteralPath '.next\BUILD_ID')) { Write-Host 'Building AffenTerminal...'; & $packageManager.Source run build; if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' } }
# The server key unlocks server-side alerts, webhooks, push and publishing. It is created here
# (the server uses the same file) so it can be shown once without starting the app first.
$dataDir = if ($env:AFFENTRADER_DATA) { $env:AFFENTRADER_DATA } else { Join-Path $projectPath '.data' }
$keyFile = Join-Path $dataDir 'access-key.txt'
$serverKey = if (Test-Path -LiteralPath $keyFile) { (Get-Content -LiteralPath $keyFile -Raw).Trim() } else { '' }
if ($serverKey -notmatch '^[a-f0-9]{48}$') {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $serverKey = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  [System.IO.File]::WriteAllText($keyFile, "$serverKey`n")
}
Write-Host "AffenTerminal: http://localhost:$selectedPort (Standalone GUI: http://localhost:$selectedPort/terminal)" -ForegroundColor Green
Write-Host "Server access key (paste into the Server field of the alert form to enable server alerts, push and publishing):" -ForegroundColor Yellow
Write-Host "  $serverKey"
Write-Host "  Stored in $keyFile - keep it private."
Write-Host 'Keep this window open while using the workspace. Press Ctrl+C to stop.'
& $packageManager.Source run start --port $selectedPort
exit $LASTEXITCODE
