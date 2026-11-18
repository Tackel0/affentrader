import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("CI/CD workflow & container hardening", () => {
  it("hardens .github/workflows/deploy-azure.yml to Node-24 actions, ubuntu-24.04, 4-job gates, and automatic rollback", () => {
    const yml = fs.readFileSync(path.join(ROOT, ".github/workflows/deploy-azure.yml"), "utf8");

    // Triggers
    expect(yml).toMatch(/push:\s*\n\s*branches:\s*\n\s*-\s*main/);
    expect(yml).toMatch(/pull_request:\s*\n\s*branches:\s*\n\s*-\s*main/);
    expect(yml).toContain("workflow_dispatch:");

    // Runner and Node-24 action upgrades (no ubuntu-latest or deprecated Node-20 tags)
    expect(yml).not.toContain("ubuntu-latest");
    expect(yml).toContain("runs-on: ubuntu-24.04");
    expect(yml).toContain("actions/checkout@v6");
    expect(yml).toContain("pnpm/action-setup@v5");
    expect(yml).toContain("actions/setup-node@v6");
    expect(yml).toContain("actions/cache@v5");
    expect(yml).toContain("actions/upload-artifact@v7");
    expect(yml).toContain("actions/download-artifact@v8");
    expect(yml).toContain("azure/login@v3");
    expect(yml).not.toMatch(/actions\/checkout@v[1-5]\b/);
    expect(yml).not.toMatch(/actions\/setup-node@v[1-5]\b/);
    expect(yml).not.toMatch(/pnpm\/action-setup@v[1-4]\b/);
    expect(yml).not.toMatch(/azure\/login@v[12]\b/);

    // 4-job graph & gates
    expect(yml).toContain("\n  verify:\n");
    expect(yml).toContain("\n  e2e_browser:\n");
    expect(yml).toContain("\n  mobile_viewport_audit:\n");
    expect(yml).toContain("\n  deploy:\n");
    expect(yml).toContain("needs: [verify, e2e_browser, mobile_viewport_audit]");
    expect(yml).toContain("github.event_name != 'pull_request'");
    expect(yml).toContain(".next/cache");
    expect(yml).toContain("node scripts/verify-terminal-e2e-browser.mjs");
    expect(yml).toContain("node scripts/verify-mobile-viewports.mjs --standalone-dir");

    // Live /api/health smoke test & automatic rollback in Single and Multiple revision modes
    expect(yml).toContain("${LIVE_BASE}/api/health");
    expect(yml).toContain("REV_MODE=");
    expect(yml).toContain("PREV_REVISION=");
    expect(yml).toContain("PREV_IMAGE=");
    expect(yml).toContain("az containerapp ingress traffic set");
    expect(yml).toContain("az containerapp revision deactivate");
    expect(yml).toContain('RB_SUFFIX="r${RB_UTC}-${SHORT_SHA8}"');
  });

  it("hardens scripts/azure.Dockerfile with non-root user and Node-native /api/health HEALTHCHECK", () => {
    const dockerfile = fs.readFileSync(path.join(ROOT, "scripts/azure.Dockerfile"), "utf8");
    expect(dockerfile).toContain("FROM node:22-bookworm-slim");
    expect(dockerfile).toContain("USER nextjs");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("/api/health");
    expect(dockerfile).not.toMatch(/\bcurl\b|\bwget\b/i);
  });

  it("covers all 4 viewports and 8 AffenTerminal modules in scripts/verify-mobile-viewports.mjs", () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts/verify-mobile-viewports.mjs"), "utf8");
    for (const vp of ["360x800", "390x844", "768x1024", "1440x900"]) {
      expect(script).toContain(vp);
    }
    for (const mod of ["OPPS", "FA", "SCAN", "MARKETS", "OSINT", "HEATMAP", "CAPM", "NEWS"]) {
      expect(script).toContain(`"${mod}"`);
    }
    expect(script).toContain("MOBILE VIEWPORT AUDIT PASS");
  });
});
