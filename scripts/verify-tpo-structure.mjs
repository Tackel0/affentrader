import { build } from "esbuild";
import { createServer } from "node:http";
const result = await build({ entryPoints: ["tests/browser/tpo-structure.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TPO structure raster verification</title>
<style>body{margin:0;background:#131722;color:#d1d4dc;font:14px system-ui}main{max-width:1100px;margin:auto;padding:20px}h1{font-size:22px}button{padding:8px 12px;margin:4px 8px 8px 0}canvas{display:block;width:100%;height:430px;background:#080a0e}output{display:block;padding:8px 0}textarea{box-sizing:border-box;width:100%;height:95px;background:#1e222d;color:#d1d4dc}#model{overflow-wrap:anywhere;font-family:monospace}</style>
<main><h1>TPO structure · SIMULATED verification fixture</h1><p>The application's actual TPO model and painter. Orange: poor high/low; purple: three interior single-print rows [101, 104). No exchange connection, orders or workspace changes.</p>
<button id="run">Run raster checks</button><button id="revisit">Revisit the zone</button><button id="restore">Restore initial structure</button><output id="status">INITIALIZING</output><canvas aria-label="Simulated TPO structure canvas"></canvas><output id="model"></output>
<p>Pixel readback checks completed Canvas2D output and can affect raster timing. It does not prove stability of every asynchronously presented native chart frame.</p><label>Raster report<textarea id="report" readonly></textarea></label></main><script type="module" src="/fixture.js"></script></html>`;
const server = createServer((request, response) => {
  if (request.url === "/") { response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); response.end(html); }
  else if (request.url === "/fixture.js") { response.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); response.end(result.outputFiles[0].contents); }
  else { response.writeHead(404); response.end(); }
});
server.listen(4319, "127.0.0.1", () => process.stdout.write("TPO structure fixture: http://127.0.0.1:4319 (loopback only)\n"));
