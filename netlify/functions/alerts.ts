import { randomUUID } from "node:crypto";
import { cloudStore } from "../../lib/server/netlifyStorage";
import { evaluateRules, exchangeSource, processDeliveries } from "../../lib/server/alertService";
import { siteAccessConfig } from "../../lib/server/siteAccess";

/** Netlify invokes scheduled functions privately, only on published deploys. */
export default async function alerts() {
  // An unconfigured upload must not evaluate rules or send notifications.
  if (!siteAccessConfig()) throw new Error("Configure private site access before enabling server alerts.");
  const storage = cloudStore(), key = "leases/alert-evaluator.json";
  const previous = await storage.getWithMetadata(key, { type: "json" });
  if (previous && !previous.etag) throw new Error("Missing evaluator lease concurrency token.");
  const lease = previous?.data as { until?: number } | undefined;
  if ((lease?.until ?? 0) > Date.now()) return;
  const owner = randomUUID();
  const acquired = await storage.setJSON(key, { owner, until: Date.now() + 45_000 }, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
  if (!acquired.modified) return;
  if (!acquired.etag) throw new Error("Missing acquired evaluator lease concurrency token.");
  try {
    const result = await evaluateRules(exchangeSource());
    await processDeliveries();
    console.log(JSON.stringify({ evaluated: result.evaluated, fired: result.fired, errors: result.errors.length }));
  } finally {
    // Conditional release cannot clear a successor's lease, even after a timeout.
    await storage.setJSON(key, { owner, until: 0 }, { onlyIfMatch: acquired.etag });
  }
}

export const config = { schedule: "* * * * *" };
