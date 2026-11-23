import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve("@luxalgo/vela"));
const BUNDLES = ["chunk-XIRSR3D6.js", "index.cjs", "vela.global.js", "widget.cjs", "workspace.cjs"] as const;

describe("Vela drawing hitboxes & select-first drag protection", () => {
  it("adapts all five pinned Vela bundles with tighter hitboxes, 8px drag slop, and select-first claiming", () => {
    for (const file of BUNDLES) {
      const src = readFileSync(path.join(dist, file), "utf8");
      expect(src, `${file} missing marker`).toContain("/* Affentrader drawing hitboxes v1 */");
      expect(src, `${file} should tighten HIT_TOLERANCE to 4`).toContain("var HIT_TOLERANCE = 4;");
      expect(src, `${file} should define AF_HANDLE_TOLERANCE`).toContain("var AF_HANDLE_TOLERANCE =");
      expect(src, `${file} should define AF_TAP_SELECT_TOLERANCE`).toContain("var AF_TAP_SELECT_TOLERANCE =");
      expect(src, `${file} should raise DrawingInteraction DRAG_SLOP to 8`).toMatch(
        /\/\/ src\/renderers\/native\/drawings\/DrawingInteraction\.ts\n[ \t]*var DRAG_SLOP\d* = 8;/,
      );
      expect(src, `${file} should only claim selected unlocked drawings`).toContain(
        "if (!hit || hit.locked) return false;",
      );
      expect(src, `${file} should require selection before claiming drag`).toContain(
        "return this.deps.selectedIds().has(hit.id);",
      );
      expect(src, `${file} should wire selectAt into onClick`).toContain(
        "if (this.userDrawings?.selectAt?.(x, y)) return;",
      );
    }
  });

  it("never claims pan gestures on unselected or locked drawings, while allowing drag on selected unlocked drawings and armed tools", () => {
    // Mirror the exact patched claim(x, y) decision function from DrawingInteraction
    const makeInteraction = (opts: {
      activeTool: string | null;
      kind?: string;
      hit: { id: string; locked: boolean } | null;
      selected: string[];
    }) => {
      const selectedIds = new Set(opts.selected);
      return {
        deps: {
          activeTool: () => opts.activeTool,
          selectedIds: () => selectedIds,
        },
        state: { kind: opts.kind ?? "idle" },
        hitAt: () => opts.hit,
        claim(x: number, y: number) {
          void x;
          void y;
          if (this.deps.activeTool() != null || this.state.kind !== "idle") return true;
          const hit = this.hitAt();
          if (!hit || hit.locked) return false;
          return this.deps.selectedIds().has(hit.id);
        },
      };
    };

    // Unselected drawing under finger/cursor -> must NOT steal chart pan
    expect(
      makeInteraction({ activeTool: null, hit: { id: "d1", locked: false }, selected: [] }).claim(100, 100),
    ).toBe(false);

    // Locked drawing (even if selected) -> must NOT steal chart pan
    expect(
      makeInteraction({ activeTool: null, hit: { id: "d1", locked: true }, selected: ["d1"] }).claim(100, 100),
    ).toBe(false);

    // Selected unlocked drawing -> CAN be intentionally dragged/resized
    expect(
      makeInteraction({ activeTool: null, hit: { id: "d1", locked: false }, selected: ["d1"] }).claim(100, 100),
    ).toBe(true);

    // Different unselected drawing while another is selected -> must NOT steal pan
    expect(
      makeInteraction({ activeTool: null, hit: { id: "d2", locked: false }, selected: ["d1"] }).claim(100, 100),
    ).toBe(false);

    // Armed drawing tool -> MUST claim press to place anchor
    expect(
      makeInteraction({ activeTool: "trendline", hit: null, selected: [] }).claim(100, 100),
    ).toBe(true);
  });
});
