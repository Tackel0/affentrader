# Affentrader auf Netlify

Das Quellpaket ist fuer einen Next.js-Build auf Netlify bestimmt. Es enthaelt
keine lokalen Zugangsdaten, Aufzeichnungen oder installierten Abhaengigkeiten.
ZIP entpacken und den Projektordner angemeldet bei https://app.netlify.com/drop
hochladen, oder die ZIP ueber den Datei-Upload des ausgewaehlten Projekts waehlen.
Netlify muss das Framework erkennen und einen Build ausfuehren. Ein Deploy ohne
Build darf nicht als funktionierende Next.js-Veroeffentlichung behandelt werden.

## Website-Zugang vor dem Veroeffentlichen

1. Lokal `Netlify-Zugang-einrichten.cmd` starten. Ein neues Passwort selbst eingeben.
   Die Einrichtung liest weder `.env.local` noch den lokalen Server-Schluessel.
2. In Netlify beim gewuenschten Projekt unter **Project configuration > Environment
   variables > Import from .env** den Inhalt von `.netlify-private.env` einfuegen.
   Fuer Production und die Scopes **Builds und Functions** verfuegbar machen
   (bei einem Tarif ohne Scope-Auswahl: alle Scopes). Werte nicht im Chat teilen.
3. Erst danach bauen/veroeffentlichen. Ohne die beiden gueltigen Zugangswerten
   antwortet die App absichtlich mit 503; es gibt keinen ungeschuetzten Fallback.
4. Den neuen Website-Zugang im privaten Browserfenster pruefen. Fuer geschuetzte
   Server-Funktionen den separaten Schluessel aus `.netlify-server-key.txt` in
   der App eintragen. Das Website-Passwort ist kein API-Schluessel.

Die beiden privaten Dateien niemals in das Upload-Paket aufnehmen. Die Einrichtung
ueberschreibt keine vorhandene Konfiguration. Einen gewollten Passwortwechsel
separat durchfuehren; ein Wechsel des Session-Secrets aendert auch den API-Schluessel.

## Build und Speicherung

`netlify.toml`: Node 22, pnpm 11.25.0, Build `pnpm run build`, Publish `.next`.
Der Build erstellt die Vela-/PineTS-Laufzeiten neu. Den Next.js-Adapter installiert
Netlify automatisch. Nicht als statische HTML-Seite exportieren.
`netlify/functions/package.json` legt fuer den geplanten Alarmjob ES Modules fest:
die QuickJS-Laufzeit bietet keinen CommonJS-Einstieg und darf nicht per `require`
geladen werden.

Mit `AFFENTRADER_STORAGE=netlify-blobs` liegen Server-Dokumente in einem privaten,
siteweiten Netlify-Blobs-Store `affentrader-private`. Starke Reads und bedingte
ETag-Writes verhindern stilles Ueberschreiben durch parallele Funktionsinstanzen.
Ein Konflikt wird abgelehnt; nach Neuladen erneut versuchen. Lokale `.data`-Dateien
werden weder migriert noch hochgeladen. Im lokalen Node-Server bleibt die bisherige
Dateispeicherung mit Sicherungskopien erhalten. Cloud-Dokumente haben noch keine
automatischen taeglichen Sicherungskopien; Workspace-Exporte selbst sichern.
Blobs gehoeren zur Site und werden zwischen Deploys geteilt: Previews nicht an
Produktionsdaten anbinden, wenn diese veraendert werden duerfen.

Browser-Workspaces und Replay-Aufzeichnungen bleiben im jeweiligen Browser/Origin.
Ein neuer Hostname uebernimmt sie nicht automatisch. Vor einem Umzug exportieren.

Footprint nutzt fuer Auto/Manual-Zeilen das verifizierte Preisraster der Boerse.
Manual unterstuetzt 1–64 Ticks; positive gespeicherte Preis-Overrides bleiben
explizite Overrides. Fehlende Metadaten werden ausgewiesen. Im archivierten Replay
gilt das heutige Boersenraster; historische Regelaenderungen sind nicht rekonstruiert.
Pruefnachweise und weitere Grenzen: `footprint-grid-reference.md`.

## Hintergrundalarme und Grenzen

Auf Netlify laeuft kein dauerhafter 15-Sekunden-Prozess. Die private Scheduled
Function `alerts` prueft auf veroeffentlichten Deploys einmal pro Minute. Eine
ETag-gesicherte Lease verhindert ueberlappende Aufrufe. Sie ist kein oeffentlicher
HTTP-Endpunkt. Netlify begrenzt Scheduled Functions auf 30 Sekunden; grosse
Watchlists und aufwendige Pine-Regeln koennen diese Grenze erreichen. Logs und
naechste Ausfuehrung in **Functions > alerts** pruefen. Die App meldet den lokalen
Timer deshalb als inaktiv und nennt den Netlify-Zeitplan; das ist kein Nachweis
erfolgreicher Cron-Ausfuehrungen.

Netlify begrenzt gepufferte Function-Requests auf 6 MB. Die lokale Sync-Obergrenze
von 8 MB ist dort nicht voll nutzbar. Umfangreiche Recovery-Journale und Replay-
Aufzeichnungen sind nicht fuer Serverless-Groessen-/Laufzeitgrenzen validiert.
Ein produktiver Netlify-Build, Anmeldung, persistente Speicherung und Cron muessen
nach dem Upload am echten Host geprueft werden. Vollstaendige Vela-Paritaet ist
dadurch nicht bestaetigt.

Offizielle Dokumentation:
- https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/
- https://docs.netlify.com/deploy/create-deploys/
- https://docs.netlify.com/build/data-and-storage/netlify-blobs/
- https://docs.netlify.com/build/functions/scheduled-functions/
