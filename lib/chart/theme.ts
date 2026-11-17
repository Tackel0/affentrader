import type { VelaTheme } from "@luxalgo/vela";
import type { WorkspaceTheme } from "@/types/workspace";
export function chartTheme(theme: WorkspaceTheme): VelaTheme {
  return {
    background: theme === "light" ? "#ffffff" : "#000000",
    textColor: theme === "light" ? "#1f1f1f" : "#b8b8b8",
    gridColor: theme === "light" ? "#f0f0f0" : "#1a1a1a",
    borderColor: theme === "light" ? "#e0e0e0" : "#282828",
    upColor: "#089981",
    downColor: "#f23645",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif',
  };
}
