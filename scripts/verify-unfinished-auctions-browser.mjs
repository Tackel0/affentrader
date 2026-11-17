import { build } from "esbuild";
import { createServer } from "node:http";
const bundle = await build({ entryPoints: ["tests/browser/unfinished-auctions.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unfinished auctions verification</title>
<style>body{margin:0;background:white;color:#131722;font:14px Arial}header{padding:12px}h1{font-size:18px}button{padding:8px;margin:0 8px 8px 0}output{display:block}#chart{height:550px}</style>
<header><h1>Unfinished auctions · SIMULATED TEST FIXTURE</h1><p>Both sides traded at the outer rows. Red high edge 103, green low edge 100. Later inclusive candle ranges stop the rays; gaps remain unknown.</p>
<button id="untested" disabled>No later revisits</button><button id="revisited" disabled>High at 12:03 / low at 12:05</button><button id="rays" disabled>Toggle rays</button><button id="dust" disabled>Toggle compact-zero dust</button><output id="status">Initializing</output></header><div id="chart"></div><script type="module" src="/fixture.js"></script></html>`;
createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); res.end(html); }
  else if (req.url === "/fixture.js") { res.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); res.end(bundle.outputFiles[0].contents); }
  else { res.writeHead(404); res.end(); }
}).listen(4321, "127.0.0.1", () => process.stdout.write("Unfinished auctions fixture: http://127.0.0.1:4321\n"));
