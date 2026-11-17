import { afterEach, describe, expect, it, vi } from "vitest";
import { scryptSync } from "node:crypto";
import { NextRequest } from "next/server";
import { metadata, viewport } from "@/app/layout";
import { proxy } from "@/proxy";
import { scaleExitLevels, validateExitLevels, type ExitLevel } from "@/lib/trading/exitLevels";

const salt = "c".repeat(32);
const passwordHash = `${salt}:${scryptSync("pw-check", salt, 64).toString("hex")}`;

describe("Mobile PWA metadata, /login CSP/safe-area & multi-leg exit scaling", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exports mobile-first PWA viewport and Apple Home-Screen metadata from app/layout.tsx", () => {
    expect(viewport).toEqual(
      expect.objectContaining({
        width: "device-width",
        initialScale: 1,
        viewportFit: "cover",
        themeColor: "#131722",
      }),
    );
    expect(metadata.manifest).toBe("/manifest.webmanifest");
    expect(metadata.appleWebApp).toEqual(
      expect.objectContaining({
        capable: true,
        title: "AffenTerminal",
        statusBarStyle: "black-translucent",
      }),
    );
    expect(metadata.icons).toEqual(
      expect.objectContaining({
        apple: expect.arrayContaining([
          expect.objectContaining({ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }),
        ]),
      }),
    );
  });

  it("renders PWA-ready /login HTML with viewport-fit=cover, safe-area padding & image/manifest CSP", async () => {
    vi.stubEnv("AFFENTRADER_SITE_PASSWORD_HASH", passwordHash);
    vi.stubEnv("AFFENTRADER_SITE_SESSION_SECRET", "d".repeat(64));

    const res = await proxy(
      new NextRequest("https://terminal.example.com/login?next=%2Fterminal", {
        method: "GET",
        headers: { host: "terminal.example.com", "x-forwarded-proto": "https" },
      }),
    );
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("img-src 'self'");
    expect(csp).toContain("manifest-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'none'");

    const html = await res.text();
    expect(html).toContain('content="width=device-width,initial-scale=1,viewport-fit=cover"');
    expect(html).toContain("env(safe-area-inset-top)");
    expect(html).toContain("env(safe-area-inset-bottom)");
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">');
  });

  it("scales 50/50 and partial exitLevels safely across order quantities without exceeding nextOrderQty", () => {
    const fiftyFifty: ExitLevel[] = [
      { quantity: 0.5, takeProfit: 120, stopLoss: 90 },
      { quantity: 0.5, takeProfit: 140, stopLoss: 90 },
    ];

    for (const nextQty of [0.0001, 0.0003, 0.01, 0.33333333, 1.25, 3, 250, 500]) {
      const scaled = scaleExitLevels(fiftyFifty, 1, nextQty);
      expect(scaled).toHaveLength(2);
      expect(validateExitLevels(scaled, nextQty)).toBeNull();
      const total = scaled!.reduce((s, l) => s + l.quantity, 0);
      expect(total).toBeCloseTo(nextQty, 8);
    }

    // Sub-unit crypto size downscaling preserves non-negative valid totals
    const micro = scaleExitLevels(
      [
        { quantity: 0.005, takeProfit: 124, stopLoss: 92 },
        { quantity: 0.005, takeProfit: 136, stopLoss: 92 },
      ],
      0.01,
      0.0003,
    );
    expect(validateExitLevels(micro, 0.0003)).toBeNull();
    expect(micro).toEqual([
      { quantity: 0.00015, takeProfit: 124, stopLoss: 92 },
      { quantity: 0.00015, takeProfit: 136, stopLoss: 92 },
    ]);

    // Partial exit levels (2 + 3 = 5 out of order qty 10) scale proportionally to [4, 6] for order qty 20
    const partial = scaleExitLevels(
      [
        { quantity: 2, takeProfit: 110, stopLoss: 90 },
        { quantity: 3, takeProfit: 120, stopLoss: 85 },
      ],
      10,
      20,
    );
    expect(validateExitLevels(partial, 20)).toBeNull();
    expect(partial).toEqual([
      { quantity: 4, takeProfit: 110, stopLoss: 90 },
      { quantity: 6, takeProfit: 120, stopLoss: 85 },
    ]);

    // Partial 1-leg exit preserves order fraction (1/2 -> 2/4)
    expect(scaleExitLevels([{ quantity: 1, takeProfit: 110, stopLoss: null }], 2, 4)).toEqual([
      { quantity: 2, takeProfit: 110, stopLoss: null },
    ]);
    // Single full leg updates cleanly; temporary zero previousOrderQty falls back to sum of levels
    expect(scaleExitLevels([{ quantity: 2, takeProfit: 110, stopLoss: null }], 2, 5)).toEqual([
      { quantity: 5, takeProfit: 110, stopLoss: null },
    ]);
    // Micro nextOrderQty that cannot hold multiple >=1e-12 legs collapses to valid 1-leg exit instead of returning oversized levels
    const collapsedMicro = scaleExitLevels(fiftyFifty, 1, 1.5e-12);
    expect(validateExitLevels(collapsedMicro, 1.5e-12)).toBeNull();
    expect(collapsedMicro).toEqual([{ quantity: 1.5e-12, takeProfit: 120, stopLoss: 90 }]);
    expect(scaleExitLevels(fiftyFifty, 1, 1e-13)).toBeUndefined();

    const recovered = scaleExitLevels(fiftyFifty, 0, 2);
    expect(recovered).toEqual([
      { quantity: 1, takeProfit: 120, stopLoss: 90 },
      { quantity: 1, takeProfit: 140, stopLoss: 90 },
    ]);
    const unchanged = scaleExitLevels(fiftyFifty, 1, 0);
    expect(unchanged).toEqual(fiftyFifty);
    expect(unchanged?.[0]).not.toBe(fiftyFifty[0]);
    expect(scaleExitLevels(undefined, 1, 5)).toBeUndefined();
  });

  it("serves /sw.js without auth with Cache-Control: no-store and X-Content-Type-Options: nosniff", async () => {
    const res = await proxy(
      new NextRequest("https://terminal.example.com/sw.js", {
        method: "GET",
        headers: { host: "terminal.example.com", "x-forwarded-proto": "https" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
