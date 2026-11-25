# Implementierungsplan Stundenplanplanung

Stand: 25.11.2026 · Grundlage: [Spezifikation_Stundenplanplanung.md](Spezifikation_Stundenplanplanung.md)

Dieser Plan beschreibt, wie die Spezifikation umgesetzt wird: Architektur, Module, Kernalgorithmen, Meilensteine, Teststrategie und die Annahmen, die wir für die offenen Fragen treffen. Abschnittsverweise (§) beziehen sich auf die Spezifikation.

---

## 1. Leitentscheidungen

| Thema | Entscheidung | Begründung |
| --- | --- | --- |
| Auslieferung | Eine Datei `stundenplan.html` (CSS + JS eingebettet), wird im Repository mit eingecheckt | §1 Technik, Doppelklick-Start |
| Entwicklung | Quelltext in `src/` als einzelne Module, ein Build-Skript ohne Abhängigkeiten (`tools/build.mjs`) fügt sie zu `stundenplan.html` zusammen | Wartbarkeit (§9), testbar in Node, trotzdem eine Datei im Ergebnis |
| Modulform | Klassische Skripte mit Namensraum-Objekten (`const Modell = (() => { … return {…}; })();`), kein `import`/`export` im Auslieferungscode | Läuft identisch im Hauptthread, im Blob-Worker und in Node (`vm`) |
| Kern vs. Oberfläche | Kern (Modell, Validierung, Regeln, Kosten, Planer, Vertretung, Import/Export) ist DOM-frei und rein funktional; Oberfläche ist getrennt | Kern läuft im Worker und wird in Node getestet |
| Worker | Kernquelltext steht in `<script id="kern">`; der Worker wird aus `Blob([kern.textContent + workerGlue])` erzeugt | §6: nur eine HTML-Datei |
| Zufall | Eigener deterministischer PRNG (mulberry32) mit `zufallsStartwert` | §6.6 Reproduzierbarkeit |
| Tests | `node --test` (Node 22, keine npm-Abhängigkeiten) für den Kern; Playwright (vorinstalliert) für Oberfläche und Ende-zu-Ende-Abnahme | Abnahmekriterien §9 automatisiert |
| Sprache | Bezeichner im Kern deutsch wie im JSON-Schema (`lehrkraefte`, `stundentafel` …), Kommentare deutsch | §9 Wartbarkeit, Nähe zum Schema |
| Speicher | Kein `localStorage`, keine Cookies, keine Netzwerkzugriffe; CSP-Meta-Tag `default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; style-src 'unsafe-inline'` | §9 Datenschutz, technisch abgesichert |

## 2. Verzeichnisstruktur

```
timetable/
├── stundenplan.html            # Build-Ergebnis (ausgeliefert)
├── src/
│   ├── kern/
│   │   ├── 00-hilfen.js        # PRNG, IDs, tiefe Kopie, Datum ↔ Wochentag
│   │   ├── 10-modell.js        # Leerer Zustand, Fabriken, Indizes (Slot-Belegung)
│   │   ├── 20-schema.js        # Schemabeschreibung, Validierung mit Pfaden, Migrationen
│   │   ├── 30-regeln.js        # Harte Regeln H1–H14 (Prüfung + Erklärung)
│   │   ├── 40-kosten.js        # Kostenvektor K1, K1A, K2–K6, weiche Regeln W1–W12, lexikografischer Vergleich
│   │   ├── 50-bedarf.js        # Bedarfsermittlung, Vorprüfung, Min-Cost-Flow
│   │   ├── 60-planer.js        # Konstruktion, Zweitbesetzung, Nachoptimierung (SA)
│   │   ├── 65-aufsicht.js      # Pausenaufsichten: Zuordnung, Vertretung
│   │   ├── 70-vertretung.js    # Eskalationskette, Vorschläge, Kalender (Datum → Wochentag)
│   │   └── 80-io.js            # Export/Import (voll und teilweise), Normalisierung
│   ├── worker/worker.js        # Nachrichtenprotokoll des Workers
│   ├── ui/                     # Reiter, Tabellen, Plan-Raster, Drag-and-drop, Undo/Redo
│   ├── styles.css              # inkl. @media print, Fokus, Kontrast
│   └── index.template.html
├── tools/build.mjs             # Zusammenfügen + Prüfsumme/Größe ausgeben
├── tests/
│   ├── daten/                  # Testdatensätze (JSON) + Generator
│   ├── kern/*.test.mjs         # Unit- und Abnahmetests des Kerns
│   └── e2e/*.spec.mjs          # Playwright gegen stundenplan.html (file://)
└── docs/
```

## 3. Kerndatenstrukturen (intern)

Das JSON-Schema (§8) ist das Austauschformat. Intern arbeitet der Planer auf kompakten, indexbasierten Strukturen, die vor jedem Lauf aus dem Zustand abgeleitet werden:

- **Slot-Index:** `slot = tagIndex * stundenProTag + (stundeNr - 1)`. Belegungen als `Int16Array`/`Int32Array`: `lehrerBelegung[l][slot]`, `raumBelegung[r][slot]`, `klassenBelegung[k][slot]`.
- **Verfügbarkeit:** Bitmasken je Lehrkraft und Raum (gesperrte Zeitfenster; im Vertretungsfall zusätzlich die Abwesenheiten der betroffenen Woche).
- **Qualifikationsmatrix:** `qualifiziert[l][fach]` als Stufenbereich → schnelle Prüfung `istQualifiziert(l, fach, stufe)`.
- **Einheit:** `{ klasse, fach, lehrkraefte: [haupt, zweit?], dauer: 1|2, raumtyp, slot?, raum? }`.
- **Pausen-Index:** `pause = tagIndex * anzahlPausen + pausenIndex`; `aufsicht[pause] = Lehrkraft-IDs`, `aufsichtenJeLehrkraft[l]`. Pausen sind eigene Zeitpunkte, keine Slots, damit sie H12 nicht berühren.
- **Anwesenheit:** `anwesend[l][tag]` = Lehrkraft hat an dem Tag Unterricht oder Zweitbesetzung; wird bei jedem Zug mitgeführt, weil H13 davon abhängt.
- **Planzustand:** Liste von Einheiten + Belegungsindizes; alle Züge der lokalen Suche aktualisieren die Indizes inkrementell und liefern ein Kosten-Delta, damit die Bewertung nicht jedes Mal den ganzen Plan durchläuft.

Rückwandlung in `plan.regelplan` (eine Zeile je Stunde, Doppelstunde = zwei Zeilen) erst beim Export bzw. bei Übernahme in den Zustand.

## 4. Module im Detail

### 4.1 Modell und Hilfen
- ID-Vergabe: Präfix je Entität + kurzer Zähler/Zufallsteil (`l-…`, `k-…`), stabil über Import/Export.
- Referenzverzeichnis: „Wer verweist auf Entität X?“ – Grundlage für das blockierte Löschen (§7 Stammdaten).
- Undo/Redo: Befehlsmuster mit unveränderlichen Zustandsschnappschüssen (strukturelles Teilen: nur geänderte Teilbäume kopieren), Ringpuffer ≥ 50 Schritte.

### 4.2 Schema, Validierung, Migration (§8)
- Deklarative Schemabeschreibung (Typ, Pflicht, Bereich, Referenzziel) → ein generischer Validator erzeugt Fehler mit Pfad, z. B. `lehrkraefte[3].qualifikationen[0].fach: unbekannte Referenz „f-xy“`.
- Zusätzliche Querprüfungen: eindeutige IDs und Kürzel, höchstens eine `haupt` je Klasse+Fach, Haupt ≠ Zweit derselben Stunde, `lehrkraefte.length ≤ maxLehrkraefteProKlasseUndSlot`, `minStunden ≤ sollStunden ≤ maxStunden`.
- Migrationen: Tabelle `migrationen[v] = (daten) => daten'`; Import zieht stufenweise auf die aktuelle Version, neuere Versionen werden mit Hinweis abgelehnt.
- Unbekannte Felder: Der Import arbeitet auf dem Originalobjekt und ändert nur bekannte Felder; der Export serialisiert das gesamte Objekt. Dadurch bleiben Zusatzfelder erhalten (Abnahme 1).
- Atomarer Import: erst vollständig validieren und migrieren, dann in einem Schritt ersetzen (Abnahme 7).

### 4.3 Regelprüfer H1–H14 (§4)
Eine Funktion `pruefeHart(zustand, plan) → Verstoss[]` mit `{ regel: "H3", stunden: [...], text }`. Dieselbe Funktion nutzt:
- die Oberfläche (rote Markierung + Symbol + Regelnummer, §7),
- der Planer als Abschlusskontrolle jedes erzeugten Plans (Abnahme 2: H1–H14, nicht nur H1–H9),
- die Tests.

Für Drag-and-drop gibt es eine inkrementelle Variante `pruefeZug(index, zug)`, damit die Plan-Ansicht unter 100 ms bleibt.

### 4.4 Kostenvektor (§3)
`bewerte(plan) → [K1, K1A, K2, K3, K4, K5, K6]` plus Aufschlüsselung je Klasse/Lehrkraft/Regel (für „Nachvollziehbarkeit“ und den Bericht).
- **K1** Stunden der Stundentafel ohne Hauptlehrkraft (Status `entfaellt` und `aufsicht`).
- **K1A** unbesetzte Pausenaufsichten (Bedarf je Pause und Tag minus zugewiesene Lehrkräfte).
- **K2** abgedeckte Stunden, deren Hauptlehrkraft nicht die festgelegte Haupt- oder Zweitlehrkraft für Klasse+Fach ist; intern abgestuft (Klassenlehrkraft < qualifiziert < Notfall) als Unterschlüssel, damit die Reihenfolge aus §3 Ziel 2 greift.
- **K3** fachfremd erteilte Stunden (Hauptlehrkraft ohne Qualifikation).
- **K4** `Doppelbetreuung × 1 + Aufteilung × a` mit `a > 1` (Vorschlag `a = 3`, konfigurierbar).
- **K5** `Σ max(0, (soll − reserve) − ist)` über Lehrkräfte, nur soweit eine Zweitbesetzung tatsächlich möglich wäre (freier Slot der Lehrkraft, in dem eine Klasse Unterricht hat und H10 Platz lässt); 0, wenn Zweitbesetzung abgeschaltet.
- **K6** `Σ Gewicht_i × Verstöße(W_i)` für W1–W12 (W11 Aufsichtssoll unterschritten, W12 Aufsicht nicht angrenzend an eigenen Unterricht bzw. gehäuft).
- Vergleich `vergleicheLex(a, b)`; Anzeige des Vektors in Planung und Bericht.

### 4.5 Bedarf, Vorprüfung, Lehrkräfte-Zuweisung (§6.1–6.3)
1. **Einheiten bilden:** je Klasse und Fach `stunden` Einheiten; bei `doppelt: true` und `blockbar` Paare der Dauer 2, Rest Dauer 1.
2. **Vorprüfung:** Je Fach Bedarf vs. Kapazität qualifizierter Lehrkräfte (Kapazität = `soll − reserve` abzüglich bereits fest zugeordneter Stunden). Ausgabe: erwarteter Ausfall je Fach, freie Kapazität je Lehrkraft. Zusätzlich Aufsichten: Wochenbedarf `Σ Pausen × Tage` gegen `Σ aufsichtenProWoche`; Unterdeckung = untere Schranke für K1A.
3. **Min-Cost-Flow** (Successive Shortest Path mit Bellman-Ford/SPFA, Graphgröße bei 40 Klassen ≈ 400 Bedarfsknoten × 80 Lehrkräfte, unkritisch):
   Quelle → (Klasse, Fach) [Kapazität = Wochenstunden] → Lehrkraft [Kosten nach Ziel 2/3: festgelegt 0, Klassenlehrkraft 1, qualifiziert 10, sonst gesperrt] → Senke [Kapazität = verfügbares Kontingent]. Festzuordnungen werden zuerst fixiert. Nicht geflossener Bedarf = untere Schranke für K1.
   *Nebeneffekt:* Diese Schranke beweist Optimalität für Abnahme 3: Erreicht der Plan K1 = Schranke, ist kein Plan mit weniger Ausfall möglich. Die Oberfläche zeigt dann „Ausfall minimal (nachgewiesen)“.
4. **Springerpool:** Lehrkräfte mit Restkontingent nach dem Fluss.

### 4.6 Konstruktion (§6.4) – Umgang mit H12
H12 (lückenlose Klassentage) ist die prägende Nebenbedingung. Ansatz:
- **Tagesprofil je Klasse:** Für jede Klasse wird vorab eine Tageslänge je Tag `n_d` (Summe = Wochenstunden) und ein Startslot `s_d` (Standard 1, W1) festgelegt, so gleichmäßig wie möglich. Damit ist die Slotmenge der Klasse fest und jede Lücke ausgeschlossen.
- **Platzierung:** Einheiten nach Schwierigkeit sortiert (wenige zulässige Slots, Dauer 2, Fachraum, knappe Lehrkraft), Backtracking mit Forward-Checking über die Slotmengen; Doppelstunden nur ab `doppelstundenStart`. Raumwahl: Heimatraum, sonst passender Fachraum mit kleinster ausreichender Kapazität.
- **Nicht platzierbare Einheiten** werden zurückgestellt; die betroffene Klasse verkürzt den Tag am Rand (Profil wird angepasst), sodass H12 erhalten bleibt. Diese Einheiten gehen in die Ausfallbehandlung (§6.7).
- Backtracking-Tiefe und Knotenzahl werden begrenzt; Restarts mit anderem Zufallsstand, solange Zeitbudget vorhanden.

### 4.7 Zweitbesetzung (§6.5)
Zuordnungsproblem „freier Lehrkraft-Slot → Unterricht einer Klasse im selben Slot“:
- Kandidatengewichte aus W9 (Schülerzahl, niedrige Stufe, Fächer mit wenigen Qualifizierten) und W10 (gleiche Lehrkraft in Klasse+Fach).
- Gieriges Verfahren pro Lehrkraft-Klasse-Paar (ganze Fachblöcke zusammen vergeben, das stützt W10), anschließend Verbesserung in der lokalen Suche.
- Feste `zweit`-Zuordnungen aus den Stammdaten werden zuerst gesetzt.
- Schranken: H1, H4, H7, H10, Reserve `ceil(soll × reserve%)` bleibt frei.

### 4.7a Pausenaufsichten (§6.5a)
- **Bedarf:** aus `zeitraster.pausen` (Voreinstellung beim Anlegen eines Rasters: vor Stunde 1, 3, 5, … mit je einer einstellbaren Anzahl). Pausen mit `aufsichten: 0` erzeugen keinen Bedarf. Bedarf nur an Tagen, an denen überhaupt Unterricht stattfindet; die Frühaufsicht nur, wenn eine Klasse in der 1. Stunde beginnt.
- **Zuordnung als Min-Cost-Flow:** Quelle → Lehrkraft [Kapazität = `aufsichtenProWoche`] → (Lehrkraft, Tag) [Kapazität = Anzahl Pausen am Tag] → Pause+Tag [nur wenn H13 erfüllt; Kosten: 0 bei angrenzendem Unterricht, sonst W12-Gewicht] → Senke [Kapazität = Bedarf]. Damit sind K1A minimal und H14 gewahrt; W11 (Soll nicht ausgeschöpft) ergibt sich aus dem Restfluss.
- **Kopplung an den Unterricht:** Die Anwesenheit hängt vom Stundenplan ab. Deshalb läuft die Zuordnung nach der Konstruktion und erneut am Ende der Nachoptimierung; während der lokalen Suche wird K1A nur inkrementell geschätzt (betroffene Tage neu bewertet). Züge, die einer Lehrkraft einen Tag ganz nehmen, an dem sie Aufsicht hat, lösen eine lokale Neuzuordnung dieses Tages aus.
- **Oberfläche:** Pausenzeilen im Raster; Aufsicht per Drag-and-drop auf eine andere Lehrkraft (Liste „Aufsichtssoll offen“ neben dem Plan).

### 4.8 Nachoptimierung (§6.6)
Simulated Annealing über den lexikografischen Kostenvektor:
- Züge: Einheit verschieben (nur innerhalb der Slotmenge der Klasse bzw. Tausch zweier Einheiten derselben Klasse, damit H12 nie verletzt wird), Tag-Profil zweier Tage tauschen, Lehrkraft tauschen, Zweitbesetzung umsetzen, zurückgestellte Einheit erneut versuchen.
- Akzeptanz: Verschlechterung in K1–K5 wird nie akzeptiert; die Temperatur wirkt nur auf K6. Das hält die Lexikografie streng und das Verfahren einfach.
- Fortschrittsmeldung an die Oberfläche alle ~250 ms (`{iteration, besterVektor, restzeit}`), Abbruch übernimmt die beste Lösung.

### 4.9 Vertretung (§5)
Eingabe: Abwesenheit (Lehrkraft oder Raum, Datum von–bis). Vertretungen sind **datumsgenau**: Der Zeitraum wird in Unterrichtstage zerlegt (nur Tage des Zeitrasters), jedes Datum über seinen Wochentag dem Regelplan zugeordnet. Für jedes Datum entsteht ein Tagesplan = Regelplan dieses Wochentags + bestätigte Vertretungen dieses Datums. Mehrere Abwesenheiten am selben Datum werden gemeinsam behandelt (wer bereits vertritt, ist im Slot nicht mehr frei). Der Regelplan wird nie verändert.

Stufe 2 („Umplanen“) wirkt auf die betroffene Kalenderwoche: Eine Stunde darf auf einen anderen Tag derselben Woche verschoben werden; das erzeugt zwei datumsgenaue Einträge (Entfall am alten, Zusatzstunde am neuen Datum), beide nur in der Zukunft relativ zum Datum der Erfassung.

Jede betroffene Stunde durchläuft die Kette, die erste zulässige Stufe gewinnt, innerhalb der Stufe entscheidet der Kostenvektor:

| Stufe | Umsetzung | Prüfung |
| --- | --- | --- |
| 1 Zweitbesetzung rückt auf | `lehrkraefte = [zweit]`, Status `vertreten`, Grund `zweitbesetzungRueckt` | Abnahme 9 |
| 2 Umplanen | Suche nach einem Slot derselben Woche, Tausch innerhalb der Klassenslots, Folgestunden rücken nach; nur ohne Verschlechterung anderer Stunden | H12 |
| 3 Lehrkraft der Klasse | Klassenlehrkraft, dann Fachlehrkräfte der Klasse, frei im Slot | Ziel 2 |
| 4 Qualifizierte Lehrkraft | Springerpool → freie → nur-Zweitbesetzung (deren Zweitbesetzung wird entfernt) | Abnahme 10 |
| 5 Doppelbetreuung | Kernklassen-Suche, Kapazität oder `nahe`, max. pro Tag | §5 Doppelbetreuung |
| 6 Aufteilung | Zielklassen gleiche/benachbarte Stufe, Verteilung per Kapazitätsrest (gieriges Auffüllen), Gruppen gleichmäßig oder nutzerdefiniert, nicht in zwei Folgestunden | Abnahme 6 |
| 7 Entfall / Aufsicht | Rand des Tages → `entfaellt`; Tagesmitte → Nachrücken (alle Folgestunden eine Stunde vor, falls deren Lehrkräfte/Räume frei) sonst `aufsicht` durch beliebige freie Lehrkraft | Abnahme 11 |

Jeder Vorschlag trägt Stufe, Grund, Regelbezug und Kosten-Delta; die Oberfläche zeigt Alternativen der nächsten Stufen an. Nichts wird ohne Bestätigung übernommen (Zustand `vorschlaege` getrennt von `plan.vertretungen`).

**Aufsichtsvertretung:** Nach den Unterrichtsvertretungen eines Datums (die die Anwesenheit verändern können) werden die Aufsichten der abwesenden Lehrkraft vertreten: erst Lehrkräfte mit angrenzendem Unterricht, dann andere Anwesende mit der geringsten Aufsichtszahl in der Woche; sonst `unbesetzt` mit Warnung. Ergebnis in `plan.aufsichtsVertretungen`.

Raumausfall: dieselbe Kette in vereinfachter Form (Ersatzraum gleichen Typs und ausreichender Kapazität → Umplanen → Doppelbetreuung in anderem Raum → Aufteilung → Entfall).

### 4.10 Import/Export (§8)
- Voll- und Teilexport (Stammdaten / Plan), Dateiname `stundenplan-JJJJ-MM-TT.json`.
- Import per Dateiauswahl und Drag-and-drop auf die Seite; vor dem Überschreiben Dialog mit „Aktuellen Stand exportieren“.
- Anzeige „zuletzt exportiert“ und „ungespeicherte Änderungen“; `beforeunload`-Warnung.
- Kanonische Serialisierung (feste Schlüsselreihenfolge, 2 Leerzeichen) für reproduzierbare Dateien und Abnahme 1.

### 4.11 Oberfläche (§7)
- Reiter: Stammdaten, Zuordnung, Planung, Plan, Ausfall, Bericht, Daten.
- Tabellen-Komponente (eine generische, schemagetrieben): Inline-Bearbeitung, sofortige Validierung, Tastatur (Pfeile, Enter, Esc, Entf, Strg+Z/Y), Löschschutz mit Verweisliste.
- Zuordnungsmatrix Klasse × Fach mit Auswahl Haupt/Zweit und Soll/Ist-Leiste je Lehrkraft.
- Plan-Raster: Umschalter Klasse/Lehrkraft/Raum; HTML5-Drag-and-drop plus Tastaturalternative (Stunde auswählen, Ziel mit Pfeilen, Enter); Konflikte rot + ⚠ + Regelnummer; ⇄ für Doppelbetreuung, „+ Name“ für Zweitbesetzung, „(2.)“ in der Lehrkraftansicht, „aufgeteilt“/„+ n Gäste“; Seitenleiste „ungenutztes Kontingent“ als Drag-Quelle für Zweitbesetzung.
- Druckansicht je Klasse und Lehrkraft über `@media print`.
- Barrierefreiheit: Kontrast AA, sichtbarer Fokus, ARIA-Rollen für Reiter/Raster, nie nur Farbe.

## 5. Meilensteine

Jeder Meilenstein endet mit grünen Tests und einem lauffähigen `stundenplan.html`.

| M | Inhalt | Ergebnis / Abnahme |
| --- | --- | --- |
| **M0** Grundgerüst | Build-Skript, Template, Testrahmen (`node --test`, Playwright), PRNG, Testdatengenerator mit vier Datensätzen: *klein* (4 Klassen), *unterdeckung*, *ueberhang*, *gross* (30 Klassen/60 LK) | `stundenplan.html` öffnet leer, CI-fähige Skripte |
| **M1** Daten & Persistenz | Modell, Schema-Validator mit Pfaden, Migrationen, Import/Export voll + teilweise, Erhalt unbekannter Felder, Reiter „Daten“ | Abnahme 1, 7 |
| **M2** Regeln & Kosten | H1–H14, W1–W12, Kostenvektor, Erklärungen | Grundlage für alle weiteren |
| **M3** Stammdaten-UI | Reiter Stammdaten, Zuordnung; Undo/Redo; Tastaturbedienung (Reiter „Daten“ bereits in M1) | Daten vollständig pflegbar |
| **M4** Planer | Bedarf, Vorprüfung, Min-Cost-Flow, Konstruktion mit Tagesprofilen, Zweitbesetzung, Pausenaufsichten, SA, Worker mit Fortschritt/Abbruch | Abnahme 2, 3, 4, 8, 12; Leistung 30 s |
| **M5** Plan-Ansicht | Raster mit Pausenzeilen, Umschalter (inkl. Aufsicht), Drag-and-drop mit Live-Prüfung, Zweitbesetzung und Aufsicht per Drag, Druckansicht | < 100 ms Reaktion |
| **M6** Vertretung | Kalender (Datum → Wochentag), datumsgenaue Eskalationskette, Aufsichtsvertretung, Raumausfall, Tagesvertretungsplan, Vorschlagsdialog, Ausfallbericht | Abnahme 5, 6, 9, 10, 11, 13 |
| **M7** Bericht & Feinschliff | Bericht (Ausfall, Vertretungsquote, Auslastung, Verstöße), Barrierefreiheit, Browsertest Firefox/Chrome/Safari/Edge | Gesamtabnahme |

Empfohlene Reihenfolge: M0 → M1 → M2 → M4 (Kern zuerst, vollständig in Node testbar) → M3 → M5 → M6 → M7. M3 kann parallel zu M4 laufen.

## 6. Teststrategie und Abnahmezuordnung

| Abnahme | Test |
| --- | --- |
| 1 Rundlauf Export/Import | Für alle Testdatensätze: `export(import(export(z)))` ≡ `export(z)` ohne `exportedAt`; zusätzlich mit unbekannten Feldern |
| 2 Keine harten Verstöße | Jeder erzeugte Plan läuft durch `pruefeHart` (H1–H14), alle Datensätze, mehrere Startwerte |
| 3 Ausfall minimal | K1 = untere Schranke aus dem Fluss; für kleine Datensätze zusätzlich Gegenprobe per vollständiger Suche |
| 4 Eigene Lehrkraft bevorzugt | Konstruierter Fall mit zwei gleich ausfallarmen Lösungen; Ergebnis hat kleineres K2 |
| 5 Reihenfolge der Kette | Fälle, in denen genau Stufe n die erste mögliche ist, für n = 1…7 |
| 6 Kapazität bei Aufteilung | Eigenschaftstest: Summe Gäste + eigene Schüler ≤ Kapazität in allen Zielräumen |
| 7 Fehlerhafte Dateien | Falsche Referenz, fehlendes Pflichtfeld, `schemaVersion: 99` → Fehlerliste mit Pfad, Zustand unverändert (Hash-Vergleich) |
| 8 Überhang | Datensatz *ueberhang*: K1 = 0, H7 und Reserve eingehalten, Zweitbesetzungen vergeben, H10 |
| 9 Aufrücken | Ausfall einer Hauptlehrkraft mit Zweitbesetzung → Stufe 1, Raum/Slot gleich, kein Ausfall |
| 10 Abziehen | Vertretung durch eine Lehrkraft, die nur Zweitbesetzung ist → andere Klasse behält Hauptlehrkraft |
| 11 Keine Leerstunden | Ausfall in der Tagesmitte → Nachrücken oder `aufsicht`; H12 in jedem Vertretungsplan |
| 12 Pausenaufsichten | Alle Datensätze: K1A = Schranke aus der Vorprüfung (0 bei ausreichendem Soll); H13/H14 für jede Lehrkraft; Datensatz mit knappem Aufsichtssoll |
| 13 Aufsichtsvertretung | Abwesenheit über drei Tage: genau die Aufsichten dieser Daten werden vertreten, Regelplan und andere Daten byte-gleich |

Zusätzlich: Leistungstest *gross* (≤ 30 s, Ziel ≤ 15 s in Node), Reproduzierbarkeit (gleicher Startwert ⇒ identischer Plan), Playwright-Rauchtests für jeden Reiter, Drag-and-drop und Import per Datei.

## 7. Risiken und Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
| --- | --- |
| H12 macht viele Instanzen schwer lösbar (lückenlose Tage + gesperrte Lehrkraft-Slots) | Tagesprofile mit variablem Start; Rand-Verkürzung statt Lücke; zurückgestellte Einheiten laufen durch die Kette |
| Leistung im Browser | Typisierte Arrays, inkrementelle Kosten-Deltas, Worker; früh mit Datensatz *gross* messen (M4) |
| Lexikografie mit SA | Harte Ablehnung jeder Verschlechterung in K1–K5, Annealing nur auf K6 |
| Nachvollziehbarkeit | Jede Entscheidung erhält einen Begründungsdatensatz (Regel, Stufe, Kostenanteil), im Bericht und per Tooltip sichtbar |
| Eine Datei wird groß und unübersichtlich | Modularer Quelltext + Build; Ergebnisdatei mit Modul-Kommentarköpfen |

## 8. Unklarheiten in der Spezifikation und getroffene Annahmen

Diese Punkte sollten vor bzw. während M1 bestätigt werden; bis dahin gelten die Annahmen.

1. **Abnahme 2 nennt H1–H9**, es gibt aber H1–H14. *Annahme:* Geprüft werden H1–H14.
2. **Datum vs. fester Wochenplan:** *Geklärt:* Vertretungen sind datumsgenau (Abschnitt 4.9), der Regelplan bleibt unverändert.
3. **Pausen im Zeitraster:** *Geklärt:* `zeitraster.pausen` mit `vorStunde`, `name`, `aufsichten`; Voreinstellung vor der 1. und dann vor jeder zweiten Stunde. Die Pausen dienen auch W4 („Sport nicht nach der Pause“).
4. **Teilzeitfaktor** steht im Datenmodell, nicht im JSON. *Annahme:* nur informativ (`teilzeitfaktor`, optional); maßgeblich sind `sollStunden`/`maxStunden`.
5. **„Hauptfach“ für W4** ist nicht definiert. *Annahme:* neues optionales Feld `hauptfach: true` am Fach.
6. **Aufteilung und K1:** K1 zählt nur `entfaellt`. *Annahme:* `aufsicht` zählt laut §2 als Ausfall, `aufgeteilt` und `doppeltBetreut` nicht (sie gehen in K4 ein).
7. **Gewicht der Aufteilung gegenüber Doppelbetreuung in K4** ist nicht beziffert. *Annahme:* Faktor 3, als Einstellung `gewichtAufteilung`.
8. **Schülergruppen bei Aufteilung:** Gruppen haben kein Datenmodell. *Annahme:* Gruppen werden nur im Vorschlag festgelegt und in `verteilung` gespeichert (optional `gruppe`).
9. **Raum-`gesperrt` und `nahe`:** Format wie bei Lehrkräften (`{tag, stunden}`); `nahe` wird symmetrisch behandelt.
10. **Höchstzahl zusammenhängender Doppelbetreuungsstunden** („2, einstellbar“) fehlt im Einstellungsschema. *Annahme:* `maxDoppelbetreuungStundenAmStueck: 2`.
11. **Vertretungsreserve-Rundung:** *Annahme:* `ceil(sollStunden × prozent / 100)`.
12. **Pausenaufsicht und Stundenkontingent:** *Bestätigt:* Aufsichten zählen nicht gegen Soll-/Höchststunden; sie haben ein eigenes Soll (`aufsichtenProWoche`), das im Regelplan Obergrenze ist (H14). Im Vertretungsfall sind Mehraufsichten erlaubt und werden ausgewiesen.
13. **Rang der Aufsichten:** *Bestätigt:* Unbesetzte Aufsichten (K1A) stehen direkt hinter dem Unterrichtsausfall (K1) und vor allen übrigen Zielen.
14. **Anwesenheit für Aufsicht:** *Bestätigt:* hart nur „Unterricht an diesem Tag“ (H13); dass die Aufsicht direkt an eigenen Unterricht grenzt, ist weich (W12).
15. **Aufsichtsbereiche** (Hof, Flur …): *Bestätigt:* nicht vorgesehen; je Pause zählt nur die Anzahl.
16. **Zuordnung Fach ↔ Fachraum:** *Bestätigt:* `raum.typ` ist `klassenraum`, `fachraum`, `turnhalle` oder `schwimmhalle`. Fachräume erhalten zusätzlich `fachraumtyp` (z. B. `nawi`, `musik`, `kunst`, `informatik`); `fach.raumtyp` ist `null`, `turnhalle`, `schwimmhalle` oder ein Fachraumtyp. H5 prüft „passender Raumtyp“ über diese Felder.
17. **Festlegungen aus M1 (Import/Export):**
    - Pflicht sind nur `schemaVersion`, `zeitraster` und die Kernfelder je Eintrag (z. B. `id`, `name`, `kuerzel`, `sollStunden`). Fehlende optionale Felder ergänzt der Import mit Standardwerten (z. B. `maxStunden = sollStunden`, leere Listen, Standardgewichte).
    - IDs sind je Sammlung eindeutig; Kürzel (Fächer, Lehrkräfte) und Namen (Räume, Klassen) ohne Rücksicht auf Groß-/Kleinschreibung.
    - Fehler verhindern den Import; *Warnungen* (z. B. Heimatraum kleiner als Klasse, kein Raum für den Raumtyp eines Fachs, Stundentafel größer als das Raster) werden nur angezeigt.
    - Teil-Dateien tragen `teil: "stammdaten"` (alles außer `plan`) bzw. `teil: "plan"`. Ein Plan-Import wird gegen die vorhandenen Stammdaten geprüft. Passt der vorhandene Plan nicht zu neu importierten Stammdaten, wird der Import abgelehnt und „Stammdaten übernehmen und Plan verwerfen“ angeboten.
    - Ein vollständiger Import gilt als gespeicherter Stand; nach einem Teil-Import gilt der Gesamtstand als ungespeichert, bis vollständig exportiert wird.
    - Abwesenheiten sind auch für Räume möglich (`raeume[].abwesenheiten`, datumsgenau).
18. **Festlegungen aus M2 (Regeln und Kosten)** – Auslegung mehrdeutiger Stellen:
    - *Statusgruppen:* „belegt“ (H12) ist jede Stunde außer `entfaellt`; „abgedeckt“ (K1) jede außer `entfaellt` und `aufsicht`; Fachunterricht (K2, K3, H8) sind `regulaer` und `vertreten`.
    - *H1 Doppelbetreuung:* Eine Lehrkraft darf in genau zwei Klassen eines Slots stehen, wenn beide Einträge über `mitKlasse` verbunden sind und einer den Status `doppeltBetreut` hat. Die Grenzen je Tag zählen zusammenhängende Folgen von Doppelbetreuungsstunden.
    - *H5:* Ein Fach mit Raumtyp braucht genau diesen Typ; Fachräume, Turn- und Schwimmhallen sind Fächern mit passendem Raumtyp vorbehalten. Jede Stunde außer `entfaellt`/`aufgeteilt` braucht einen Raum.
    - *H8* gilt nur für `regulaer`; Vertretungen dürfen fachfremd sein (zählt in K3).
    - *H11:* Sobald eine Lehrkraft Zweitbesetzungsstunden hat, darf ihre Gesamtstundenzahl `Soll − Reserve` nicht übersteigen. Hauptunterricht allein darf bis zur Höchstgrenze gehen (Ausfall hat Vorrang).
    - *H13:* Eine Aufsicht vor Stunde s ist gesperrt, wenn Stunde s−1 oder s gesperrt ist (Frühaufsicht: Stunde 1).
    - *H7, H11, H14* sind Wochenregeln und gelten im Regelplan; im Tagesplan (Vertretung) prüft die Vertretungsplanung sie mit dem Wochenkontext.
    - *K1A:* Aufsichtsbedarf entsteht für eine Pause vor Stunde s an einem Tag, wenn mindestens eine Klasse an diesem Tag Stunde s belegt.
    - *K2* zählt Stunden (wie in §3); die Art der Vertretung (Klassenlehrkraft, Lehrkraft der Klasse, qualifiziert, Notfall) steht im Posten. Die Reihenfolge erzwingt die Eskalationskette.
    - *K5:* je Lehrkraft min(Soll − Reserve bzw. Höchstgrenze − Ist, Zahl der Slots, in denen sie frei und nicht gesperrt ist und eine Klasse Fachunterricht mit freiem Platz für eine Zweitbesetzung hat).
    - *W1:* späterer Beginn als Stunde 1 plus Stunden nach dem Ziel-Tagesende `⌈Wochenstunden/Tage⌉`. *W4:* „Vormittag“ = Beginn vor 12:00; „Sport“ = Fach mit Raumtyp Turn- oder Schwimmhalle. *W5:* weitere Blöcke desselben Fachs am Tag sowie Blöcke über 2 (bzw. über 1 bei nicht blockbaren Fächern). *W6:* Raumwechsel plus Stunden außerhalb des Heimatraums ohne Raumtyp-Bedarf. *W7:* Summe der Abweichungen vom Tagesmittel. *W9:* 1 − Priorität (Mittel aus Schülerzahl, niedriger Stufe, Knappheit des Fachs; gleiche Werte neutral). *W12:* Aufsicht ohne eigenen Unterricht direkt davor/danach sowie mehr als eine Aufsicht am Tag.
19. **Festlegungen aus M4 (Planer)** – Abweichungen vom Verfahren in §6, bewusst einfach gehalten:
    - *Ausfall vor Reserve:* Reicht das Kontingent bis `Soll − Reserve` nicht, nutzt die Zuweisung die Reserve und Mehrarbeit bis zur Höchstgrenze (Ziel 1 hat Vorrang; H7 erlaubt es). Die Reserve bleibt bei Zweitbesetzungen unangetastet (H11). Die untere Schranke für K1 berücksichtigt das.
    - *Doppelstunden* sind keine festen Einheiten der Dauer 2, sondern ein Optimierungsziel (W3). So bleibt die Konstruktion einfach und robust; gewünschte Doppelstunden entstehen in der Nachoptimierung.
    - *Klassentage beginnen immer in der 1. Stunde* (Ziel W1); Tageslängen verschieben sich in der Optimierung, Lücken entstehen nie.
    - *Zweitbesetzung nach der Optimierung:* Die Nachoptimierung ordnet nur den Hauptunterricht; danach werden Zweitbesetzungen vergeben (Priorität W9, Beständigkeit W10, möglichst angrenzend an eigene Stunden) und zuletzt die Aufsichten.
    - *Reproduzierbarkeit:* Die Zahl der Optimierungsschritte ist fest (3000 je Stunde, höchstens 4 Mio.). Greift vorher das Zeitbudget, wird das im Ergebnis vermerkt.
    - *Nicht unterstützt:* Klassen mit gemeinsamem Heimatraum; Tausch von Lehrkräften zwischen Klassen in der Optimierung.
20. **Festlegungen aus M3 und M5 (Bedienung):**
    - *Kurzschreibweisen* in Tabellen: Qualifikationen „MA 1–4; DE 5–10“ (ohne Stufen: 1–13), Sperrzeiten „Fr 5–6; Mo 1, 3“, Nachbarräume als Raumnamen (wird symmetrisch gepflegt).
    - *Jede Bearbeitung* wird vor der Übernahme vollständig geprüft (Schema und Querprüfungen); harte Regeln des Plans (H1–H14) blockieren dagegen nicht, sondern werden angezeigt und markieren den Plan als ungültig (§4).
    - *Verlauf:* 100 Schritte; auch Import, Zurücksetzen und „Plan erstellen“ lassen sich rückgängig machen. Strg+Z/Y wirken außerhalb von Eingabefeldern (dort gilt das Rückgängig des Browsers).
    - *Zuordnung:* In der Matrix ist je Klasse und Fach eine Zweitlehrkraft einstellbar; mehrere sind im JSON möglich, die Eingabe ersetzt sie. Eine Lehrkraft wechselt automatisch die Rolle, wenn sie in der anderen Spalte eingetragen wird.
    - *Zeitraster:* Stunden werden am Tagesende angehängt; entfernt werden kann nur die letzte und nur, wenn sie nicht verwendet wird.
    - *Plan-Ansicht:* Verschieben auf einen belegten Slot derselben Klasse tauscht beide Stunden (Lücken entstehen so nicht); Ablegen auf einen freien Slot verschiebt. Zweitbesetzung nur in Unterrichtsstunden mit Hauptlehrkraft. Die Plan-Ansicht zeigt den Regelplan; datumsgenaue Vertretungen folgen in M6.
21. **Festlegungen aus M6 (Vertretung):**
    - *Darstellung:* Eine Vertretung ersetzt für ihr Datum den Eintrag des Regelplans mit gleicher Klasse und Stunde (oder ergänzt ihn). Status `regulaer` steht für verschobene Stunden mit der eigenen Lehrkraft (Umplanen, Nachrücken, Ersatzraum, entfallene Zweitbesetzung); das Feld `grund` enthält einen Code (z. B. `zweitbesetzungRueckt`, `umgeplant`, `nachgerueckt`).
    - *Zulässigkeit:* Ein Kandidat gilt nur, wenn er an keinem betroffenen Datum einen neuen Verstoß gegen harte Regeln erzeugt und keine Lehrkraft ihre Höchststunden der Woche überschreitet. Die Vertretungsreserve darf hier genutzt werden.
    - *Umplanen (Stufe 2)* ist ein Tausch mit einer regulären Stunde derselben Klasse an einem anderen Unterrichtstag derselben Woche, an dem die ausgefallene Lehrkraft anwesend ist.
    - *Stufe 4* umfasst in dieser Reihenfolge: Springerpool, freie qualifizierte Lehrkräfte, Abzug einer qualifizierten Zweitbesetzung, Notfalleinsatz ohne Fachqualifikation (frei oder als abgezogene Zweitbesetzung). Ein Notfalleinsatz ist damit besser als Doppelbetreuung, Aufteilung oder Aufsicht (Ziel 1 vor Ziel 3/4).
    - *Stufe 7:* Am Tagesrand Entfall; in der Tagesmitte zuerst Nachrücken der folgenden Stunden (die letzte entfällt), sonst Aufsicht. Gibt es keine regelkonforme Lösung, wird ein Entfall mit Warnung „prüfen“ vorgeschlagen.
    - *Aufteilung:* möglichst wenige Zielklassen (gleiche Stufe zuerst), gleichmäßig nach freien Plätzen; war die Klasse in der Nachbarstunde aufgeteilt, wird Stufe 7 vorgezogen.
    - *Raumausfall:* Ersatzraum gleicher Art mit genug Plätzen (Nachbarraum bevorzugt), sonst Aufteilung, sonst Entfall/Nachrücken.
    - *Vorschläge* werden der Reihe nach berechnet (Datum, Pause/Stunde) und bauen aufeinander auf; nach jeder Übernahme wird neu gerechnet. Verworfene Vorschläge bleiben bis „Vorschläge berechnen“ ausgeblendet.
22. **Offene fachliche Fragen** (Bundesland, Obergrenzen für Gäste, PDF/CSV-Export, Priorität der Zweitbesetzung): werden konfigurierbar gehalten bzw. sind nicht Teil der ersten Version; CSV-Export ließe sich in M7 ergänzen.

Neue optionale Felder ändern `schemaVersion: 1` nicht, da unbekannte Felder ohnehin erhalten bleiben und alle neuen Felder Standardwerte haben.

## 9. Stand der Umsetzung

| Meilenstein | Stand |
| --- | --- |
| M0 Grundgerüst | erledigt (25.11.2026): Build `tools/build.mjs`, Vorlage mit CSP, Kern-Module `Hilfen` (PRNG, IDs, Datum) und `Modell` (Standardwerte, Pausen), Blob-Worker mit Ping, Reiter-Gerüst mit Tastaturbedienung, Testdatengenerator mit vier Datensätzen, 31 Kern-/Build-Tests, 5 Browser-Tests, CI-Workflow |
| M1 Daten & Persistenz | erledigt (25.11.2026): Module `Schema` (deklaratives Schema, Validator mit Pfaden, Querprüfungen, Standardwerte, kanonische Reihenfolge, Migrationsrahmen) und `Io` (Export gesamt/Stammdaten/Plan, atomarer Import, Teil-Import); Reiter „Daten“ mit Dateiauswahl, Drag-and-drop, Rückfrage mit Export-Angebot, Fehlerliste mit Pfad, Zurücksetzen, Speicherstand und `beforeunload`-Warnung. Abnahme 1 und 7 automatisiert (Kern und Browser) |
| M2 Regeln & Kosten | erledigt (25.11.2026): Module `Index` (Nachschlagestrukturen), `Regeln` (H1–H14 für Wochen- und Tagesplan, Verstöße mit betroffenen Einträgen) und `Kosten` (Vektor K1, K1A, K2–K6 mit W1–W12 und Einzelposten); von Hand nachgerechnete Testschule; Reiter „Daten“ zeigt Gültigkeit und Kostenvektor des Regelplans |
| M4 Planer | erledigt (25.11.2026): Module `Fluss` (Minimalkosten-Maximalfluss) und `Planer` (Bedarf, Vorprüfung, Zuweisung mit unterer Ausfall-Schranke, Konstruktion mit lückenlosen Klassentagen und Tabu-Konfliktsuche, Simulated Annealing, Räume, Zweitbesetzung, Aufsichten); Worker-Protokoll mit Fortschritt und Abbruch; Reiter „Planung“ mit Optionen, Gewichten und Ergebnis. Großer Datensatz (30 Klassen, 60 Lehrkräfte) in ca. 3 s. Abnahme 2, 3, 4, 8, 12 automatisiert |
| M3 Stammdaten-UI | erledigt (25.11.2026): Rückgängig/Wiederholen (100 Schritte, Strg+Z/Y), jede Bearbeitung geprüft über `App.aendere`; Modul `Verweise`; bearbeitbare Tabellen (Enter/↑/↓/Esc) für Lehrkräfte, Fächer, Räume, Klassen, Zeitraster mit Pausen, Schule; Löschen gesperrt mit Verweisliste; Matrix Klasse × Fach mit Soll/Ist-Warnungen |
| M5 Plan-Ansicht | erledigt (25.11.2026): Modul `Bearbeitung`; Wochenraster Klasse/Lehrkraft/Raum/Aufsicht mit Pausenzeilen; Drag-and-drop und Tastatur (aufnehmen, bewegen, ablegen, Entf); Konflikte rot mit ⚠ und Regelnummer, Konfliktliste mit Sprung; Zweitbesetzung aus „Freie Kontingente“, Aufsichten aus „Aufsichtssoll offen“; Druckansicht je Entität oder alle; Reaktionszeit im großen Plan deutlich unter 100 ms |
| M6 Vertretung | erledigt (25.11.2026): Modul `Vertretung` (Tagesplan je Datum, betroffene Stunden und Aufsichten, Eskalationskette mit Prüfung jedes Kandidaten auf neue Verstöße und Höchststunden, Alternativen, Ausfallbericht); Reiter „Ausfall“ mit Erfassen von Abwesenheiten, Vorschlägen (übernehmen, andere Lösung wählen, verwerfen, alle übernehmen) und Tagesvertretungsplan mit Konfliktprüfung und Druck. Abnahme 5, 6, 9, 10, 11, 13 automatisiert |
| M7 Bericht & Feinschliff | erledigt (25.11.2026): Modul `Bericht` und Reiter „Bericht“ (Überblick, Ausfall je Klasse und Fach, Vertretungsquote, Auslastung, Aufsichten, weiche Regeln, Druck); Kontrastprüfung aller Farbpaare (WCAG AA, Fokusrahmen ≥ 3 : 1), Prüfung zugänglicher Namen und der Breite 1280 px in allen Reitern; Nachweisliste [Abnahme.md](Abnahme.md). Nicht geprüft: Firefox, Safari, Edge (nur Chromium verfügbar) |

## 10. Nächster Schritt

Die Annahmen in Abschnitt 8 sind bestätigt (25.11.2026). Alle Meilensteine M0–M7 sind umgesetzt. Offen sind die fachlichen Fragen in Abschnitt 10 der Spezifikation (Bundesland, Obergrenzen, PDF/CSV-Export) sowie Tests in Firefox, Safari und Edge.
