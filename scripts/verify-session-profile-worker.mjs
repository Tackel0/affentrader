import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const bundle = await build({ entryPoints: ["tests/browser/session-profile.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Session profile worker verification</title>
<style>body{margin:0;background:#131722;color:#d1d4dc;font:14px Arial}header{padding:12px}h1{font-size:18px}button{padding:8px;margin:0 8px 8px 0}output{display:block;padding:4px}#chart{height:540px}</style>
<header><h1>Session Volume Profile · SIMULATED TEST FIXTURE</h1><p>100,000 executions. Real native Vela indicator, production worker and painter. No exchange connection or workspace changes.</p>
<button id="load" disabled>Load 100,000 executions</button><button id="row" disabled>Set row size 2</button><button id="fail" disabled>Exceed row capacity</button><button id="race" disabled>Rapid row 1 then 4</button><button id="hide" disabled>Hide profile</button><button id="show" disabled>Show profile</button><button id="reset" disabled>Reset source</button><button id="pulse">Responsiveness counter: 0</button><output id="status">Initializing</output><output id="heartbeat"></output></header><div id="chart"></div><script type="module" src="/fixture.js"></script></html>`;
createServer(async (request, response) => {
  if (request.url === "/") { response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); response.end(html); }
  else if (request.url === "/fixture.js") { response.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); response.end(bundle.outputFiles[0].contents); }
  else if (request.url === "/workers/session-profile.js") { response.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); response.end(await readFile("public/workers/session-profile.js")); }
  else { response.writeHead(404); response.end(); }
}).listen(4320, "127.0.0.1", () => process.stdout.write("Session profile worker fixture: http://127.0.0.1:4320 (loopback only)\n"));
