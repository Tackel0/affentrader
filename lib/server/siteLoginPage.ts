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
  const legalFooter = `<footer class="legal"><p class="hint">Reines Chart- &amp; Analyse-Tool — keine Anlageberatung, kein Angebot zum Kauf oder Verkauf von Finanzinstrumenten.</p><nav aria-label="Rechtliches"><a href="/impressum">Impressum</a><a href="/risikohinweis">Risikohinweis</a><a href="/datenschutz">Datenschutz</a></nav></footer>`;
  const brandMark = `<svg width="28" height="28" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><radialGradient id="lb" cx="50%" cy="14%" r="86%"><stop offset="0%" stop-color="#1B202C"/><stop offset="56%" stop-color="#0A0C12"/><stop offset="100%" stop-color="#040508"/></radialGradient><linearGradient id="lm" x1="20%" y1="10%" x2="80%" y2="92%"><stop offset="0%" stop-color="#F8FAFD"/><stop offset="55%" stop-color="#CFD6E3"/><stop offset="100%" stop-color="#8892A6"/></linearGradient><linearGradient id="la" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FFD66B"/><stop offset="50%" stop-color="#FF9E00"/><stop offset="100%" stop-color="#D97200"/></linearGradient><linearGradient id="lr" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FFF" stop-opacity=".24"/><stop offset="55%" stop-color="#FFF" stop-opacity=".04"/><stop offset="100%" stop-color="#FF9E00" stop-opacity=".28"/></linearGradient></defs><rect width="64" height="64" rx="14.5" fill="url(#lb)"/><rect x=".75" y=".75" width="62.5" height="62.5" rx="13.8" stroke="url(#lr)" stroke-width="1"/><path d="M18.6 27.6C13 27.6 12 34.4 17 36.4" stroke="url(#lm)" stroke-width="2.9" stroke-linecap="round"/><path d="M45.4 27.6C51 27.6 52 34.4 47 36.4" stroke="url(#lm)" stroke-width="2.9" stroke-linecap="round"/><path d="M17.5 29C17.5 17.5 23.2 13 32 13C40.8 13 46.5 17.5 46.5 29C46.5 35.5 44.5 41.5 42 45.5C39.4 49.6 35.8 51.5 32 51.5C28.2 51.5 24.6 49.6 22 45.5C19.5 41.5 17.5 35.5 17.5 29Z" fill="url(#lm)"/><path d="M21.8 27.8C21.8 22.8 25.4 20.6 29.2 22.2C30.6 22.8 31.4 23.7 32 24.6C32.6 23.7 33.4 22.8 34.8 22.2C38.6 20.6 42.2 22.8 42.2 27.8C42.2 30.8 40.7 32.8 39 34C41.2 35.6 42.4 38.2 41.8 41.4C40.9 45.6 37 48.2 32 48.2C27 48.2 23.1 45.6 22.2 41.4C21.6 38.2 22.8 35.6 25 34C23.3 32.8 21.8 30.8 21.8 27.8Z" fill="#090B11"/><circle cx="27.2" cy="28.2" r="2.1" fill="url(#la)"/><circle cx="36.8" cy="28.2" r="2.1" fill="url(#la)"/><path d="M29.3 37.8L32 35.1L34.7 37.8" stroke="url(#la)" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/><line x1="28.2" y1="43" x2="35.8" y2="43" stroke="#CFD6E3" stroke-width="1.7" stroke-linecap="round" stroke-opacity=".65"/></svg>`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#07090E"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="AffenTerminal"><meta name="robots" content="noindex,nofollow"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" type="image/svg+xml" href="/icon.svg"><link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><title>AffenTerminal · Zugang</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:calc(16px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));background:#05070B;color:#F2F5FA;font:16px -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif}.card{width:100%;max-width:450px;border:1px solid #1E2534;border-radius:18px;background:#0C0F16;padding:clamp(20px,6vw,30px);box-shadow:0 24px 80px #000a}.brand{display:flex;align-items:center;gap:10px;color:#F4F6FA;font-size:12px;font-weight:700;letter-spacing:.14em}.brand span{color:#FFB84D}h1{font-size:25px;margin:16px 0 8px;letter-spacing:-.02em}p{color:#9BA6B8;line-height:1.5;margin:8px 0}label{display:block;margin:12px 0 6px;font-weight:600;color:#DCE3EE}input,button,.action{font:inherit;width:100%;border-radius:10px;min-height:44px;padding:10px 12px}input{color:#fff;background:#06080D;border:1px solid #2A3346}input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid #FFB84D;outline-offset:3px}button,.action{margin-top:12px;border:0;background:#FF9E00;color:#07090E;font-weight:700;cursor:pointer}.action{display:block;text-align:center;text-decoration:none;background:#141A26;color:#E8EDF5;border:1px solid #2A3346;font-weight:600}nav{display:flex;flex-wrap:wrap;gap:0 12px;margin-top:12px}nav a{display:inline-flex;align-items:center;min-height:36px;color:#FFB84D;text-decoration-color:rgba(255,184,77,.45)}.error{color:#FF9C9C}.hint{font-size:12px;margin-bottom:0;color:#7D889C}.email{overflow-wrap:anywhere}.legal{margin-top:16px;padding-top:12px;border-top:1px solid #1B2230}.legal nav{margin-top:4px;font-size:12px}.legal nav a{color:#9BA6B8}
</style></head><body><main class="card"><div class="brand">${brandMark}<span>AFFENTERMINAL</span></div>${content}${legalFooter}${deployment}</main></body></html>`;
}

export function siteLoginPage(
  next: string,
  error = "",
  mode: SignInMode = "account",
  google = false,
  passwordGate = false,
): string {
  const effectiveMode: SignInMode = !passwordGate && mode === "legacy" ? "account" : mode;
  const signIn = effectiveMode === "account";
  const register = effectiveMode === "register";
  const hidden = `<input type="hidden" name="next" value="${escapeHtml(next)}">`;
  const googleLink = google && !register ? `<a class="action" href="${escapeHtml(`/api/account/google/start?${new URLSearchParams({ next })}`)}">Mit Google anmelden</a>` : "";
  const nav = [
    ...(signIn ? [] : [`<a href="${escapeHtml(signInLink("account", next))}">Konto anmelden</a>`]),
    ...(register ? [] : [`<a href="${escapeHtml(signInLink("register", next))}">Konto erstellen</a>`]),
    ...(passwordGate && effectiveMode !== "legacy" ? [`<a href="${escapeHtml(signInLink("legacy", next))}">Website-Passwort</a>`] : []),
    ...(!passwordGate ? [`<a href="${escapeHtml(next)}">Ohne Konto weiter</a>`] : []),
  ].join("");
  const form = effectiveMode === "legacy" ? `<p>Öffne den Workspace mit dem Website-Passwort oder nutze dein persönliches Konto.</p>
    <form action="/login" method="post">${hidden}<label for="password">Website-Passwort</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="512" required autofocus><button type="submit">Website öffnen</button></form>`
    : `<p>${register ? "Erstelle ein kostenloses Konto, um Charts, Watchlists und Layouts automatisch über alle Geräte zu synchronisieren." : "Melde dich mit deinem Konto an, um deinen Workspace über alle Geräte zu synchronisieren."}</p>
    <form action="/api/account/${register ? "register" : "login"}" method="post">${hidden}
    <label for="email">E-Mail</label><input id="email" name="email" type="email" autocomplete="username" maxlength="254" required autofocus>
    <label for="password">${register ? "Eigenes Passwort (mind. 10 Zeichen)" : "Passwort"}</label><input id="password" name="password" type="password" autocomplete="${register ? "new-password" : "current-password"}" ${register ? 'minlength="10"' : ""} maxlength="512" required>
    ${register && passwordGate ? '<label for="invite">Website-Passwort zur Freischaltung</label><input id="invite" name="invite" type="password" autocomplete="off" maxlength="512" required>' : ""}
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
  return shell(`<h1>Konto</h1>${current ? `<p class="email">${escapeHtml(current.email)}</p><p>Dein persönlicher Workspace synchronisiert sich automatisch über alle Geräte.</p>`
    : '<p>Du nutzt AffenTerminal aktuell lokal in diesem Browser. Melde dich an oder erstelle ein kostenloses Konto für die automatische Synchronisierung über alle Geräte.</p><nav><a href="/login?mode=account">Konto anmelden</a><a href="/login?mode=register">Konto erstellen</a></nav>'}
    ${connection}${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}${message ? `<p role="status">${message}</p>` : ""}${security}<a class="action" href="/">Zum Workspace</a>
    ${current ? '<form action="/logout" method="post"><button type="submit">Abmelden</button></form>' : ""}`);
}
