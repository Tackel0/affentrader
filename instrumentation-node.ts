import { startAlertRunner } from "./lib/server/alertRunner";
import { accessKey } from "./lib/server/security";
import { dataDir } from "./lib/server/storage";
import { usesNetlifyStorage } from "./lib/server/netlifyStorage";

if (!usesNetlifyStorage()) {
  startAlertRunner();
  void accessKey().then(() =>
  console.log(
    `[affentrader] Server access key is available in ${dataDir()}/access-key.txt`,
  ),
  );
}
