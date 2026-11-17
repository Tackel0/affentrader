export async function register() {
  // The evaluator uses Node file and network APIs, so it only exists on the Node server.
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}
