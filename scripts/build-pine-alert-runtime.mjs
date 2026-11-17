import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
const input = await fs.readFile(".generated/strategy-runtime.js", "utf8");
const execution = await Promise.all(["lib/alerts/pineGuest.ts", "lib/alerts/pineSandbox.ts", "lib/alerts/pineSession.ts", "lib/alerts/pineJournal.ts"].map(file => fs.readFile(file, "utf8")));
const hash = createHash("sha256").update(input).update(execution.join("\n")).update("pine-alert-iife-journal-v1").digest("hex");
const output = ".generated/pine-alert-code.js";
try {
  if (await fs.readFile(".generated/pine-alert-code.hash", "utf8") === hash) { await fs.access(output); process.exit(0); }
} catch { /* Missing artifacts are generated from the pinned runtime below. */ }
const result = await build({ stdin: { contents: input, resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", globalName: "PineAlertRuntime", platform: "browser", minify: true, legalComments: "eof" });
await fs.writeFile(output, `// SPDX-License-Identifier: AGPL-3.0-only\n// PineTS 0.13.0, LuxAlgo; isolated alert execution adapter: Affentrader.\nexport const revision=${JSON.stringify(hash)};\nexport default ${JSON.stringify(result.outputFiles[0].text)};\n`);
await fs.writeFile(".generated/pine-alert-code.d.ts", "declare const source: string; export default source; export declare const revision: string;\n");
await fs.writeFile(".generated/pine-alert-code.hash", hash);
