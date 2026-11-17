import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { AffenTerminalWindow } from "@/components/AffenTerminalWindow";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

declare global {
  interface Window {
    __testHarness: {
      mount: (props?: any) => Promise<void>;
      unmount: () => void;
      getComputedStyle: (selector: string, prop: string) => string | null;
      getAllChipsRadius: () => Array<{ text: string; radius: string }>;
      getGridColumns: () => string | null;
      clickElementText: (text: string) => boolean;
      hasVisibleText: (text: string) => boolean;
      getElementRect: (selector: string) => DOMRect | null;
    };
  }
}

let rootInstance: ReturnType<typeof createRoot> | null = null;

window.__testHarness = {
  mount: async (props = {}) => {
    useWorkspaceStore.setState({ theme: "dark" });
    const container = document.getElementById("terminal-root");
    if (!container) throw new Error("#terminal-root not found");
    if (rootInstance) {
      rootInstance.unmount();
      rootInstance = null;
    }
    rootInstance = createRoot(container);
    rootInstance.render(
      createElement(AffenTerminalWindow, {
        initialView: props.initialView ?? "fa",
        initialTicker: props.initialTicker ?? "INTC",
        ...props,
      })
    );
    // Wait for initial render and data fetch to settle
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
      const btns = container.querySelectorAll("button");
      if (btns.length >= 8) break;
      await new Promise((r) => setTimeout(r, 50));
    }
  },

  unmount: () => {
    if (rootInstance) {
      rootInstance.unmount();
      rootInstance = null;
    }
  },

  getComputedStyle: (selector: string, prop: string) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    return window.getComputedStyle(el).getPropertyValue(prop);
  },

  getAllChipsRadius: () => {
    const chips = Array.from(document.querySelectorAll(".chip"));
    return chips.map((c) => ({
      text: (c.textContent ?? "").trim().slice(0, 30),
      radius: window.getComputedStyle(c).borderRadius,
    }));
  },

  getGridColumns: () => {
    const grid = document.querySelector(".terminal-workspace-grid");
    if (!grid) return null;
    return window.getComputedStyle(grid).gridTemplateColumns;
  },

  clickElementText: (text: string) => {
    const elements = Array.from(document.querySelectorAll("button, [role='radio'], [role='tab'], span, a"));
    const match = elements.find((el) => (el.textContent ?? "").includes(text));
    if (!match) return false;
    (match as HTMLElement).click();
    return true;
  },

  hasVisibleText: (text: string) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if ((node.nodeValue ?? "").includes(text)) {
        const parent = node.parentElement;
        if (parent) {
          const style = window.getComputedStyle(parent);
          if (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0") {
            const rect = parent.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return true;
            }
          }
        }
      }
    }
    return false;
  },

  getElementRect: (selector: string) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    return el.getBoundingClientRect();
  },
};
