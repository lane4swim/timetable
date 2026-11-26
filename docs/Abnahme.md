# Abnahmekriterien und Nachweise

Stand: 25.11.2026 · Bezug: [Spezifikation §9](Spezifikation_Stundenplanplanung.md)

Alle Kriterien sind durch automatische Tests belegt. Kern-Tests laufen mit `npm test` (Node), Browser-Tests mit `npm run test:e2e` (Chromium über Playwright, `stundenplan.html` per `file://` geöffnet wie beim Doppelklick).

| Nr. | Kriterium (Kurzform) | Nachweis (Testdatei → Testfall) |
| --- | --- | --- |
| 1 | Export → Import ergibt identischen Zustand (ohne `exportedAt`) | `tests/kern/io.test.mjs` → „Abnahme 1 …“ (alle Testdatensätze, Plan aller Arten, unbekannte Felder); `tests/e2e/daten.test.mjs` → „Abnahme 1 über die Oberfläche“ |
| 2 | Erzeugter Regelplan verletzt keine harte Regel | `tests/kern/planer.test.mjs` → „Abnahme 2 …“ (geprüft werden H1–H14, alle Datensätze) |
| 3 | Unterdeckung: Ausfall nachweislich minimal | `tests/kern/planer.test.mjs` → „Abnahme 3 …“ (Ausfall = untere Schranke aus dem Fluss; Schranke ist scharf) |
| 4 | Bei gleichem Ausfall die meisten Stunden durch die eigene Lehrkraft | `tests/kern/planer.test.mjs` → „Abnahme 4 …“ (K2 = 0 mit Festzuordnung; ohne Festzuordnung Klassenlehrkraft bevorzugt) |
| 5 | Vorschläge in der Reihenfolge der Eskalationskette | `tests/kern/vertretung.test.mjs` → „Abnahme 5 …“ (je Stufe 1–7 ein Fall, in dem genau diese Stufe die erste mögliche ist); `tests/e2e/ausfall.test.mjs` |
| 6 | Aufgeteilte Klasse überschreitet keine Raumkapazität | `tests/kern/vertretung.test.mjs` → „Stufe 6 und Abnahme 6“; `tests/kern/regeln.test.mjs` → H6 mit Gästen |
| 7 | Fehlerhafte JSON-Dateien werden mit Pfad abgewiesen, Zustand unverändert | `tests/kern/io.test.mjs` → „Abnahme 7 …“; `tests/kern/schema.test.mjs`; `tests/e2e/daten.test.mjs` → „Abnahme 7 …“ |
| 8 | Mehr Lehrkräfte als Klassen: versorgt, Höchstgrenzen, Reserve, Zweitbesetzung, ≤ 2 je Slot | `tests/kern/planer.test.mjs` → „Abnahme 8 …“ |
| 9 | Hauptlehrkraft fällt aus, Zweitbesetzung rückt auf, kein Ausfall | `tests/kern/vertretung.test.mjs` → „Stufe 1 … (Abnahme 9 …)“; `tests/e2e/ausfall.test.mjs` → Datensatz Überhang |
| 10 | Lehrkraft, die anderswo nur Zweitbesetzung ist, wird abgezogen; dort bleibt die Hauptlehrkraft | `tests/kern/vertretung.test.mjs` → „Abnahme 10 …“ |
| 11 | Keine Leerstunde, auch im Vertretungsplan; Ausfall in der Tagesmitte → Nachrücken oder Aufsicht | `tests/kern/vertretung.test.mjs` → „Stufe 7 und Abnahme 11 …“; `tests/kern/planer.test.mjs` (H12 per Konstruktion); `tests/e2e/ausfall.test.mjs` |
| 12 | Pausenaufsichten besetzt, Aufsichtssoll nicht überschritten, nur an Unterrichtstagen | `tests/kern/planer.test.mjs` → „Abnahme 12 …“ |
| 13 | Aufsichten einer abwesenden Lehrkraft datumsgenau vertreten, Regelplan unverändert | `tests/kern/vertretung.test.mjs` → „Abnahme 13 …“ |

## Nichtfunktionale Anforderungen

| Anforderung | Nachweis |
| --- | --- |
| Eine Datei, keine Netzwerkzugriffe, kein `localStorage` | `tests/build.test.mjs` (keine externen Ressourcen, verbotene APIs, Content-Security-Policy); `tests/e2e/grundgeruest.test.mjs` (keine Netzwerkanfragen) |
| Erstplan 30 Klassen / 60 Lehrkräfte ≤ 30 s, Oberfläche bedienbar | `tests/kern/planer.test.mjs` → „Leistung“ (ca. 3 s); `tests/e2e/planung.test.mjs` → Abbruch während der Planung bei bedienbarer Oberfläche |
| Plan-Ansicht reagiert unter 100 ms | `tests/e2e/plan.test.mjs` → „Reaktionszeit …“ (Median im großen Plan) |
| Reproduzierbar mit gleichem Startwert | `tests/kern/planer.test.mjs` → „Reproduzierbarkeit“ |
| Nachvollziehbarkeit (Regel, Stufe, Kostenanteil) | Verstöße mit Regelnummer und Text (`tests/kern/regeln.test.mjs`), Kostenposten (`tests/kern/kosten.test.mjs`), Stufe und Begründung je Vertretungsvorschlag (`tests/kern/vertretung.test.mjs`) |
| Kontrast WCAG AA, Fokusanzeige, Farbe nie allein | `tests/kontrast.test.mjs`; `tests/e2e/bericht.test.mjs` (zugängliche Namen, Fokus, Tastatur); Konflikte mit ⚠ und Regelnummer (`tests/e2e/plan.test.mjs`) |
| Nutzbar ab 1280 px | `tests/e2e/bericht.test.mjs` (keine waagerechte Rollleiste in allen Reitern) |
| Rückgängig/Wiederholen ≥ 50 Schritte, Tastaturbedienung der Tabellen | `tests/e2e/stammdaten.test.mjs` |
| Druckansicht je Klasse und Lehrkraft | `tests/e2e/plan.test.mjs` → „Druckansicht …“ |
| Plan-Bedienung auf dem Touchscreen (Antippen, Halten und Ziehen) | `tests/e2e/touch.test.mjs` (Touch-Emulation in Chromium) |

## Nicht automatisch geprüft

- **Firefox, Safari, Edge:** In der Entwicklungsumgebung ist nur Chromium verfügbar. Die Datei nutzt nur Standard-APIs (ES2020, `<dialog>`, HTML-Drag-and-drop, Blob-Worker); der CSS-Selektor `:has()` in der Druckansicht erfordert aktuelle Browser (Firefox ab 121).
- **Dialog beim Schließen des Tabs:** geprüft wird, dass der `beforeunload`-Handler das Schließen abfängt; ob der Browser den Dialog anzeigt, bestimmt der Browser.
