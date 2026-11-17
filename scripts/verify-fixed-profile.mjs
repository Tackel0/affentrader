import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const bundle = await build({ entryPoints: ["tests/browser/fixed-profile.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fixed profile capacity fixture</title>
<style>body{margin:0;background:#131722;color:#d1d4dc;font:14px Arial}header{padding:12px}h1{font-size:18px}button{padding:8px;margin:0 8px 8px 0}output{display:block}#chart{height:540px}</style>
<header><h1>Fixed profile · SIMULATED TEST FIXTURE</h1><p>No exchange connection or workspace changes. Static profile supports 5,001 bars; developing profiles are bounded at 5,000.</p><button id="develop" disabled>Calculate 5,000 developing bars</button><button id="fail" disabled>Exceed developing capacity</button><button id="recover" disabled>Recover static profile</button><button id="pulse">Responsiveness counter: 0</button><output id="status">INITIALIZIZING</output><output id="heartbeat"></output></header><div id="chart"></div><script type="module" src="/fixture.js"></script></html>`;
createServer(async (request, response) => {
  if (request.url === "/") { response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); response.end(html); }
  else if (request.url === "/fixture.js") { response.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); response.end(bundle.outputFiles[0].contents); }
  else if (request.url === "/workers/fixed-profile.js") { response.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); response.end(await readFile("public/workers/fixed-profile.js")); }
  else { response.writeHead(404); response.end(); }
}).listen(4319, "127.0.0.1", () => process.stdout.write("Fixed profile fixture: http://127.0.0.1:4319 (loopback only)\n"));
