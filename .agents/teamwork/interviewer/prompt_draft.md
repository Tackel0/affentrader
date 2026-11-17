Kann ruhig auch Subagents benutzen. Dem AffenTerminal eine übersichtliche, professionelle Benutzeroberfläche im Stil eines Open-Source Bloomberg Terminals für den produktiven Trading-Einsatz geben und ausführlich testen, sodass es nicht nach KI-Slop aussieht.

Working directory: c:\Users\Niklas\Desktop\affentrader
Integrity mode: development

## Requirements

### R1. Professionelle, übersichtliche Terminal-GUI
Überarbeitung und Bereinigung der AffenTerminal-Oberfläche hin zu einer übersichtlichen, datendichten Pro-GUI im Bloomberg-Terminal-Stil. Die Benutzeroberfläche muss frei von generischer KI-Slop-Ästhetik sein (keine unpassenden visuellen Gimmicks, Dummy-Widgets oder unruhigen Farbverläufe), mit klarer visueller Hierarchie, hoher Informationsdichte und intuitiver Tastatur- sowie Multi-Pane-Steuerung.

### R2. Ausführliche Testabdeckung der Benutzeroberfläche und Kernfunktionen
Umfassende automatisierte Tests der Benutzeroberfläche und Kernkomponenten. Die bestehende Test-Suite (`pnpm test` / Vitest) und der TypeScript-Typecheck (`pnpm typecheck`) müssen fehlerfrei bleiben und um neue automatisierte Komponententests erweitert werden, die das Rendering und fehlerfreie Interaktionen der GUI sicherstellen.

### R3. Architektur-Dokumentation und Netlify-Build
Alle Architektur-Entscheidungen, UI-Anpassungen und der aktuelle Projektstand müssen laufend in `CODEX_HANDOFF.md` im Projekt-Root dokumentiert werden. Das Projekt muss jederzeit fehlerfrei kompilieren (`pnpm build`) und direkt für Netlify bereitstellbar bleiben.

## Acceptance Criteria

### GUI & Usability
- [ ] Die AffenTerminal-Oberfläche weist ein einheitliches, professionelles Dark-Theme im Bloomberg-Terminal-Stil mit konsistenter Typografie, Farbcodierung und klaren Panel-Abgrenzungen auf.
- [ ] Alle sichtbaren UI-Elemente und Panels (Command-Bar, Multi-Pane-Workspace, Daten-Ribbons) sind funktional angebunden; es sind keine funktionslosen Dummy-Widgets oder KI-Slop-Artefakte vorhanden.
- [ ] Die Benutzeroberfläche rendert auf Desktop-Auflösungen ohne Layout-Verschiebungen, abgeschnittene Texte oder überlappende Bedienelemente.

### Testing & Verifikation
- [ ] `pnpm test` läuft vollständig fehlerfrei durch.
- [ ] Neue automatisierte Tests für die überarbeiteten GUI-Komponenten sind integriert und decken Rendering sowie Kernzustände ab.
- [ ] `pnpm typecheck` meldet 0 TypeScript-Fehler.

### Build & Dokumentation
- [ ] `pnpm build` schließt erfolgreich ohne Fehler ab.
- [ ] `CODEX_HANDOFF.md` im Root-Verzeichnis ist aktualisiert und dokumentiert alle vorgenommenen Änderungen und den finalen Stand.
