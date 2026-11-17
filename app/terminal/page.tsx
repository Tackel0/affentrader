import type { TerminalView } from "@/lib/terminal/commands";
import { AffenTerminalWindow } from "@/components/AffenTerminalWindow";
import { DeploymentDate } from "../DeploymentDate";

const VALID_VIEWS = new Set<TerminalView>([
  "opps",
  "fa",
  "scan",
  "markets",
  "compare",
  "capm",
  "macro",
  "news",
  "heatmap",
  "osint",
  "help",
]);

export default async function TerminalPage({ searchParams }: PageProps<"/terminal">) {
  const { view, ticker } = await searchParams;
  const firstView = Array.isArray(view) ? view[0] : view;
  const firstTicker = Array.isArray(ticker) ? ticker[0] : ticker;
  const rawView = (firstView ?? "opps").toLowerCase() as TerminalView;
  const initialView: TerminalView = VALID_VIEWS.has(rawView) ? rawView : "opps";
  const initialTicker = firstTicker?.replace(/^YF:/i, "").trim().toUpperCase() || "QCOM";
  return (
    <AffenTerminalWindow
      initialView={initialView}
      initialTicker={initialTicker}
      deployment={<DeploymentDate />}
    />
  );
}
