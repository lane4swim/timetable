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
│   │   ├── 40-kosten.js        # Kostenvektor K1–K6, weiche Regeln W1–W10, lexikografischer Vergleich
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
| **M1** Daten & Persistenz | Modell, Schema-Validator mit Pfaden, Migrationen, Import/Export voll + teilweise, Erhalt unbekannter Felder | Abnahme 1, 7 |
| **M2** Regeln & Kosten | H1–H14, W1–W12, Kostenvektor, Erklärungen | Grundlage für alle weiteren |
| **M3** Stammdaten-UI | Reiter Stammdaten, Zuordnung, Daten; Undo/Redo; Tastaturbedienung | Daten vollständig pflegbar |
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
12. **Pausenaufsicht und Stundenkontingent:** *Annahme:* Aufsichten zählen nicht gegen Soll-/Höchststunden; sie haben ein eigenes Soll (`aufsichtenProWoche`), das im Regelplan Obergrenze ist (H14). Im Vertretungsfall sind Mehraufsichten erlaubt und werden ausgewiesen.
13. **Rang der Aufsichten:** *Annahme:* Unbesetzte Aufsichten (K1A) stehen direkt hinter dem Unterrichtsausfall (K1) und vor allen übrigen Zielen.
14. **Anwesenheit für Aufsicht:** *Annahme:* hart nur „Unterricht an diesem Tag“ (H13); dass die Aufsicht direkt an eigenen Unterricht grenzt, ist weich (W12).
15. **Aufsichtsbereiche** (Hof, Flur …) sind nicht vorgesehen; je Pause zählt nur die Anzahl.
16. **Offene fachliche Fragen** (Bundesland, Obergrenzen für Gäste, PDF/CSV-Export, Priorität der Zweitbesetzung): werden konfigurierbar gehalten bzw. sind nicht Teil der ersten Version; CSV-Export ließe sich in M7 ergänzen.

Neue optionale Felder ändern `schemaVersion: 1` nicht, da unbekannte Felder ohnehin erhalten bleiben und alle neuen Felder Standardwerte haben.

## 9. Nächster Schritt

Start mit **M0** (Build, Testrahmen, Testdatensätze inkl. Pausen und Aufsichtssoll) und **M1** (Schema, Validierung, Import/Export). Offen und für M1 relevant sind die Annahmen 12 (Aufsicht zählt nicht gegen das Stundenkontingent) und 15 (keine Aufsichtsbereiche).
