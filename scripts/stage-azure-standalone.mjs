import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_REL_RE =
  /(?:^|\/)(?:\.data|\.env[^/]*|\.netlify[^/]*|artifacts|\.git)(?:\/|$)|(?:^|\/)access-key\.txt$|(?:^|\/)\.next\/cache(?:\/|$)|@img[+/]sharp-win32/i;

export function isAllowedRelativePath(relPath) {
  const norm = String(relPath ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!norm) return true;
  return !FORBIDDEN_REL_RE.test(norm);
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

function copyFilteredTree(srcRoot, destRoot, relPrefix = "") {
  fs.mkdirSync(destRoot, { recursive: true });
  for (const ent of fs.readdirSync(srcRoot, { withFileTypes: true })) {
    const src = path.join(srcRoot, ent.name);
    const dst = path.join(destRoot, ent.name);
    const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
    if (!isAllowedRelativePath(rel)) continue;
    let stat;
    try {
      stat = fs.statSync(src);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      copyFilteredTree(src, dst, rel);
    } else if (stat.isFile()) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
}

function copyPkgFiles(realSrc, destDir, pkgName) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const ent of fs.readdirSync(realSrc, { withFileTypes: true })) {
    if (ent.name === "node_modules") continue;
    const src = path.join(realSrc, ent.name);
    const dst = path.join(destDir, ent.name);
    const rel = `node_modules/${pkgName}/${ent.name}`;
    if (!isAllowedRelativePath(rel)) continue;
    let stat;
    try {
      stat = fs.statSync(src);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      copyFilteredTree(src, dst, rel);
    } else if (stat.isFile()) {
      fs.copyFileSync(src, dst);
    }
  }
}

function collectFilesAndVerifyNoSymlinks(dir, rootDir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const lstat = fs.lstatSync(full);
    if (lstat.isSymbolicLink()) {
      throw new Error(`Symlink/reparse point refused in staged context: ${full}`);
    }
    const rel = path.relative(rootDir, full).replaceAll("\\", "/");
    if (
      /(^|\/)(\.env[^/]*|\.data|\.netlify[^/]*|artifacts|\.git)(\/|$)|(^|\/)access-key\.txt$/i.test(
        rel,
      )
    ) {
      throw new Error(`Private/forbidden path refused in staged context: ${rel}`);
    }
    if (lstat.isDirectory()) {
      collectFilesAndVerifyNoSymlinks(full, rootDir, out);
    } else if (lstat.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Stages a symlink-free Next.js standalone build context for Azure Container Apps.
 * @param {{ projectRoot?: string; contextDir?: string; includeDockerfile?: boolean }} [options]
 * @returns {{ contextDir: string; files: number }}
 */
export function stageAzureStandalone({
  projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  contextDir = undefined,
  includeDockerfile = true,
} = {}) {
  const absRoot = path.resolve(projectRoot);
  const absContext = path.resolve(
    contextDir ||
      process.env.APP_CONTEXT_DIR ||
      path.join(absRoot, "artifacts", ".azure-standalone-staging"),
  );
  const standaloneDir = path.join(absRoot, ".next", "standalone");
  const staticDir = path.join(absRoot, ".next", "static");
  const publicDir = path.join(absRoot, "public");
  const dockerfileSrc = path.join(absRoot, "scripts", "azure.Dockerfile");

  if (!fs.existsSync(path.join(standaloneDir, "server.js"))) {
    throw new Error(
      'Missing .next/standalone/server.js. Ensure next.config.ts sets output: "standalone" and pnpm run build completed.',
    );
  }
  if (!fs.existsSync(staticDir)) throw new Error("Missing .next/static.");
  if (!fs.existsSync(publicDir)) throw new Error("Missing public/.");
  if (includeDockerfile && !fs.existsSync(dockerfileSrc)) {
    throw new Error(`Missing Dockerfile template: ${dockerfileSrc}`);
  }

  fs.rmSync(absContext, { recursive: true, force: true });
  fs.mkdirSync(absContext, { recursive: true });

  for (const ent of fs.readdirSync(standaloneDir, { withFileTypes: true })) {
    if (ent.name === "node_modules") continue;
    const src = path.join(standaloneDir, ent.name);
    const dst = path.join(absContext, ent.name);
    if (!isAllowedRelativePath(ent.name)) continue;
    let stat;
    try {
      stat = fs.statSync(src);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      copyFilteredTree(src, dst, ent.name);
    } else if (stat.isFile()) {
      fs.copyFileSync(src, dst);
    }
  }

  const rootNmSrc = path.join(standaloneDir, "node_modules");
  const rootNmDst = path.join(absContext, "node_modules");
  fs.mkdirSync(rootNmDst, { recursive: true });

  const hoisted = new Map();
  const queue = [];

  function enqueuePkg(pkgName, srcPath, preferredParentDest, ancestors) {
    if (!isAllowedRelativePath(`node_modules/${pkgName}`)) return;
    let realSrc;
    try {
      realSrc = fs.realpathSync(srcPath);
    } catch {
      return;
    }
    if (!isAllowedRelativePath(path.relative(standaloneDir, realSrc))) return;
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

    copyPkgFiles(realSrc, destPkg, pkgName);
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

  copyFilteredTree(staticDir, path.join(absContext, ".next", "static"), ".next/static");
  copyFilteredTree(publicDir, path.join(absContext, "public"), "public");
  if (includeDockerfile) {
    fs.copyFileSync(dockerfileSrc, path.join(absContext, "Dockerfile"));
  }

  const files = collectFilesAndVerifyNoSymlinks(absContext, absContext);
  const fileSet = new Set(files);
  const required = ["server.js", "package.json", "public/sw.js", "public/icon.svg"];
  if (includeDockerfile) required.push("Dockerfile");
  for (const entry of required) {
    if (!fileSet.has(entry)) {
      throw new Error(`Missing required entry in staged Azure context: ${entry}`);
    }
  }
  if (!files.some((f) => f.startsWith(".next/static/"))) {
    throw new Error("Missing .next/static/* entries in staged Azure context.");
  }

  return { contextDir: absContext, files: files.length };
}

function parseArgs(argv) {
  const opts = { includeDockerfile: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-dockerfile") {
      opts.includeDockerfile = false;
    } else if (arg === "--context-dir" && argv[i + 1]) {
      opts.contextDir = argv[++i];
    } else if (arg.startsWith("--context-dir=")) {
      opts.contextDir = arg.slice("--context-dir=".length);
    } else if (arg === "--project-root" && argv[i + 1]) {
      opts.projectRoot = argv[++i];
    } else if (arg.startsWith("--project-root=")) {
      opts.projectRoot = arg.slice("--project-root=".length);
    }
  }
  return opts;
}

const isCli = (() => {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isCli) {
  const result = stageAzureStandalone(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify({ ContextDir: result.contextDir, Files: result.files }));
}
