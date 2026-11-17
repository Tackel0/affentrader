import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stageAzureStandalone } from "@/scripts/stage-azure-standalone.mjs";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function createFixtureProject(): string {
  const root = makeTempDir("affen-stage-src-");
  const standalone = path.join(root, ".next", "standalone");

  writeFile(path.join(standalone, "server.js"), "console.log('ready');\n");
  writeFile(path.join(standalone, "package.json"), '{"name":"affentrader","private":true}\n');
  writeFile(path.join(standalone, "lib", "helper.js"), "export const ok = true;\n");

  // Forbidden files that must never leak into the staged Azure context
  writeFile(path.join(standalone, ".env.local"), "SECRET=bad\n");
  writeFile(path.join(standalone, ".data", "state.json"), "{}\n");
  writeFile(path.join(standalone, "access-key.txt"), "secret-key\n");

  // pnpm symlink layout with hoisted + sibling conflicting version + win32 sharp exclusion
  const pnpmPkgA = path.join(standalone, "node_modules", ".pnpm", "pkg-a@1.0.0", "node_modules");
  const pkgADir = path.join(pnpmPkgA, "pkg-a");
  writeFile(path.join(pkgADir, "index.js"), "module.exports = 'a1';\n");

  const pnpmDepV1 = path.join(standalone, "node_modules", ".pnpm", "shared@1.0.0", "node_modules", "shared");
  writeFile(path.join(pnpmDepV1, "index.js"), "module.exports = 1;\n");

  const pnpmDepV2 = path.join(standalone, "node_modules", ".pnpm", "shared@2.0.0", "node_modules", "shared");
  writeFile(path.join(pnpmDepV2, "index.js"), "module.exports = 2;\n");

  const pkgWinSharp = path.join(standalone, "node_modules", ".pnpm", "@img+sharp-win32-x64@0.33.0", "node_modules", "@img", "sharp-win32-x64");
  writeFile(path.join(pkgWinSharp, "sharp.node"), "win32");

  // Sibling dep inside pkg-a points to shared@2.0.0 while root hoists shared@1.0.0
  fs.symlinkSync(pnpmDepV2, path.join(pnpmPkgA, "shared"), "dir");
  fs.mkdirSync(path.join(standalone, "node_modules", "@img"), { recursive: true });
  fs.symlinkSync(pkgADir, path.join(standalone, "node_modules", "pkg-a"), "dir");
  fs.symlinkSync(pnpmDepV1, path.join(standalone, "node_modules", "shared"), "dir");
  fs.symlinkSync(pkgWinSharp, path.join(standalone, "node_modules", "@img", "sharp-win32-x64"), "dir");
  fs.symlinkSync(path.join(root, "does-not-exist"), path.join(standalone, "node_modules", "dangling-opt"), "dir");

  writeFile(path.join(root, ".next", "static", "chunks", "main.js"), "// static\n");
  writeFile(path.join(root, ".next", "cache", "stale.bin"), "ignored");
  writeFile(path.join(root, "public", "sw.js"), "// sw\n");
  writeFile(path.join(root, "public", "icon.svg"), "<svg/>\n");
  writeFile(path.join(root, "scripts", "azure.Dockerfile"), "FROM node:22-bookworm-slim\n");

  return root;
}

describe("stage-azure-standalone.mjs", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("stages symlink-free Next.js standalone context inside artifacts without false path rejection or secret leakage", () => {
    const root = createFixtureProject();
    const contextDir = path.join(root, "artifacts", ".azure-standalone-staging");

    const res = stageAzureStandalone({ projectRoot: root, contextDir });
    expect(res.contextDir).toBe(path.resolve(contextDir));
    expect(res.files).toBeGreaterThanOrEqual(8);

    expect(fs.existsSync(path.join(contextDir, "server.js"))).toBe(true);
    expect(fs.existsSync(path.join(contextDir, "Dockerfile"))).toBe(true);
    expect(fs.existsSync(path.join(contextDir, ".next", "static", "chunks", "main.js"))).toBe(true);
    expect(fs.existsSync(path.join(contextDir, "public", "sw.js"))).toBe(true);
    expect(fs.existsSync(path.join(contextDir, "public", "icon.svg"))).toBe(true);

    // Forbidden paths must not exist in staged context
    expect(fs.existsSync(path.join(contextDir, ".env.local"))).toBe(false);
    expect(fs.existsSync(path.join(contextDir, ".data"))).toBe(false);
    expect(fs.existsSync(path.join(contextDir, "access-key.txt"))).toBe(false);
    expect(fs.existsSync(path.join(contextDir, "node_modules", "@img", "sharp-win32-x64"))).toBe(false);

    // Dereferenced hoisted & nested conflicting dependency versions both preserved
    expect(fs.readFileSync(path.join(contextDir, "node_modules", "shared", "index.js"), "utf8")).toContain("1");
    expect(
      fs.readFileSync(path.join(contextDir, "node_modules", "pkg-a", "node_modules", "shared", "index.js"), "utf8"),
    ).toContain("2");

    // Zero symlinks anywhere inside staged directory
    const walkCheck = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        expect(fs.lstatSync(full).isSymbolicLink()).toBe(false);
        if (ent.isDirectory()) walkCheck(full);
      }
    };
    walkCheck(contextDir);
  });

  it("supports omitting Dockerfile when includeDockerfile is false", () => {
    const root = createFixtureProject();
    const contextDir = path.join(root, "out-zip-stage");
    stageAzureStandalone({ projectRoot: root, contextDir, includeDockerfile: false });
    expect(fs.existsSync(path.join(contextDir, "Dockerfile"))).toBe(false);
    expect(fs.existsSync(path.join(contextDir, "server.js"))).toBe(true);
  });
});
