import { build } from "esbuild";
import { createServer } from "node:http";
const bundle = await build({ entryPoints: ["tests/browser/anchored-vwap.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anchored VWAP source fixture</title>
<style>body{margin:0;background:#131722;color:#d1d4dc;font:14px Arial}header{padding:12px}h1{font-size:18px}button{padding:8px;margin:0 8px 8px 0}output{display:block}#chart{height:540px}</style>
<header><h1>Anchored VWAP · SIMULATED TEST FIXTURE</h1><p>No exchange connection or workspace changes. Native Vela painting with production Anchored VWAP calculation.</p><button id="zero" disabled>Remove all volume</button><button id="missing" disabled>Drop anchor history</button><button id="recover" disabled>Recover weighted source</button><output id="status">INITIALIZING</output></header><div id="chart"></div><script type="module" src="/fixture.js"></script></html>`;
createServer((request, response) => {
  if (request.url === "/") { response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); response.end(html); }
  else if (request.url === "/fixture.js") { response.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); response.end(bundle.outputFiles[0].contents); }
  else { response.writeHead(404); response.end(); }
}).listen(4320, "127.0.0.1", () => process.stdout.write("Anchored VWAP fixture: http://127.0.0.1:4320 (loopback only)\n"));
