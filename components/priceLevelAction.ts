import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";

interface PressState {
  timer: ReturnType<typeof setTimeout> | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  pointerId: number | undefined;
  x: number;
  y: number;
  suppressClick: boolean;
}

const pressMap = new WeakMap<EventTarget, PressState>();
const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 10;

function clearTimers(state: PressState) {
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  if (state.cleanupTimer !== null) {
    clearTimeout(state.cleanupTimer);
    state.cleanupTimer = null;
  }
}

export function priceLevelAction(draw: () => void) {
  const finishPointer = (event: PointerEvent) => {
    const target = event.currentTarget;
    const state = pressMap.get(target);
    if (!state) return;
    if (event.pointerId !== undefined && state.pointerId !== undefined && event.pointerId !== state.pointerId) return;
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (!state.suppressClick) {
      clearTimers(state);
      pressMap.delete(target);
    } else if (state.cleanupTimer === null) {
      state.cleanupTimer = setTimeout(() => {
        if (pressMap.get(target) === state) pressMap.delete(target);
      }, 1000);
    }
  };

  return {
    onContextMenu(event: MouseEvent) {
      event.preventDefault();
      draw();
    },
    onKeyDown(event: KeyboardEvent) {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      if (!event.repeat) draw();
    },
    onPointerDown(event: PointerEvent) {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      const target = event.currentTarget;
      const prior = pressMap.get(target);
      if (prior) clearTimers(prior);
      const state: PressState = {
        timer: null,
        cleanupTimer: null,
        pointerId: event.pointerId,
        x: Number.isFinite(event.clientX) ? event.clientX : 0,
        y: Number.isFinite(event.clientY) ? event.clientY : 0,
        suppressClick: false,
      };
      state.timer = setTimeout(() => {
        state.timer = null;
        if (target instanceof Node && !target.isConnected) {
          if (pressMap.get(target) === state) pressMap.delete(target);
          return;
        }
        state.suppressClick = true;
        draw();
      }, LONG_PRESS_MS);
      pressMap.set(target, state);
    },
    onPointerMove(event: PointerEvent) {
      const target = event.currentTarget;
      const state = pressMap.get(target);
      if (!state || state.timer === null) return;
      if (event.pointerId !== undefined && state.pointerId !== undefined && event.pointerId !== state.pointerId) return;
      const x = Number.isFinite(event.clientX) ? event.clientX : state.x;
      const y = Number.isFinite(event.clientY) ? event.clientY : state.y;
      if (Math.hypot(x - state.x, y - state.y) > MOVE_CANCEL_PX) {
        clearTimers(state);
        pressMap.delete(target);
      }
    },
    onPointerUp: finishPointer,
    onPointerCancel: finishPointer,
    onClickCapture(event: MouseEvent) {
      const target = event.currentTarget;
      const state = pressMap.get(target);
      if (!state?.suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      clearTimers(state);
      pressMap.delete(target);
    },
  };
}
