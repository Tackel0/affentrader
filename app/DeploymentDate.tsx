import { azureDeploymentDate, deploymentDay } from "@/lib/azureDeploymentDate";
import { DeploymentUpdate } from "@/components/DeploymentUpdate";

export function DeploymentDate() {
  const revision = process.env.CONTAINER_APP_REVISION;
  if (!revision) return null;
  const deployedAt = azureDeploymentDate(revision);

  return (
    <>
      {deployedAt ? (
        <time className="status-deployment" dateTime={deployedAt.toISOString()}>
          Letztes Update {deploymentDay.format(deployedAt)}
        </time>
      ) : null}
      <DeploymentUpdate loadedRevision={revision} />
    </>
  );
}
