import { randomBytes, scryptSync, createHmac } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run this setup directly in an interactive terminal.");
for (const file of [".netlify-private.env", ".netlify-server-key.txt"]) {
  try { await access(file); }
  catch (error) { if (error.code === "ENOENT") continue; throw error; }
  throw new Error(`Vorhandene Datei ${file} wird nicht ueberschrieben. Fuer einen gewollten Wechsel bitte zuerst selbst sichern.`);
}
const terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
// readline still handles editing, but suppresses typed password characters.
terminal._writeToOutput = function () {};
const question = prompt => new Promise(resolve => {
  process.stdout.write(prompt);
  terminal.question("", value => { process.stdout.write("\n"); resolve(value); });
});
try {
  const password = await question("Neues Website-Passwort (mindestens 12 Zeichen, Eingabe unsichtbar): ");
  const confirmation = await question("Website-Passwort wiederholen: ");
  if (password !== confirmation) throw new Error("Die Passwoerter stimmen nicht ueberein.");
  if (password.length < 12 || Buffer.byteLength(password) > 512) throw new Error("Bitte 12 bis 512 Zeichen verwenden (maximal 512 UTF-8-Bytes).");
  const salt = randomBytes(16).toString("hex"), secret = randomBytes(32).toString("hex");
  const hash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  await writeFile(".netlify-private.env", `AFFENTRADER_SITE_PASSWORD_HASH=${hash}\nAFFENTRADER_SITE_SESSION_SECRET=${secret}\nAFFENTRADER_STORAGE=netlify-blobs\n`, { mode: 0o600, flag: "wx" });
  const key = createHmac("sha256", secret).update("affentrader:server-access:v1").digest("hex").slice(0, 48);
  await writeFile(".netlify-server-key.txt", `${key}\n`, { mode: 0o600, flag: "wx" });
  console.log("Netlify-Konfiguration in .netlify-private.env erstellt. Nicht hochladen oder weitergeben.");
  console.log("Diese Datei ausschliesslich in Netlifys Environment variables importieren (Builds und Functions, Production).");
  console.log("Der separate Server-Zugriffsschluessel liegt in .netlify-server-key.txt. Bei Bedarf in der App unter Server eintragen.");
} finally { terminal.close(); }
