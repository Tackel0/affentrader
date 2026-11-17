import type { KeyboardEvent, MouseEvent } from "react";

export function priceLevelAction(draw: () => void) {
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
  };
}
