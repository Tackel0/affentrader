import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
const source = await readFile("artifacts/vela-footprint-reference/1-1mg-s23l974.js", "utf8"), sourceHash = createHash("sha256").update(source).digest("hex");
assert.equal(sourceHash, "b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b");
function block(start) { assert.ok(start >= 0); let end = source.indexOf("{", start) + 1, depth = 1; for (; depth && end < source.length; end++) { if (source[end] === "{") depth++; else if (source[end] === "}") depth--; } assert.equal(depth, 0); return source.slice(start, end); }
const regexStart = source.indexOf("var tI=", 1097000), regexEnd = source.indexOf(";function tR", regexStart), paletteStart = source.indexOf("iz={", 1120000), paletteEnd = source.indexOf(";function iq", paletteStart);
assert.ok(regexStart > 0 && regexEnd > regexStart && paletteStart > 0 && paletteEnd > paletteStart);
const names = ["t_", "tw", "tk", "tS", "tA", "tC", "tM", "tE", "tT", "tN", "tR", "tL", "tF", "tB", "t$", "tV", "tz", "tj", "ic", "iu", "ip", "im", "id", "ig", "iy", "ib", "iv", "ix", "i_", "iq", "iU", "iO"];
const painter = block(source.indexOf("!function(e,t){let i=t.hit,r=Math.max(1,i.yBot-i.yTop)", 1130000) + 1);
assert.ok(painter.startsWith("function(e,t){let i=t.hit,r=Math.max(1,i.yBot-i.yTop)"));
const program = `(()=>{${source.slice(regexStart, regexEnd)};const ${source.slice(paletteStart, paletteEnd)};const tO=new Map();${names.map(name => block(source.indexOf(`function ${name}(`, 1097000))).join("\n")}return {prepare:tz,magnifier:${painter}}})()`;
assert.ok(!program.includes("</script"));
const bundle = await build({ entryPoints: ["tests/browser/footprint-magnifier-reference.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Footprint magnifier comparison</title><style>body{margin:12px;background:#fafafa;color:#131722;font:14px Arial}h1{font-size:19px}button{padding:8px}section{display:flex;gap:12px;flex-wrap:wrap}canvas{border:1px solid #ddd;max-width:100%;height:auto}pre{white-space:pre-wrap;font-size:12px}</style><h1>SIMULATED · Complete Shift magnifier comparison</h1><p>Reviewed reference magnifier (left), production magnifier (right). Same observed rows, slots, raw counts and canvas font metrics.</p><button id="run">Run matrix</button> <button id="next">Next differing case</button><output id="status">Initializing</output><section><figure><figcaption>Reference</figcaption><canvas id="reference"></canvas></figure><figure><figcaption>App</figcaption><canvas id="actual"></canvas></figure></section><pre id="report"></pre><script>window.footprintMagnifierReference=${program};window.footprintMagnifierReferenceHash=${JSON.stringify(sourceHash)};</script><script type="module" src="/fixture.js"></script>`;
createServer((req, res) => { if (req.url === "/") { res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }); res.end(html); } else if (req.url === "/fixture.js") { res.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); res.end(bundle.outputFiles[0].contents); } else { res.writeHead(404); res.end(); } }).listen(4321, "127.0.0.1", () => console.log("Footprint magnifier comparison: http://127.0.0.1:4321"));
