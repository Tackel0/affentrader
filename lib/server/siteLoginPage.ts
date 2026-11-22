import { azureDeploymentDate, deploymentDay } from "@/lib/azureDeploymentDate";
import { SESSION_DAYS } from "./siteAccess";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export type SignInMode = "legacy" | "account" | "register";
const signInLink = (mode: SignInMode, next: string) => `/login?${new URLSearchParams({ mode, next })}`;

function shell(content: string): string {
  const deployedAt = azureDeploymentDate(process.env.CONTAINER_APP_REVISION);
  const deployment = deployedAt
    ? `<p class="hint"><time datetime="${deployedAt.toISOString()}">Letztes Update ${deploymentDay.format(deployedAt)}</time></p>`
    : "";
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#131722"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="AffenTerminal"><meta name="robots" content="noindex,nofollow"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><title>Affentrader · Zugang</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:calc(16px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));background:#0b0e14;color:#e5e9f0;font:16px system-ui,sans-serif}.card{width:100%;max-width:450px;border:1px solid #2b3342;border-radius:16px;background:#141923;padding:clamp(18px,6vw,30px);box-shadow:0 20px 80px #0005}.brand{color:#73a5ff;font-size:12px;font-weight:700;letter-spacing:.14em}h1{font-size:25px;margin:14px 0 8px}p{color:#a5afbe;line-height:1.5;margin:8px 0}label{display:block;margin:12px 0 6px;font-weight:600}input,button,.action{font:inherit;width:100%;border-radius:8px;min-height:44px;padding:10px 12px}input{color:#fff;background:#0b0e14;border:1px solid #45516a}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #98bcff;outline-offset:3px}button,.action{margin-top:12px;border:0;background:#2f67d1;color:white;font-weight:650;cursor:pointer}.action{display:block;text-align:center;text-decoration:none;background:#252e41;border:1px solid #45516a}nav{display:flex;flex-wrap:wrap;gap:0 12px;margin-top:12px}nav a{display:inline-flex;align-items:center;min-height:36px;color:#adcaff}.error{color:#ffa9a9}.hint{font-size:12px;margin-bottom:0}.email{overflow-wrap:anywhere}
</style></head><body><main class="card"><div class="brand">AFFENTERMINAL</div>${content}${deployment}</main></body></html>`;
}

export function siteLoginPage(next: string, error = "", mode: SignInMode = "legacy", google = false): string {
  const signIn = mode === "account";
  const register = mode === "register";
  const hidden = `<input type="hidden" name="next" value="${escapeHtml(next)}">`;
  const googleLink = google && !register ? `<a class="action" href="${escapeHtml(`/api/account/google/start?${new URLSearchParams({ next })}`)}">Mit Google anmelden</a>` : "";
  const nav = [
    ...(signIn ? [] : [`<a href="${escapeHtml(signInLink("account", next))}">Konto anmelden</a>`]),
    ...(register ? [] : [`<a href="${escapeHtml(signInLink("register", next))}">Konto erstellen</a>`]),
    ...(mode === "legacy" ? [] : [`<a href="${escapeHtml(signInLink("legacy", next))}">Website-Passwort</a>`]),
  ].join("");
  const form = mode === "legacy" ? `<p>Öffne den Workspace mit dem Website-Passwort oder nutze dein persönliches Konto.</p>
    <form action="/login" method="post">${hidden}<label for="password">Website-Passwort</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="512" required autofocus><button type="submit">Website öffnen</button></form>`
    : `<form action="/api/account/${register ? "register" : "login"}" method="post">${hidden}
    <label for="email">E-Mail</label><input id="email" name="email" type="email" autocomplete="username" maxlength="254" required autofocus>
    <label for="password">${register ? "Eigenes Passwort" : "Passwort"}</label><input id="password" name="password" type="password" autocomplete="${register ? "new-password" : "current-password"}" ${register ? 'minlength="10"' : ""} maxlength="512" required>
    ${register ? '<label for="invite">Website-Passwort zur Freischaltung</label><input id="invite" name="invite" type="password" autocomplete="off" maxlength="512" required>' : ""}
    <button type="submit">${register ? "Konto erstellen" : "Anmelden"}</button></form>`;
  return shell(`<h1>${register ? "Konto erstellen" : signIn ? "Konto anmelden" : "Privater Workspace"}</h1>${form}${googleLink}
    ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}<nav aria-label="Anmeldeoptionen">${nav}</nav>
    <p class="hint">Du bleibst in diesem Browser bis zu ${SESSION_DAYS} Tage angemeldet.</p>`);
}

export function accountOverviewPage(current: { email: string; googleLinked: boolean; passwordEnabled: boolean } | null, google: boolean, error = "", updated?: string | null): string {
  const connection = current
    ? current.googleLinked ? "<p>Google ist mit deinem Konto verknüpft.</p>"
      : google ? '<form action="/api/account/google/start" method="post"><button type="submit">Google verknüpfen</button></form>' : "<p>Die Google-Anmeldung ist für diese Instanz noch nicht eingerichtet.</p>"
    : google ? '<a class="action" href="/api/account/google/start">Konto mit Google öffnen</a>' : "";
  const security = current ? `<details style="margin-top:16px;border-top:1px solid #45516a;padding-top:8px"><summary style="cursor:pointer;min-height:44px;align-content:center;font-weight:650">Anmeldung und Geräte</summary>
    ${current.passwordEnabled ? `<form action="/api/account/password" method="post">
      <label for="current-password">Aktuelles Passwort</label><input id="current-password" name="current" type="password" autocomplete="current-password" maxlength="512" required>
      <label for="new-password">Neues Passwort</label><input id="new-password" name="new" type="password" autocomplete="new-password" minlength="10" maxlength="512" required>
      <label for="confirm-password">Neues Passwort wiederholen</label><input id="confirm-password" name="confirm" type="password" autocomplete="new-password" minlength="10" maxlength="512" required>
      <button type="submit">Passwort ändern</button><p class="hint">Damit werden andere Kontositzungen beendet.</p></form>` : ""}
    <form action="/api/account/sessions" method="post"><button type="submit">Andere Kontositzungen beenden</button></form></details>` : "";
  const message = current && updated === "password" ? "Passwort geändert. Andere Kontositzungen wurden beendet."
    : current && updated === "sessions" ? "Andere Kontositzungen wurden beendet." : "";
  return shell(`<h1>Konto</h1>${current ? `<p class="email">${escapeHtml(current.email)}</p><p>Dein persönlicher Workspace synchronisiert sich beim Öffnen des Hauptcharts.</p>`
    : '<p>Du nutzt den Workspace mit dem Website-Passwort. Melde dich an oder erstelle ein persönliches Konto für die geräteübergreifende Synchronisierung.</p><nav><a href="/login?mode=account">Konto anmelden</a><a href="/login?mode=register">Konto erstellen</a></nav>'}
    ${connection}${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}${message ? `<p role="status">${message}</p>` : ""}${security}<a class="action" href="/">Zum Workspace</a>
    <form action="/logout" method="post"><button type="submit">Abmelden</button></form>`);
}
