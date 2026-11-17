$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bundle = Join-Path ([IO.Path]::GetTempPath()) ('affentrader-kraken-' + [guid]::NewGuid() + '.mjs')
Push-Location -LiteralPath $root
try {
  & ./node_modules/.bin/esbuild.cmd scripts/verify-kraken-recovery-live.ts --bundle --platform=node --format=esm "--outfile=$bundle"
  if ($LASTEXITCODE -ne 0) { throw 'Could not build the Kraken live verifier.' }
  & node $bundle
  if ($LASTEXITCODE -ne 0) { throw 'Kraken live verification failed.' }
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $bundle) { Remove-Item -LiteralPath $bundle }
}
