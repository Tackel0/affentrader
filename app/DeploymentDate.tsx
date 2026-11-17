import { azureDeploymentDate, deploymentDay } from "@/lib/azureDeploymentDate";

export function DeploymentDate() {
  const deployedAt = azureDeploymentDate(process.env.CONTAINER_APP_REVISION);
  if (!deployedAt) return null;

  return (
    <time className="status-deployment" dateTime={deployedAt.toISOString()}>
      Letztes Update {deploymentDay.format(deployedAt)}
    </time>
  );
}
