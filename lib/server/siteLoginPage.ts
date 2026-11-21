import { azureDeploymentDate, deploymentDay } from "@/lib/azureDeploymentDate";
import { SESSION_DAYS } from "./siteAccess";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function siteLoginPage(next: string, error = ""): string {
  const deployedAt = azureDeploymentDate(process.env.CONTAINER_APP_REVISION);
  const deployment = deployedAt
    ? `<p class="hint"><time datetime="${deployedAt.toISOString()}">Letztes Update ${deploymentDay.format(deployedAt)}</time></p>`
    : "";
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#131722"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="AffenTerminal"><meta name="robots" content="noindex,nofollow"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><title>Affentrader · Zugang</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:calc(24px + env(safe-area-inset-top)) calc(24px + env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) calc(24px + env(safe-area-inset-left));background:#0b0e14;color:#e5e9f0;font:16px system-ui,sans-serif}.card{width:100%;max-width:420px;border:1px solid #2b3342;border-radius:18px;background:#141923;padding:32px;box-shadow:0 20px 80px #0005}.brand{color:#73a5ff;font-size:12px;font-weight:700;letter-spacing:.14em}h1{font-size:27px;margin:18px 0 10px}p{color:#a5afbe;line-height:1.5}label{display:block;margin:26px 0 8px;font-weight:600}input,button{font:inherit;width:100%;border-radius:8px;padding:13px}input{color:#fff;background:#0b0e14;border:1px solid #45516a}input:focus-visible,button:focus-visible{outline:3px solid #98bcff;outline-offset:3px}button{margin-top:18px;border:0;background:#2f67d1;color:white;font-weight:650;cursor:pointer}.error{color:#ffa9a9;min-height:24px;margin-bottom:0}.hint{font-size:12px;margin-bottom:0}
</style></head><body><main class="card"><div class="brand">AFFENTRADER</div><h1>Privater Workspace</h1><p>Gib das Passwort ein, um die Website zu öffnen.</p><form action="/login" method="post"><input type="hidden" name="next" value="${escapeHtml(next)}"><label for="password">Passwort</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="512" required autofocus><button type="submit">Website öffnen</button>${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}</form><p class="hint">Du bleibst in diesem Browser ${SESSION_DAYS} Tage angemeldet.</p>${deployment}</main></body></html>`;
}
