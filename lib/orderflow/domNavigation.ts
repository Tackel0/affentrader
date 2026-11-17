export type DomFollowMode = "auto" | "fixed" | "timed";
export interface DomNavigation { center: number; hovered: boolean; leftAt: number | null; scrollTarget: number | null }
export const domNavigation = (target: number): DomNavigation => ({ center: target, hovered: false, leftAt: null, scrollTarget: null });
export function followDom(state: DomNavigation, input: { target: number; halfRows: number; mode: DomFollowMode; delay: number; now: number }): DomNavigation {
  const { target, halfRows, mode, delay, now } = input;
  if (mode === "fixed") return state;
  // Explicit browsing stays put until the market actually moves or the pointer
  // leaves. A clock/quantity-only refresh must not undo a wheel step.
  if ((state.hovered || mode === "auto") && state.scrollTarget === target) return state;
  if (mode === "auto") {
    if (state.hovered && Math.abs(target - state.center) <= halfRows) return state;
  } else if (state.hovered || state.leftAt !== null && now - state.leftAt < delay) return state;
  return state.center === target && state.scrollTarget === null ? state : { ...state, center: target, scrollTarget: null };
}
export function scrollDom(state: DomNavigation, rows: number, target: number): DomNavigation {
  if (!Number.isSafeInteger(rows)) return state;
  const center = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER - 101, state.center + rows));
  return { ...state, center, scrollTarget: target };
}
