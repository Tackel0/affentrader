import { azureDeploymentDate, deploymentDay } from "@/lib/azureDeploymentDate";

export type LegalPagePath = "/impressum" | "/datenschutz" | "/risikohinweis";

export const LEGAL_PATHS: ReadonlySet<string> = new Set<LegalPagePath>([
  "/impressum",
  "/datenschutz",
  "/risikohinweis",
]);

export interface LegalOperatorInfo {
  name: string;
  businessName: string;
  street: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  vatId: string;
  configured: boolean;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]!);
}

function cleanText(value: unknown, maxLength = 240): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

function sanitizeTelHref(phone: string): string {
  const normalized = phone.replace(/[^\d+]/g, "");
  return normalized ? `tel:${normalized}` : "";
}

function sanitizeMailHref(email: string): string {
  const trimmed = email.trim();
  if (!trimmed || /[\s<>'"\\]/.test(trimmed) || !trimmed.includes("@")) return "";
  return `mailto:${trimmed}`;
}

export function readLegalOperator(env: Record<string, string | undefined> = process.env): LegalOperatorInfo {
  let parsed: Record<string, unknown> = {};
  const rawJson = env.AFFENTRADER_IMPRESSUM_JSON?.trim();
  if (rawJson) {
    try {
      const candidate = JSON.parse(rawJson);
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        parsed = candidate as Record<string, unknown>;
      }
    } catch {
      parsed = {};
    }
  }

  const pick = (jsonKey: string, envKey: string, fallback = ""): string =>
    cleanText(parsed[jsonKey]) || cleanText(env[envKey]) || fallback;

  const name = pick("name", "AFFENTRADER_IMPRESSUM_NAME");
  const businessName = pick("businessName", "AFFENTRADER_IMPRESSUM_BUSINESS");
  const street = pick("street", "AFFENTRADER_IMPRESSUM_STREET");
  const city = pick("city", "AFFENTRADER_IMPRESSUM_CITY");
  const country = pick("country", "AFFENTRADER_IMPRESSUM_COUNTRY", name || street || city ? "Deutschland" : "");
  const phone = pick("phone", "AFFENTRADER_IMPRESSUM_PHONE");
  const email = pick("email", "AFFENTRADER_IMPRESSUM_EMAIL");
  const vatId = pick("vatId", "AFFENTRADER_IMPRESSUM_VAT_ID");

  return {
    name,
    businessName,
    street,
    city,
    country,
    phone,
    email,
    vatId,
    configured: Boolean(name && (street || city || email)),
  };
}

function renderOperatorBlock(op: LegalOperatorInfo): string {
  if (!op.configured) {
    return `<p class="notice">Die Betreiberangaben sind auf dieser Instanz noch nicht über die Server-Umgebungsvariable <code>AFFENTRADER_IMPRESSUM_JSON</code> hinterlegt.</p>`;
  }
  const lines = [
    op.name ? `<strong>${escapeHtml(op.name)}</strong>` : "",
    op.businessName ? `Geschäftsbezeichnung: ${escapeHtml(op.businessName)}` : "",
    op.street ? escapeHtml(op.street) : "",
    op.city ? escapeHtml(op.city) : "",
    op.country ? escapeHtml(op.country) : "",
  ].filter(Boolean);
  return `<address>${lines.join("<br>")}</address>`;
}

function renderContactBlock(op: LegalOperatorInfo): string {
  if (!op.configured || (!op.phone && !op.email)) {
    return `<p class="muted">Kontaktdaten sind auf dieser Instanz noch nicht konfiguriert.</p>`;
  }
  const telHref = sanitizeTelHref(op.phone);
  const mailHref = sanitizeMailHref(op.email);
  const rows: string[] = [];
  if (op.phone) {
    rows.push(
      telHref
        ? `<p>Telefon: <a href="${escapeHtml(telHref)}">${escapeHtml(op.phone)}</a></p>`
        : `<p>Telefon: ${escapeHtml(op.phone)}</p>`,
    );
  }
  if (op.email) {
    rows.push(
      mailHref
        ? `<p>E-Mail: <a href="${escapeHtml(mailHref)}">${escapeHtml(op.email)}</a></p>`
        : `<p>E-Mail: ${escapeHtml(op.email)}</p>`,
    );
  }
  return rows.join("");
}

function legalShell(title: string, activePath: LegalPagePath, bodyHtml: string, env: Record<string, string | undefined> = process.env): string {
  const deployedAt = azureDeploymentDate(env.CONTAINER_APP_REVISION);
  const deployment = deployedAt
    ? `<span class="meta-dot">·</span><time datetime="${deployedAt.toISOString()}">Stand ${deploymentDay.format(deployedAt)}</time>`
    : "";
  const navItems: Array<{ path: LegalPagePath; label: string }> = [
    { path: "/impressum", label: "Impressum" },
    { path: "/risikohinweis", label: "Risikohinweis" },
    { path: "/datenschutz", label: "Datenschutz" },
  ];
  const nav = navItems
    .map((item) =>
      `<a href="${item.path}"${item.path === activePath ? ' aria-current="page" class="active"' : ""}>${item.label}</a>`,
    )
    .join("");

  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#131722"><meta name="robots" content="noindex,nofollow"><link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png"><title>${escapeHtml(title)} · AffenTerminal</title><style>
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;background:#0b0e14;color:#e5e9f0;font:15px/1.6 system-ui,-apple-system,sans-serif;padding:calc(18px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(28px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left))}
.wrap{max-width:760px;margin:0 auto;border:1px solid #2b3342;border-radius:16px;background:#141923;padding:clamp(18px,4vw,34px);box-shadow:0 20px 80px #0005}
.top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding-bottom:14px;border-bottom:1px solid #262e3d;margin-bottom:18px}
.brand{color:#73a5ff;font-size:12px;font-weight:700;letter-spacing:.14em;text-decoration:none}
.tabs{display:flex;flex-wrap:wrap;gap:6px}
.tabs a{color:#adcaff;text-decoration:none;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid transparent}
.tabs a:hover{background:#1d2433}
.tabs a.active{background:#1f2b40;border-color:#3a527a;color:#fff;font-weight:600}
h1{font-size:clamp(22px,4vw,28px);margin:4px 0 12px;line-height:1.25}
h2{font-size:16px;margin:22px 0 8px;color:#dbe7ff}
p,li{color:#b4becd;margin:8px 0}
ul{padding-left:20px;margin:8px 0}
address{font-style:normal;color:#d6deea;line-height:1.65;margin:8px 0}
a{color:#8fb8ff}
a:focus-visible{outline:3px solid #98bcff;outline-offset:2px;border-radius:4px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#0b0e14;border:1px solid #2b3342;padding:1px 5px;border-radius:5px;color:#dbe7ff}
.callout{border:1px solid #594426;background:#211a10;border-radius:12px;padding:14px 16px;margin:14px 0 18px}
.callout strong{color:#ffd28a;display:block;margin-bottom:4px}
.callout p{color:#e7d5b5;margin:4px 0 0}
.notice{border:1px solid #354157;background:#101520;border-radius:10px;padding:12px 14px;color:#c7d1e0}
.muted{color:#8c97a8}
.foot{margin-top:26px;padding-top:14px;border-top:1px solid #262e3d;display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;font-size:13px;color:#8c97a8}
.foot a{color:#adcaff;text-decoration:none}
.foot a:hover{text-decoration:underline}
.meta-dot{opacity:.5}
</style></head><body><main class="wrap"><header class="top"><a class="brand" href="/">AFFENTERMINAL</a><nav class="tabs" aria-label="Rechtliche Seiten">${nav}</nav></header>${bodyHtml}<footer class="foot"><a href="/">Zum Workspace</a><span class="meta-dot">·</span><a href="/login">Anmeldung</a>${deployment}</footer></main></body></html>`;
}

export function renderImpressumPage(env: Record<string, string | undefined> = process.env): string {
  const op = readLegalOperator(env);
  const businessClause = op.businessName ? ` unter der Geschäftsbezeichnung ${escapeHtml(op.businessName)}` : "";
  const operatorIntro = op.configured
    ? `AffenTerminal ist eine browserbasierte Charting-, Marktdaten- und Analyse-Software von ${escapeHtml(op.name)}${businessClause}.`
    : "AffenTerminal ist eine browserbasierte Charting-, Marktdaten- und Analyse-Software.";

  const vatSection = op.vatId
    ? `<h2>Umsatzsteuer-Identifikationsnummer</h2><p>Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: ${escapeHtml(op.vatId)}</p>`
    : "";

  const mstvSection = op.configured
    ? `<h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>${renderOperatorBlock(op)}`
    : "";

  const body = `<h1>Impressum</h1>
<h2>Angaben gemäß § 5 DDG</h2>
${renderOperatorBlock(op)}
<h2>Kontakt</h2>
${renderContactBlock(op)}
${vatSection}
<h2>Zum Angebot</h2>
<p>${operatorIntro} Die Anwendung dient ausschließlich der technischen Visualisierung von Marktdaten, Indikatoren und eigenen Analysen. Es werden keine Finanzinstrumente oder Kryptowerte verwahrt, keine Wertpapierorders im eigenen Namen ausgeführt und keine Anlageberatung oder Anlagevermittlung erbracht. Etwaige Verträge mit Börsen, Brokern oder Datenanbietern bestehen ausschließlich zwischen dem Nutzer und dem jeweiligen Drittanbieter.</p>
<div class="callout"><strong>Wichtiger Hinweis: Keine Anlageberatung</strong><p>Sämtliche dargestellten Kurse, Indikatoren, Strategietests, Screener, Heatmaps, Alarme und Kennzahlen dienen ausschließlich allgemeinen Informationszwecken und stellen weder eine Anlageberatung noch eine Empfehlung zum Kauf oder Verkauf von Wertpapieren, Derivaten oder Kryptowerten dar. <a href="/risikohinweis">Vollständigen Risikohinweis lesen</a>.</p></div>
${mstvSection}
<h2>Haftung für Inhalte und externe Links</h2>
<p>Die Inhalte dieser Web-Anwendung werden mit größtmöglicher Sorgfalt erstellt. Für die Richtigkeit, Vollständigkeit, Verzögerungsfreiheit und Aktualität der aus externen Schnittstellen bezogenen Marktdaten und berechneten Kennzahlen wird jedoch keine Gewähr übernommen. Soweit Verknüpfungen zu externen Websites Dritter enthalten sind, haben wir auf deren Inhalte keinen Einfluss; für die Inhalte verlinkter Seiten ist stets der jeweilige Anbieter oder Betreiber verantwortlich.</p>
<h2>Urheberrecht</h2>
<p>Die durch den Seitenbetreiber erstellten Inhalte und Werke unterliegen dem deutschen Urheberrecht. Verwendete Open-Source-Komponenten und Drittanbieter-Marken (u. a. Vela™, PineTS, Börsen- und Marktdatenanbieter) unterliegen den jeweiligen Lizenz- und Markenrechten ihrer Inhaber.</p>
<h2>Verbraucherstreitbeilegung (§ 36 VSBG)</h2>
<p>Wir sind weder bereit noch verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>`;

  return legalShell("Impressum", "/impressum", body, env);
}

export function renderRisikohinweisPage(env: Record<string, string | undefined> = process.env): string {
  const body = `<h1>Risikohinweis &amp; Haftungsausschluss</h1>
<div class="callout"><strong>Keine Anlageberatung · Hohes Verlustrisiko bis zum Totalverlust</strong><p>Alle Inhalte, Charts, Indikatoren, Screener, Heatmaps, Orderflow-Ansichten, Alarme, Backtests und Kennzahlen in AffenTerminal dienen ausschließlich allgemeinen Informations-, Bildungs- und eigenen Analysezwecken. Sie stellen keine Anlageberatung, keine Anlagevermittlung, keine Finanzportfolioverwaltung und keine Kauf- oder Verkaufsempfehlung dar.</p></div>

<h2>1. Keine Anlage-, Steuer- oder Rechtsberatung</h2>
<p>AffenTerminal erbringt keine regulierten Wertpapierdienstleistungen im Sinne des Wertpapierhandelsgesetzes (WpHG), des Wertpapierinstitutsgesetzes (WpIG), des Kreditwesengesetzes (KWG) oder der MiFID-II-Richtlinie und veröffentlicht keine Finanzanalysen im Sinne der Marktmissbrauchsverordnung (MAR). Die dargestellten Informationen berücksichtigen weder deine persönlichen Anlageziele noch deine finanzielle Situation oder Risikobereitschaft. Sie ersetzen keine individuelle Anlage-, Steuer- oder Rechtsberatung durch entsprechend zugelassene Fachpersonen.</p>

<h2>2. Wesentliche Risiken des Handels</h2>
<ul>
  <li><strong>Totalverlustrisiko:</strong> Der Handel mit Aktien, ETFs, Kryptowerten, Rohstoffen, Indizes, Devisen sowie Derivaten und Perpetual Futures unterliegt starken Kursschwankungen und kann zum vollständigen Verlust des eingesetzten Kapitals führen.</li>
  <li><strong>Hebel- und Liquidationsrisiken:</strong> Beim Handel mit Hebelprodukten, Margin oder Perpetual Futures können bereits geringe Marktbewegungen zu überproportionalen Verlusten bis hin zur Zwangsliquidation oder darüber hinausgehenden Zahlungspflichten führen.</li>
  <li><strong>Kryptowerte &amp; dezentrale Märkte:</strong> Kryptowerte und dezentrale Handelsplätze (z. B. Perpetual DEXs) unterliegen zusätzlichen technischen, regulatorischen, Liquiditäts- und Smart-Contract-Risiken.</li>
  <li><strong>Währungs- und Liquiditätsrisiken:</strong> Fremdwährungspositionen unterliegen Wechselkursschwankungen; außerhalb regulärer Handelszeiten (Pre-/After-Market, Wochenende) können Spreads deutlich ausgeweitet und Liquidität stark eingeschränkt sein.</li>
</ul>

<h2>3. Historische Daten, Backtests &amp; Simulationen</h2>
<p>Vergangene Kursentwicklungen, historische Backtests, Strategie-Optimierungen, Paper-Trading-Simulationen, Signale und Rankings sind kein verlässlicher Indikator für zukünftige Wertentwicklungen. Simulationen berücksichtigen reale Marktfaktoren wie Slippage, Gebühren, Finanzierungssätze (Funding Rates), Teilausführungen oder Handelsunterbrechungen häufig nur vereinfacht.</p>

<h2>4. Keine Gewähr für Marktdaten &amp; Berechnungen</h2>
<p>Kurse, Orderbücher, Trades, Fundamentaldaten, Insider-/SEC-Meldungen, Makro-Daten und Heatmaps werden von externen Drittanbietern bezogen (u. a. Binance, Hyperliquid, Bybit, Kraken, Yahoo Finance, Alpaca, TradingView, SEC, Polymarket). Diese Daten können zeitverzögert, unvollständig, fehlerhaft, uneinheitlich oder vorübergehend nicht verfügbar sein. Dasselbe gilt für darauf aufbauende Berechnungen (z. B. prozentuale Veränderung seit US-Börsenclose, Volumenprofile, technische Indikatoren oder Alarme). Vor jeder realen Transaktion sind Kurse und Konditionen stets direkt beim eigenen Broker bzw. der jeweiligen Börse zu prüfen.</p>

<h2>5. Keine Verwahrung &amp; keine Orderausführung</h2>
<p>AffenTerminal verwahrt weder Gelder noch Wertpapiere oder Kryptowerte und führt keine regulierten Orders im eigenen Namen aus. Etwaige Handels- oder Kontoverträge kommen ausschließlich mit den vom Nutzer selbst gewählten Drittanbietern zustande.</p>

<h2>6. Eigenverantwortung &amp; Haftungsbeschränkung</h2>
<p>Jede Anlage- und Handelsentscheidung triffst du ausschließlich eigenverantwortlich und auf eigenes Risiko. Wir haften unbeschränkt für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit sowie bei Vorsatz und grober Fahrlässigkeit. Bei leicht fahrlässiger Verletzung wesentlicher Vertragspflichten (Kardinalpflichten) ist die Haftung auf den vertragstypischen, vorhersehbaren Schaden begrenzt. Im Übrigen ist eine Haftung für leichte Fahrlässigkeit — insbesondere für entgangenen Gewinn, Handelsverluste oder Datenunterbrechungen Dritter — ausgeschlossen, soweit gesetzlich zulässig.</p>`;

  return legalShell("Risikohinweis & Haftungsausschluss", "/risikohinweis", body, env);
}

export function renderDatenschutzPage(env: Record<string, string | undefined> = process.env): string {
  const op = readLegalOperator(env);
  const body = `<h1>Datenschutzerklärung</h1>
<p>Diese Datenschutzerklärung informiert dich gemäß Art. 13 und 14 der Datenschutz-Grundverordnung (DSGVO) darüber, welche personenbezogenen Daten bei der Nutzung von AffenTerminal verarbeitet werden.</p>

<h2>1. Verantwortlicher</h2>
${renderOperatorBlock(op)}
${renderContactBlock(op)}

<h2>2. Hosting &amp; Server-Logfiles</h2>
<p>Diese Web-Anwendung wird über <strong>Microsoft Azure Container Apps</strong> (Rechenzentrumsregion <em>Germany West Central</em>, Frankfurt am Main, Deutschland) betrieben. Beim Aufruf der Seiten werden technisch erforderliche Verbindungsdaten (u. a. IP-Adresse, Zeitpunkt des Zugriffs, aufgerufener Pfad, HTTP-Statuscode, Browser-Typ) kurzzeitig in Server- und Plattformprotokollen verarbeitet, um den sicheren und stabilen Betrieb sowie die Abwehr von Missbrauch sicherzustellen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an der technischen Sicherheit und Verfügbarkeit).</p>

<h2>3. Benutzerkonten &amp; technisch notwendige Cookies</h2>
<p>AffenTerminal kann ohne Registrierung genutzt werden. Bei Nutzung eines persönlichen Kontos verwenden wir ausschließlich technisch notwendige Cookies (§ 25 Abs. 2 Nr. 2 TDDDG), um deine Anmeldesitzung und dein aktives Workspace-Profil bereitzustellen (<code>affentrader-account-session</code>, <code>affentrader-workspace-profile</code>). Es werden keine Werbe-, Tracking- oder Analyse-Cookies von Drittanbietern eingesetzt.</p>
<ul>
  <li><strong>Nutzung ohne Konto:</strong> Deine Einstellungen bleiben rein lokal in deinem Browser gespeichert; es werden keine Kontodaten auf dem Server angelegt.</li>
  <li><strong>Persönliches Konto (optional):</strong> Wenn du ein Konto erstellst, verarbeiten wir deine E-Mail-Adresse, ein sicher gehashtes Passwort (scrypt) sowie deine gespeicherten Workspace-Einstellungen zur geräteübergreifenden Synchronisierung (Art. 6 Abs. 1 lit. b DSGVO).</li>
  <li><strong>Anmeldung mit Google (optional):</strong> Sofern aktiviert und von dir ausdrücklich gewählt, erfolgt die Authentifizierung über Google OAuth (Google Ireland Limited / Google LLC). Dabei wird deine Google-Konto-ID und E-Mail-Adresse zur Konto-Zuordnung verarbeitet (Art. 6 Abs. 1 lit. b DSGVO).</li>
</ul>

<h2>4. Lokale Speicherung im Browser</h2>
<p>Einstellungen wie Chart-Layouts, Watchlists, Zeichenobjekte, Indikator-Vorlagen und optionale lokale Orderflow-Archive werden lokal in deinem Browser (<code>localStorage</code> / <code>IndexedDB</code>) gespeichert und verlassen dein Gerät nur, wenn du aktiv eine Konto-Synchronisierung oder einen Export nutzt.</p>

<h2>5. Abruf externer Marktdaten</h2>
<p>Zur Anzeige von Live-Kursen, Charts, Heatmaps und Finanzkennzahlen baut dein Browser direkte Verbindungen (HTTPS / WebSocket) zu externen Marktdaten-Anbietern auf (u. a. Binance, Hyperliquid, Bybit, Kraken, Alpaca). Dabei wird technisch bedingt deine IP-Adresse an den jeweiligen Anbieter übermittelt. Weitere Marktdaten (z. B. Yahoo Finance, TradingView-Heatmap, SEC, Polymarket) werden über den Anwendungsserver abgerufen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b und lit. f DSGVO zur Bereitstellung der angeforderten Marktdaten-Funktionen.</p>

<h2>6. Push-Benachrichtigungen (optional)</h2>
<p>Wenn du Hintergrund-Benachrichtigungen für Preisalarme aktivierst, wird das von deinem Browser erzeugte Web-Push-Abonnement (Endpoint und kryptografische Schlüssel) gespeichert, um ausgelöste Alarme zuzustellen (Art. 6 Abs. 1 lit. a DSGVO). Du kannst die Einwilligung jederzeit im Hauptmenü oder in den Browsereinstellungen widerrufen.</p>

<h2>7. Speicherdauer</h2>
<p>Sitzungs-Cookies laufen nach maximal 30 Tagen oder nach dem Abmelden ab. Kontodaten und synchronisierte Workspaces werden gespeichert, solange dein Konto besteht oder bis du deren Löschung verlangst, sofern keine gesetzlichen Aufbewahrungspflichten entgegenstehen.</p>

<h2>8. Deine Rechte als betroffene Person</h2>
<p>Du hast jederzeit das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16 DSGVO), Löschung (Art. 17 DSGVO), Einschränkung der Verarbeitung (Art. 18 DSGVO), Datenübertragbarkeit (Art. 20 DSGVO) sowie Widerspruch gegen bestimmte Verarbeitungen (Art. 21 DSGVO). Erteilte Einwilligungen können jederzeit mit Wirkung für die Zukunft widerrufen werden (Art. 7 Abs. 3 DSGVO). Zudem steht dir ein Beschwerderecht bei einer Datenschutzaufsichtsbehörde zu (Art. 77 DSGVO).</p>`;

  return legalShell("Datenschutzerklärung", "/datenschutz", body, env);
}

export function renderLegalPage(path: LegalPagePath, env: Record<string, string | undefined> = process.env): string {
  switch (path) {
    case "/impressum":
      return renderImpressumPage(env);
    case "/risikohinweis":
      return renderRisikohinweisPage(env);
    case "/datenschutz":
      return renderDatenschutzPage(env);
  }
}
