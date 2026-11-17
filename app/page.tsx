import { connection } from "next/server";
import TradingWorkspace from "@/components/TradingWorkspace";
import { DeploymentDate } from "./DeploymentDate";

export default async function Page() {
  await connection();
  return <TradingWorkspace deployment={<DeploymentDate />} />;
}
