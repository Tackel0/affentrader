import { describe, expect, it } from "vitest";
import {
  EMPTY_TREE,
  MAX_DEPTH,
  buildTree,
  canMoveGroup,
  createGroup,
  deleteGroup,
  depthOf,
  groupDescendants,
  moveDrawings,
  moveGroup,
  prune,
  renameDrawing,
  renameGroup,
  toggleCollapsed,
  type DrawingInfo,
  type DrawingTreeState,
} from "@/lib/drawings/tree";

const d = (id: string, visible = true, locked = false): DrawingInfo => ({ id, type: "trendline", visible, locked });
const build = () => {
  let state: DrawingTreeState = EMPTY_TREE;
  const a = createGroup(state, "Levels");
  state = a.state;
  const b = createGroup(state, "Support", a.id);
  state = b.state;
  state = moveDrawings(state, ["d1", "d2"], a.id!);
  state = moveDrawings(state, ["d3"], b.id!);
  return { state, a: a.id!, b: b.id! };
};

describe("groups", () => {
  it("creates nested groups and assigns drawings to them", () => {
    const { state, a, b } = build();
    expect(state.groups.map((g) => g.name)).toEqual(["Levels", "Support"]);
    expect(depthOf(state, b)).toBe(2);
    expect(groupDescendants(state, a)).toEqual([a, b]);
    expect(state.assignments).toEqual({ d1: a, d2: a, d3: b });
  });
  it("refuses unknown parents, over-deep nesting and cycles", () => {
    let { state, a, b } = build();
    expect(createGroup(state, "x", "missing").state.groups.at(-1)?.parent).toBeNull();
    let parent: string | null = b;
    for (let i = 0; i < MAX_DEPTH; i++) {
      const next = createGroup(state, `g${i}`, parent);
      state = next.state;
      if (next.id) parent = next.id;
    }
    expect(createGroup(state, "too deep", parent).id).toBeNull();
    expect(canMoveGroup(state, a, b)).toBe(false);
    expect(canMoveGroup(state, a, a)).toBe(false);
    expect(moveGroup(state, a, b)).toBe(state);
  });
  it("renames, collapses and names drawings", () => {
    const { state, a } = build();
    expect(renameGroup(state, a, "  Key levels  ").groups[0].name).toBe("Key levels");
    expect(toggleCollapsed(state, a).groups[0].collapsed).toBe(true);
    const named = renameDrawing(state, "d1", "Daily high");
    expect(named.names.d1).toBe("Daily high");
    expect(renameDrawing(named, "d1", "").names.d1).toBeUndefined();
  });
  it("moves groups under another group when legal", () => {
    let { state, a } = build();
    const other = createGroup(state, "Targets");
    state = moveGroup(other.state, other.id!, a);
    expect(state.groups.find((g) => g.id === other.id)?.parent).toBe(a);
  });
});

describe("deleting groups", () => {
  it("promotes contents to the parent when only the group is removed", () => {
    const { state, a, b } = build();
    const result = deleteGroup(state, b);
    expect(result.removedDrawings).toEqual([]);
    expect(result.state.assignments.d3).toBe(a);
    const top = deleteGroup(state, a);
    expect(top.state.groups).toHaveLength(1);
    expect(top.state.groups[0].parent).toBeNull();
    expect(top.state.assignments.d1).toBeUndefined();
    expect(top.state.assignments.d3).toBe(b);
  });
  it("returns every drawing under the group when contents are deleted too", () => {
    const { state, a } = build();
    const result = deleteGroup(state, a, true);
    expect(result.removedDrawings.sort()).toEqual(["d1", "d2", "d3"]);
    expect(result.state.groups).toEqual([]);
    expect(result.state.assignments).toEqual({});
  });
});

describe("tree view", () => {
  it("places drawings under their groups, rolls up visibility and lock state", () => {
    const { state, a } = build();
    const drawings = [d("d1"), d("d2", false), d("d3", true, true), d("d4")];
    const tree = buildTree(state, drawings);
    expect(tree.map((n) => n.kind)).toEqual(["group", "drawing"]);
    const group = tree[0];
    if (group.kind !== "group") throw new Error("expected a group");
    expect(group.group.id).toBe(a);
    expect(group.drawingIds.sort()).toEqual(["d1", "d2", "d3"]);
    expect(group.visible).toBe("mixed");
    expect(group.locked).toBe("mixed");
    expect(group.children.map((n) => n.kind)).toEqual(["group", "drawing", "drawing"]);
  });
  it("treats assignments to missing groups as top level and survives corrupt cycles", () => {
    const state: DrawingTreeState = {
      groups: [
        { id: "x", name: "X", parent: "y", collapsed: false },
        { id: "y", name: "Y", parent: "x", collapsed: false },
      ],
      assignments: { d1: "ghost" },
      names: {},
    };
    const tree = buildTree(state, [d("d1")]);
    expect(tree.some((n) => n.kind === "drawing")).toBe(true);
  });
  it("prunes assignments of drawings that were deleted", () => {
    const { state } = build();
    const pruned = prune(state, new Set(["d1"]));
    expect(Object.keys(pruned.assignments)).toEqual(["d1"]);
    expect(prune(pruned, new Set(["d1"]))).toBe(pruned);
  });
});
