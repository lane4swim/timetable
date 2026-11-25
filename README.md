# Stundenplanplanung

Browserbasiertes Werkzeug zur Erstellung von Stundenplänen, Pausenaufsichten und datumsgenauen Vertretungsplänen – eine einzelne HTML-Datei, läuft lokal ohne Server und ohne Netzwerkzugriff.

- [Spezifikation](docs/Spezifikation_Stundenplanplanung.md)
- [Implementierungsplan](docs/Implementierungsplan.md)

## Benutzung

`stundenplan.html` herunterladen und per Doppelklick im Browser öffnen. Daten werden nur über den JSON-Export gespeichert.

## Entwicklung

Voraussetzung: Node.js ≥ 22. Es gibt keine npm-Abhängigkeiten.

| Befehl | Zweck |
| --- | --- |
| `npm run build` | Fügt `src/` zu `stundenplan.html` zusammen (Ergebnis wird eingecheckt) |
| `npm test` | Kern- und Build-Tests (`node --test`) |
| `npm run test:e2e` | Browser-Tests mit Playwright (Chromium) gegen `file://…/stundenplan.html` |
| `npm run testdaten` | Testdatensätze in `tests/daten/` neu erzeugen (deterministisch) |
| `npm run pruefen` | Build aktuell? Testdaten aktuell? Kern-Tests grün? (wie in CI) |

### Aufbau

```
src/kern/      Rechenkern ohne DOM: Modell, Validierung, Planer, Vertretung, Import/Export
               (läuft im Hauptthread, im Blob-Worker und in Node-Tests)
src/worker/    Nachrichtenprotokoll des Web Workers
src/ui/        Oberfläche
src/styles.css Gestaltung inkl. Druckansicht
tools/build.mjs  Build ohne Abhängigkeiten
tests/         Kern-, Build- und Browser-Tests; tests/daten/ enthält Generator und Testdatensätze
```

Module werden in Dateinamen-Reihenfolge (`00-`, `10-`, …) zusammengefügt. Jedes Kernmodul definiert ein Namensraum-Objekt und wird in `src/kern/99-kern.js` im Sammelobjekt `Kern` eingetragen.

### Testdatensätze

| Datensatz | Inhalt | Zweck |
| --- | --- | --- |
| `klein` | 4 Klassen (Stufe 1–2), 5 Lehrkräfte, eine Abwesenheit | schnelle Tests, Vertretung |
| `unterdeckung` | 4 Klassen (Stufe 3–4), Mathematik um 10 Stunden unterdeckt, Aufsichtssoll zu knapp | Abnahme 3, 12 |
| `ueberhang` | 4 Klassen, 10 Lehrkräfte, feste Zweitbesetzungen | Abnahme 8–10 |
| `gross` | 30 Klassen (Stufe 5–10), 60 Lehrkräfte, Fachräume | Leistung (≤ 30 s) |
