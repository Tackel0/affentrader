param(
  [switch]$Build,
  [string]$ContextDir
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output = Join-Path $projectRoot 'artifacts/affentrader-azure.zip'
$staging = if ($ContextDir) { [IO.Path]::GetFullPath($ContextDir) } else { Join-Path $projectRoot 'artifacts/.azure-standalone-staging' }
$runtimePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
if (Test-Path -LiteralPath (Join-Path $runtimePath 'node\bin\node.exe')) {
  $env:PATH = "$(Join-Path $runtimePath 'node\bin');$(Join-Path $runtimePath 'bin\fallback');$env:PATH"
}

if ($Build -or -not (Test-Path -LiteralPath (Join-Path $projectRoot '.next/standalone/server.js'))) {
  Push-Location -LiteralPath $projectRoot
  try {
    & pnpm run build
    if ($LASTEXITCODE -ne 0) { throw "pnpm run build failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

$standaloneDir = Join-Path $projectRoot '.next/standalone'
$staticDir = Join-Path $projectRoot '.next/static'
$publicDir = Join-Path $projectRoot 'public'
if (-not (Test-Path -LiteralPath (Join-Path $standaloneDir 'server.js'))) { throw 'Missing .next/standalone/server.js. Ensure output: "standalone" is active and build completed.' }
if (-not (Test-Path -LiteralPath $staticDir)) { throw 'Missing .next/static.' }
if (-not (Test-Path -LiteralPath $publicDir)) { throw 'Missing public/.' }

[IO.Directory]::CreateDirectory((Join-Path $projectRoot 'artifacts')) | Out-Null
if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }

try {
  # Flatten/dereference pnpm standalone node_modules without symlinks or .pnpm store nesting so the bundle runs identically on Linux.
  $stageScript = @'
const fs = require("node:fs");
const path = require("node:path");

const [standaloneDir, staticDir, publicDir, staging] = process.argv.slice(2);
const forbidden = /(?:^|\/)(\.data|\.env[^/]*|\.netlify[^/]*|artifacts|\.git)(?:\/|$)|(?:^|\/)access-key\.txt$|(?:^|\/)\.next\/cache(?:\/|$)|@img[+/]sharp-win32/i;

function keep(src) {
  const norm = src.replaceAll("\\", "/");
  return !forbidden.test(norm);
}

function listPackages(nmDir) {
  const out = [];
  if (!fs.existsSync(nmDir)) return out;
  for (const ent of fs.readdirSync(nmDir, { withFileTypes: true })) {
    if (ent.name === ".pnpm" || ent.name === ".bin") continue;
    const full = path.join(nmDir, ent.name);
    if (ent.name.startsWith("@")) {
      if (!fs.existsSync(full)) continue;
      for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
        out.push({ name: `${ent.name}/${sub.name}`, path: path.join(full, sub.name) });
      }
    } else {
      out.push({ name: ent.name, path: full });
    }
  }
  return out;
}

function copyPkgFiles(realSrc, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const ent of fs.readdirSync(realSrc, { withFileTypes: true })) {
    if (ent.name === "node_modules") continue;
    const s = path.join(realSrc, ent.name);
    const d = path.join(destDir, ent.name);
    if (!keep(s)) continue;
    fs.cpSync(s, d, { recursive: true, dereference: true, force: true, filter: keep });
  }
}

fs.mkdirSync(staging, { recursive: true });
for (const ent of fs.readdirSync(standaloneDir, { withFileTypes: true })) {
  if (ent.name === "node_modules") continue;
  const s = path.join(standaloneDir, ent.name);
  if (!keep(s)) continue;
  fs.cpSync(s, path.join(staging, ent.name), { recursive: true, dereference: true, force: true, filter: keep });
}

// Reconstruct symlink-free nested/hoisted node_modules from traced pnpm packages
const rootNmSrc = path.join(standaloneDir, "node_modules");
const rootNmDst = path.join(staging, "node_modules");
fs.mkdirSync(rootNmDst, { recursive: true });

const hoisted = new Map();
const queue = [];

function enqueuePkg(pkgName, srcPath, preferredParentDest, ancestors) {
  let realSrc;
  try {
    realSrc = fs.realpathSync(srcPath);
  } catch {
    return;
  }
  if (!keep(realSrc)) return;
  if (ancestors.get(pkgName) === realSrc) return;

  let destPkg;
  let nextAncestors;
  if (!hoisted.has(pkgName)) {
    hoisted.set(pkgName, realSrc);
    destPkg = path.join(rootNmDst, ...pkgName.split("/"));
    nextAncestors = new Map(ancestors);
    nextAncestors.set(pkgName, realSrc);
  } else if (hoisted.get(pkgName) === realSrc && preferredParentDest === null) {
    return;
  } else if (hoisted.get(pkgName) === realSrc && !ancestors.has(pkgName)) {
    return;
  } else {
    destPkg = path.join(preferredParentDest, "node_modules", ...pkgName.split("/"));
    nextAncestors = new Map(ancestors);
    nextAncestors.set(pkgName, realSrc);
  }

  copyPkgFiles(realSrc, destPkg);
  queue.push({ pkgName, realSrc, destPkg, ancestors: nextAncestors });
}

for (const pkg of listPackages(rootNmSrc)) {
  enqueuePkg(pkg.name, pkg.path, null, new Map());
}

while (queue.length > 0) {
  const item = queue.shift();
  const localNm = path.join(item.realSrc, "node_modules");
  const pnpmParentNm = item.pkgName.startsWith("@")
    ? path.dirname(path.dirname(item.realSrc))
    : path.dirname(item.realSrc);

  const deps = [];
  if (fs.existsSync(localNm)) deps.push(...listPackages(localNm));
  if (path.basename(pnpmParentNm) === "node_modules") {
    for (const sib of listPackages(pnpmParentNm)) {
      if (sib.name !== item.pkgName) deps.push(sib);
    }
  }
  for (const dep of deps) {
    enqueuePkg(dep.name, dep.path, item.destPkg, item.ancestors);
  }
}

fs.cpSync(staticDir, path.join(staging, ".next", "static"), { recursive: true, dereference: true, force: true });
fs.cpSync(publicDir, path.join(staging, "public"), { recursive: true, dereference: true, force: true });
'@
  $stageScript | & node - $standaloneDir $staticDir $publicDir $staging
  if ($LASTEXITCODE -ne 0) { throw "Staging script failed with exit code $LASTEXITCODE" }

  if ($ContextDir) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'azure.Dockerfile') -Destination (Join-Path $staging 'Dockerfile') -Force
    $allFiles = Get-ChildItem -LiteralPath $staging -Recurse -Force -File
    foreach ($file in $allFiles) {
      if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Symlink/reparse point refused: $($file.FullName)" }
    }
    [PSCustomObject]@{ ContextDir = $staging; Files = $allFiles.Count }
    return
  }

  if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Force }
  $stream = [IO.File]::Open($output, [IO.FileMode]::Create)
  $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
  $stagePrefix = $staging.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  try {
    $allFiles = Get-ChildItem -LiteralPath $staging -Recurse -Force -File | Sort-Object FullName
    foreach ($file in $allFiles) {
      if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Symlink/reparse point refused in Azure package: $($file.FullName)" }
      $relative = $file.FullName.Substring($stagePrefix.Length).Replace('\', '/')
      if ($relative -match '(^|/)(\.env[^/]*|\.data|\.netlify[^/]*|artifacts|\.git)(/|$)' -or $relative -match '(^|/)access-key\.txt$') {
        throw "Private path refused in Azure package: $relative"
      }
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally {
    $archive.Dispose()
    $stream.Dispose()
  }

  $check = [IO.Compression.ZipFile]::OpenRead($output)
  try {
    $entries = @($check.Entries.FullName)
    foreach ($required in @('server.js', 'package.json', 'public/sw.js', 'public/icon.svg')) {
      if ($required -notin $entries) { throw "Missing required entry in Azure ZIP: $required" }
    }
    if (-not ($entries | Where-Object { $_ -like '.next/static/*' } | Select-Object -First 1)) {
      throw 'Missing .next/static/* entries in Azure ZIP.'
    }
    [PSCustomObject]@{
      Package = $output
      Files   = $entries.Count
      Bytes   = (Get-Item -LiteralPath $output).Length
      SHA256  = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash
    }
  } finally {
    $check.Dispose()
  }
} finally {
  if (-not $ContextDir -and (Test-Path -LiteralPath $staging)) {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  }
}
