import { writeFile } from "node:fs/promises";
const report = { at: new Date().toISOString(), endpoint: "wss://stream.data.alpaca.markets/v2/iex", credentialsUsed: false, welcome: false, unauthenticatedHistoryStatus: null, authenticatedAccountVerified: false };
try {
  report.welcome = await new Promise((resolve, reject) => {
    const socket = new WebSocket(report.endpoint), timeout = setTimeout(() => { socket.close(); reject(new Error("IEX welcome timed out.")); }, 15_000);
    socket.addEventListener("message", event => {
      let messages; try { messages = JSON.parse(String(event.data)); } catch { return; }
      if (Array.isArray(messages) && messages.some(value => value.T === "success" && value.msg === "connected")) { clearTimeout(timeout); socket.close(); resolve(true); }
    });
    socket.addEventListener("error", () => { clearTimeout(timeout); socket.close(); reject(new Error("The public IEX stream could not be reached.")); });
  });
  const response = await fetch("https://data.alpaca.markets/v2/stocks/bars?symbols=AAPL&timeframe=1Min&feed=iex&limit=1", { signal: AbortSignal.timeout(15_000) });
  report.unauthenticatedHistoryStatus = response.status;
  if (![401, 403].includes(response.status)) throw new Error("Unexpected unauthenticated history status.");
} catch (error) { report.error = error instanceof Error ? error.message : "Transport probe failed."; process.exitCode = 1; }
await writeFile("artifacts/alpaca-iex-transport.json", JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
