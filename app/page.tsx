import TradingWorkspace from "@/components/TradingWorkspace";
import { DeploymentDate } from "./DeploymentDate";

export default async function Page({ searchParams }: PageProps<"/">) {
  const { panel } = await searchParams;
  const initialSidebar = panel === "watchlist" || panel === "alerts" ? panel : undefined;
  return <TradingWorkspace deployment={<DeploymentDate />} initialSidebar={initialSidebar} />;
}
