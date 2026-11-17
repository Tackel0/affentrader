import { build } from "esbuild";
import { createServer } from "node:http";
const result = await build({ entryPoints: ["tests/browser/native-render.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native rendering regression fixture</title>
<style>body{margin:0;background:#131722;color:#d1d4dc;font:14px Arial}header{padding:12px}h1{font-size:18px}button{padding:8px;margin-right:8px}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:8px}section{min-width:0}h2{font-size:14px}.chart{height:440px}output{display:block;min-height:20px}textarea{box-sizing:border-box;width:100%;height:90px;background:#1e222d;color:#d1d4dc}#failure{max-width:100%}@media(max-width:600px){main{grid-template-columns:1fr}.chart{height:330px}}</style>
<header><h1>Native Vela rendering · SIMULATED TEST FIXTURE</h1><p>No exchange connection, orders or workspace edits. Both native geometry backends and the application canvas layers use the same 600 candles.</p><button id="run" disabled>Run 60 repaint cycles</button><button id="replay" disabled>Start Replay</button><button id="live" disabled>Exit Replay</button><output id="status">INITIALIZING</output></header>
<main>${["canvas2d","webgl2"].map(name=>`<section data-backend="${name}"><h2>${name}</h2><output></output><output class="pixels"></output><div class="chart"></div></section>`).join("")}</main><img id="failure" alt="Failed raster" hidden><label>Raster check report<textarea id="report" readonly></textarea></label><script type="module" src="/fixture.js"></script></html>`;
const server = createServer((request, response) => {
  if (request.url === "/") { response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); response.end(html); }
  else if (request.url === "/fixture.js") { response.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); response.end(result.outputFiles[0].contents); }
  else { response.writeHead(404); response.end(); }
});
server.listen(4318, "127.0.0.1", () => process.stdout.write("Native-render fixture: http://127.0.0.1:4318 (loopback only)\n"));
