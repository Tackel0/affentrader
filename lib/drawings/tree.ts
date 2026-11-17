/**
 * Object-tree model for chart drawings: nested groups and names layered over
 * Vela's flat drawing list. Pure functions over a plain state value so the
 * grouping rules can be tested without a chart.
 */
export interface DrawingGroup {
  id: string;
  name: string;
  /** Parent group id, or null for a top-level group. */
  parent: string | null;
  collapsed: boolean;
}

export interface DrawingTreeState {
  groups: DrawingGroup[];
  /** Drawing id → group id. */
  assignments: Record<string, string>;
  /** Custom display names by drawing id. */
  names: Record<string, string>;
}

export const EMPTY_TREE: DrawingTreeState = { groups: [], assignments: {}, names: {} };

export interface DrawingInfo {
  id: string;
  type: string;
  visible: boolean;
  locked: boolean;
}

export type TreeNode =
  | {
      kind: "group";
      group: DrawingGroup;
      children: TreeNode[];
      /** Every drawing id under this group, at any depth. */
      drawingIds: string[];
      visible: boolean | "mixed";
      locked: boolean | "mixed";
    }
  | { kind: "drawing"; drawing: DrawingInfo };

export const MAX_GROUPS = 200;
export const MAX_DEPTH = 6;

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()));

export function depthOf(state: DrawingTreeState, groupId: string | null): number {
  let depth = 0;
  let current = groupId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    depth++;
    current = state.groups.find((g) => g.id === current)?.parent ?? null;
  }
  return depth;
}

/** Group ids at and below `groupId`. */
export function groupDescendants(state: DrawingTreeState, groupId: string): string[] {
  const out = [groupId];
  for (let i = 0; i < out.length; i++)
    for (const g of state.groups) if (g.parent === out[i] && !out.includes(g.id)) out.push(g.id);
  return out;
}

export function createGroup(
  state: DrawingTreeState,
  name: string,
  parent: string | null = null,
  drawingIds: readonly string[] = [],
): { state: DrawingTreeState; id: string | null } {
  if (state.groups.length >= MAX_GROUPS) return { state, id: null };
  if (parent && !state.groups.some((g) => g.id === parent)) parent = null;
  if (depthOf(state, parent) >= MAX_DEPTH) return { state, id: null };
  const id = uid();
  const group: DrawingGroup = { id, name: name.trim().slice(0, 40) || "Group", parent, collapsed: false };
  const assignments = { ...state.assignments };
  for (const d of drawingIds) assignments[d] = id;
  return { state: { ...state, groups: [...state.groups, group], assignments }, id };
}

export function renameGroup(state: DrawingTreeState, id: string, name: string): DrawingTreeState {
  return {
    ...state,
    groups: state.groups.map((g) => (g.id === id ? { ...g, name: name.trim().slice(0, 40) || g.name } : g)),
  };
}

export function toggleCollapsed(state: DrawingTreeState, id: string): DrawingTreeState {
  return { ...state, groups: state.groups.map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g)) };
}

export function renameDrawing(state: DrawingTreeState, id: string, name: string): DrawingTreeState {
  const names = { ...state.names };
  const clean = name.trim().slice(0, 60);
  if (clean) names[id] = clean;
  else delete names[id];
  return { ...state, names };
}

/** Move drawings into a group (or to the top level with `null`). */
export function moveDrawings(
  state: DrawingTreeState,
  ids: readonly string[],
  groupId: string | null,
): DrawingTreeState {
  if (groupId && !state.groups.some((g) => g.id === groupId)) return state;
  const assignments = { ...state.assignments };
  for (const id of ids) {
    if (groupId) assignments[id] = groupId;
    else delete assignments[id];
  }
  return { ...state, assignments };
}

/** Can `groupId` become a child of `parent` without a cycle or exceeding the depth limit? */
export function canMoveGroup(state: DrawingTreeState, groupId: string, parent: string | null): boolean {
  if (parent === groupId) return false;
  if (parent && groupDescendants(state, groupId).includes(parent)) return false;
  const subtree = groupDescendants(state, groupId);
  const deepest = Math.max(...subtree.map((id) => depthOf(state, id) - depthOf(state, groupId)));
  return depthOf(state, parent) + 1 + deepest <= MAX_DEPTH;
}

export function moveGroup(state: DrawingTreeState, groupId: string, parent: string | null): DrawingTreeState {
  if (!canMoveGroup(state, groupId, parent)) return state;
  return { ...state, groups: state.groups.map((g) => (g.id === groupId ? { ...g, parent } : g)) };
}

/**
 * Delete a group. Its drawings and subgroups move up one level unless
 * `deleteContents` is set, in which case the drawing ids to remove are returned.
 */
export function deleteGroup(
  state: DrawingTreeState,
  id: string,
  deleteContents = false,
  drawingIds: readonly string[] = Object.keys(state.assignments),
): { state: DrawingTreeState; removedDrawings: string[] } {
  const group = state.groups.find((g) => g.id === id);
  if (!group) return { state, removedDrawings: [] };
  if (deleteContents) {
    const doomed = new Set(groupDescendants(state, id));
    const removed = drawingIds.filter((d) => doomed.has(state.assignments[d]));
    const assignments = { ...state.assignments };
    const names = { ...state.names };
    for (const d of removed) {
      delete assignments[d];
      delete names[d];
    }
    return {
      state: { groups: state.groups.filter((g) => !doomed.has(g.id)), assignments, names },
      removedDrawings: removed,
    };
  }
  const assignments = { ...state.assignments };
  for (const [d, g] of Object.entries(assignments)) {
    if (g === id) {
      if (group.parent) assignments[d] = group.parent;
      else delete assignments[d];
    }
  }
  return {
    state: {
      ...state,
      groups: state.groups
        .filter((g) => g.id !== id)
        .map((g) => (g.parent === id ? { ...g, parent: group.parent } : g)),
      assignments,
    },
    removedDrawings: [],
  };
}

/** Forget assignments and names of drawings that no longer exist. */
export function prune(state: DrawingTreeState, liveIds: ReadonlySet<string>): DrawingTreeState {
  const assignments = Object.fromEntries(Object.entries(state.assignments).filter(([d]) => liveIds.has(d)));
  const names = Object.fromEntries(Object.entries(state.names).filter(([d]) => liveIds.has(d)));
  const same =
    Object.keys(assignments).length === Object.keys(state.assignments).length &&
    Object.keys(names).length === Object.keys(state.names).length;
  return same ? state : { ...state, assignments, names };
}

const combine = (values: boolean[]): boolean | "mixed" =>
  values.length === 0 ? false : values.every((v) => v) ? true : values.some((v) => v) ? "mixed" : false;

/** Arrange drawings and groups into a tree; groups first, drawings in z-order. */
export function buildTree(state: DrawingTreeState, drawings: readonly DrawingInfo[]): TreeNode[] {
  const known = new Set(state.groups.map((g) => g.id));
  const byGroup = new Map<string | null, DrawingInfo[]>();
  for (const d of drawings) {
    const g = state.assignments[d.id];
    const key = g && known.has(g) ? g : null;
    byGroup.set(key, [...(byGroup.get(key) ?? []), d]);
  }
  const build = (parent: string | null, seen: Set<string>): TreeNode[] => {
    const groups = state.groups
      .filter((g) => (g.parent && known.has(g.parent) ? g.parent : null) === parent && !seen.has(g.id))
      .map((group): TreeNode => {
        const nextSeen = new Set(seen).add(group.id);
        const children = build(group.id, nextSeen);
        const drawingIds = collect(children);
        const items = drawings.filter((d) => drawingIds.includes(d.id));
        return {
          kind: "group",
          group,
          children,
          drawingIds,
          visible: combine(items.map((d) => d.visible)),
          locked: combine(items.map((d) => d.locked)),
        };
      });
    const own = (byGroup.get(parent) ?? []).map((drawing): TreeNode => ({ kind: "drawing", drawing }));
    return [...groups, ...own];
  };
  return build(null, new Set());
}

function collect(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => (n.kind === "drawing" ? [n.drawing.id] : n.drawingIds));
}
