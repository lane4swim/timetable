# Spezifikation Stundenplanplanung

Nov 11, 2026 · @Alexander Behnke

## 1. Ziel und Umfang

Das Programm erstellt aus Lehrkräften, Räumen und Klassenzuordnungen einen Stundenplan, der Unterrichtsausfall minimiert und möglichst viele Stunden von der eigenen Klassenlehrkraft erteilen lässt. Bei Personalmangel schlägt es Doppelbetreuung oder die Verteilung einer Klasse auf andere Klassen vor. Bei Personalüberhang (mehr Lehrkräfte als Klassen) setzt es die zusätzlichen Lehrkräfte als Zweitbesetzung ein, sodass zwei Lehrkräfte eine Klasse gleichzeitig betreuen.

**Im Umfang:**

- Erfassung von Stammdaten (Lehrkräfte, Qualifikationen, Stundenkontingente, Räume, Klassen, Stundentafel)
- Automatische Erstellung eines festen Wochenplans (Regelplan, keine A/B-Wochen)
- Planung der Pausenaufsichten (Regelplan) mit individuellem Aufsichtssoll je Lehrkraft
- Neuberechnung bei Ausfall einer Lehrkraft oder eines Raums (Vertretungsplan, datumsgenau), einschließlich Aufsichtsvertretung
- Manuelle Korrektur per Drag-and-drop mit sofortiger Regelprüfung
- Persistenz ausschließlich über JSON-Export und -Import

**Nicht im Umfang:** A/B-Wochenpläne, klassenübergreifende Kurse und Bänder (Wahlpflicht, Religion/Ethik in Gruppen), Mehrbenutzerbetrieb, Server, Datenbank, Anbindung an Schulverwaltungssysteme, rechtsverbindliche Prüfung von Landesvorgaben (Pflichtstundenverordnung, Aufsichtsrecht).

**Technik:** Eine einzige HTML-Datei mit eingebettetem CSS und JavaScript (ES2020, ohne Frameworks und ohne Netzwerkzugriff). Sie läuft lokal im Browser per Doppelklick.

## 2. Datenmodell

Alle Entitäten haben eine stabile `id` (String, vom Programm vergeben) und werden über diese referenziert. Das Zeitraster ist frei konfigurierbar.

| Entität | Wichtige Felder | Bedeutung |
| --- | --- | --- |
| Zeitraster | Tage (Mo–Fr), Stunden pro Tag (1–10), Pausen mit Aufsichtsbedarf, Doppelstundenpaare | Rahmen aller Planungen |
| Pause | Lage (vor Stunde n), Name, Anzahl erforderlicher Aufsichten (0 = keine Aufsicht) | Aufsichtsbedarf je Tag |
| Fach | Name, Kürzel, benötigter Raumtyp (optional: Turnhalle, Schwimmhalle oder ein Fachraumtyp), Blockung erlaubt (ja/nein), Hauptfach (ja/nein) | Unterrichtsinhalt |
| Lehrkraft | Name, Kürzel, Qualifikationen (Fächer + Stufenbereich), Soll-Stunden pro Woche, Mindest-/Höchstgrenze, Teilzeitfaktor, Aufsichten pro Woche (individuell), Abwesenheiten, nicht verfügbare Zeitfenster | Personalressource |
| Raum | Name, Raumtyp (Klassenraum, Fachraum, Turnhalle, Schwimmhalle), Fachraumtyp (bei Fachräumen, z. B. NaWi, Musik), Kapazität, Sperrzeiten, Abwesenheiten (datumsgenau) | Raumressource |
| Klasse | Name, Stufe, Schülerzahl, Klassenlehrkraft, Heimatraum, Stundentafel | Planungsobjekt |
| Stundentafel | je Fach: Wochenstunden, Doppelstunde gewünscht (ja/nein), am Tagesende gewünscht (ja/nein) | Bedarf der Klasse |
| Zuordnung (Fest) | Klasse, Fach, Lehrkraft, Rolle (Haupt oder Zweit) | Vorgabe: Wer unterrichtet was dauerhaft; je Klasse und Fach 1–2 Lehrkräfte |
| Abwesenheit | Lehrkraft oder Raum, Von, Bis, Grund (optional) | Auslöser für Vertretungsplanung |
| Unterrichtsstunde (Ergebnis) | Klasse, Fach, Lehrkräfte (1–2; die erste ist die Hauptlehrkraft), Raum, Tag, Stunde, Status | Ergebnis der Planung |
| Pausenaufsicht (Ergebnis) | Tag, Pause (vor Stunde n), Lehrkraft | Ergebnis der Aufsichtsplanung |

**Status einer Unterrichtsstunde:** `regulär`, `vertreten` (andere Lehrkraft), `doppelt betreut` (eine Lehrkraft, zwei Klassen), `aufgeteilt` (Klasse wird auf andere Klassen verteilt), `entfällt`.

**Zusätzlicher Status `aufsicht`:** Betreuung der Klasse ohne Fachunterricht durch eine freie Lehrkraft. Sie zählt in Ziel 1 als Ausfall, ist aber keine Leerstunde (H12).

**Qualifikation:** Eine Lehrkraft darf ein Fach nur in Stufen unterrichten, für die sie qualifiziert ist. Zusätzlich gibt es die Stufe *Notfalleinsatz*: Eine Lehrkraft ohne Fachqualifikation darf Betreuung oder Vertretung übernehmen, aber keine reguläre Fachstunde (siehe Abschnitt 5).

**Zweitbesetzung und Personalüberhang:** Es können mehr Lehrkräfte als Klassen vorhanden sein. Pro Klasse und Zeitslot sind bis zu zwei Lehrkräfte möglich. Die erste ist die Hauptlehrkraft (trägt Unterricht und Verantwortung), die zweite die Zweitbesetzung (Team-Teaching, Förderung, Inklusion, Absicherung bei Ausfall). Die Zweitbesetzung nutzt den Raum der Klasse und braucht keine Fachqualifikation. Lehrkräfte ohne eigene Hauptzuordnung oder mit ungenutztem Kontingent bilden den **Springerpool**: Sie werden zuerst für Vertretungen und danach als Zweitbesetzung eingesetzt. Vom Sollkontingent jeder Lehrkraft bleibt eine einstellbare **Vertretungsreserve** (Standard 10 %) für Vertretungen frei.

**Pausen und Pausenaufsicht:** Pausen liegen vor ausgewählten Stunden. Voreinstellung: vor der 1. Stunde (Frühaufsicht) und danach vor jeder zweiten Stunde (vor der 3., 5., 7., 9. Stunde). Lage und Zahl der Pausen sind konfigurierbar. Für jede Pause ist eine konfigurierbare Anzahl an Aufsichten erforderlich; der Bedarf gilt an jedem Unterrichtstag. Jede Lehrkraft hat ein individuell festgelegtes **Aufsichtssoll** (Anzahl Aufsichten pro Woche, 0 ist zulässig). Aufsichten zählen nicht gegen das Stundenkontingent (Soll-, Mindest-, Höchststunden).

**Datumsbezug:** Der Regelplan ist ein fester Wochenplan. Vertretungen werden datumsgenau geplant: Eine Abwesenheit (Von–Bis) betrifft die konkreten Unterrichtstage in diesem Zeitraum; jeder Tag wird über seinen Wochentag dem Regelplan zugeordnet. Vertretungen gelten nur für ihr Datum und verändern den Regelplan nicht.

## 3. Planungsziele

Die Ziele gelten in strikter Reihenfolge (lexikografisch): Ein Plan, der bei Ziel 1 besser ist, schlägt jeden Plan, der bei Ziel 1 schlechter, aber bei den späteren Zielen besser ist. Erst bei Gleichstand entscheidet das nächste Ziel.

1. **Unterrichtsausfall minimieren.** Zählt jede Klassenstunde der Stundentafel, die nicht durch eine Hauptlehrkraft in einem Raum abgedeckt ist (Status `entfällt`). Eine Zweitbesetzung deckt keine Stunde ab, die sonst ohne Hauptlehrkraft bliebe.
   - **1A. Pausenaufsichten besetzen.** Zählt jede erforderliche Aufsicht, die keiner Lehrkraft zugewiesen ist. Ziel 1A steht unmittelbar hinter Ziel 1. Da Aufsichten in den Pausen und Unterricht in den Stunden liegen, konkurrieren beide nur über die Anwesenheit der Lehrkräfte.
2. **Eigene Klassen unterrichten.** Zählt jede abgedeckte Stunde, in der die Hauptlehrkraft nicht die für Klasse und Fach festgelegte Lehrkraft ist (zuerst Vertretung durch Klassenlehrkraft der Klasse, dann durch fachlich qualifizierte Lehrkraft, dann Notfalleinsatz). Eine festgelegte Zweitlehrkraft der Klasse zählt als eigene Lehrkraft.
3. **Fachqualifikation wahren.** Zählt Stunden, die fachfremd erteilt werden. Die Zweitbesetzung ist davon ausgenommen.
4. **Betreuungsform schonen.** Zählt Stunden mit Doppelbetreuung (eine Lehrkraft, zwei Klassen) und Stunden, in denen eine Klasse aufgeteilt wird. Aufteilung wiegt schwerer als Doppelbetreuung.
5. **Kontingente nutzen (Zweitbesetzung).** Zählt die Stunden, die Lehrkräfte unter ihrer Sollstundenzahl bleiben, obwohl eine Zweitbesetzung möglich wäre. Die Vertretungsreserve (Standard 10 % der Sollstunden) bleibt ausgenommen. Das Ziel entfällt, wenn die Zweitbesetzung abgeschaltet ist.
6. **Planqualität.** Gewichtete Summe weicher Regeln aus Abschnitt 4 (kompakter Schultag, Doppelstunden, Raumwechsel, gleichmäßige Verteilung, Lücken bei Lehrkräften, Aufsichtssoll und Lage der Aufsichten). Leerstunden für Klassen sind keine weiche Regel, sie sind durch H12 ausgeschlossen.

Technisch berechnet das Programm einen Kostenvektor `(K1, K1A, K2, K3, K4, K5, K6)` und vergleicht ihn lexikografisch. Ein einzelnes zusammengesetztes Gewicht ist nicht vorgesehen, damit die Reihenfolge nachvollziehbar bleibt. Die Oberfläche zeigt den Vektor für jeden Plan an.

## 4. Regeln

Harte Regeln dürfen in keinem erzeugten Plan verletzt sein. Bei manueller Bearbeitung zeigt das Programm Verstöße sofort an und blockiert den Export nicht, markiert aber den Plan als ungültig.

| Nr. | Harte Regel |
| --- | --- |
| H1 | Eine Lehrkraft unterrichtet pro Zeitslot höchstens eine Klasse; Ausnahme: genehmigte Doppelbetreuung (Abschnitt 5). |
| H2 | Eine Klasse hat pro Zeitslot höchstens eine Veranstaltung. Sie darf von bis zu zwei Lehrkräften gleichzeitig betreut werden (H10). |
| H3 | Ein Raum ist pro Zeitslot höchstens einmal belegt. Ausnahme: Doppelbetreuung in einem Raum, wenn Kapazität reicht. |
| H4 | Lehrkräfte werden nicht in gesperrten Zeitfenstern oder bei Abwesenheit eingesetzt. |
| H5 | Räume werden nicht in Sperrzeiten genutzt; Fachräume, Turn- und Schwimmhallen nur für Fächer mit passendem Raumtyp, und Fächer mit Raumtyp nur in einem solchen Raum. |
| H6 | Raumkapazität ≥ Schülerzahl (bei Aufteilung: Summe der anwesenden Schüler:innen). |
| H7 | Wochenstunden einer Lehrkraft ≤ individuelle Höchstgrenze. Vertretungs- und Zweitbesetzungsstunden zählen mit. |
| H8 | Reguläre Fachstunden nur durch qualifizierte Hauptlehrkräfte. Die Zweitbesetzung braucht keine Fachqualifikation. |
| H9 | Pro Klasse und Fach nicht mehr Stunden als in der Stundentafel. |
| H10 | Pro Klasse und Zeitslot höchstens zwei Lehrkräfte (einstellbar, Standard 2). Die zweite ist immer als Zweitbesetzung gekennzeichnet. |
| H11 | Eine Zweitbesetzung nutzt den Raum der Klasse und belegt keinen eigenen. H1, H4 und H7 gelten für sie unverändert. Die Vertretungsreserve jeder Lehrkraft bleibt unangetastet. |
| H12 | Keine Leerstunden für Schüler:innen: Die Stunden einer Klasse liegen an jedem Tag lückenlos hintereinander. Pausen zählen nicht als Lücke. Eine Betreuungs-, Aufsichts- oder Aufteilungsstunde zählt als belegte Stunde. Die Regel gilt im Regelplan und in jedem Vertretungsplan. |
| H13 | Pausenaufsicht nur durch anwesende Lehrkräfte: nicht bei Abwesenheit, nicht in gesperrten Zeitfenstern (gesperrt sind die angrenzenden Stunden vor und nach der Pause; bei der Frühaufsicht die 1. Stunde) und nur an Tagen, an denen die Lehrkraft Unterricht oder Zweitbesetzung hat. Je Pause höchstens eine Aufsicht pro Lehrkraft. |
| H14 | Im Regelplan übernimmt eine Lehrkraft höchstens so viele Aufsichten pro Woche wie ihr Aufsichtssoll. Im Vertretungsplan sind Mehraufsichten zulässig und werden im Bericht ausgewiesen. |

| Nr. | Weiche Regel | Voreingestelltes Gewicht |
| --- | --- | --- |
| W1 | Kompakter Schultag: Klassen beginnen möglichst in der ersten Stunde und enden möglichst früh | 10 |
| W2 | Keine Leerstunden bei Lehrkräften | 5 |
| W3 | Doppelstunden dort, wo die Stundentafel sie wünscht | 8 |
| W4 | Hauptfächer eher am Vormittag, Sport nicht in der ersten Stunde nach der Pause | 3 |
| W5 | Gleichmäßige Verteilung eines Fachs über die Woche (nicht zwei Einzelstunden am selben Tag) | 4 |
| W6 | Wenige Raumwechsel pro Klasse und Tag; Klasse bleibt möglichst im Heimatraum | 2 |
| W7 | Gleichmäßige Tageslast der Lehrkräfte (Abweichung vom Tagesmittel) | 2 |
| W8 | Unterschreiten der Mindeststundenzahl einer Lehrkraft | 6 |
| W9 | Zweitbesetzung gezielt einsetzen: bevorzugt in Klassen mit hoher Schülerzahl, niedriger Stufe oder Fächern mit wenigen qualifizierten Lehrkräften | 4 |
| W10 | Beständigkeit: dieselbe Zweitlehrkraft in derselben Klasse und demselben Fach über die Woche | 3 |
| W11 | Aufsichtssoll erfüllen: je Aufsicht, die eine Lehrkraft unter ihrem Soll bleibt | 5 |
| W12 | Aufsicht angrenzend an eigenen Unterricht: Die Lehrkraft unterrichtet direkt vor oder nach der Pause (bei Frühaufsicht: in der 1. Stunde); keine Aufsichten gehäuft an einem Tag | 3 |
| W13 | Fach am Tagesende, wo die Stundentafel es wünscht: je Stunde des Fachs zählt jede Stunde eines anderen Fachs, die an diesem Tag danach folgt | 4 |

Die Gewichte sind in der Oberfläche änderbar und werden im JSON gespeichert.

## 5. Vertretung und Ausfall

Fällt eine Lehrkraft oder ein Raum aus, berechnet das Programm für jede betroffene Stunde die günstigste Lösung nach der Eskalationskette. Es probiert die Stufen in dieser Reihenfolge und nimmt die erste, die alle harten Regeln einhält. Innerhalb einer Stufe gilt der Kostenvektor aus Abschnitt 3.

1. **Zweitbesetzung rückt auf.** Ist für die Stunde eine Zweitbesetzung eingeplant, übernimmt sie die Hauptrolle. Klasse, Raum und Zeit bleiben gleich.
2. **Umplanen im Regelplan.** Die Stunde wird auf einen freien Slot derselben Woche verschoben, ohne andere Stunden zu verschlechtern und ohne Leerstunde für die Klasse (H12). Folgende Stunden der Klasse dürfen nachrücken.
3. **Vertretung durch Klassenlehrkraft oder Fachlehrkraft der Klasse.** Wer die Klasse bereits unterrichtet und im Slot frei ist, hat Vorrang (Ziel 2).
4. **Vertretung durch qualifizierte Lehrkraft.** Fachlich passend, Kontingent nicht überschritten. Reihenfolge: Springerpool, dann freie Lehrkräfte, dann Lehrkräfte, die im Slot nur als Zweitbesetzung eingeplant sind (die Zweitbesetzung entfällt dort).
5. **Doppelbetreuung.** Eine Lehrkraft betreut zwei Klassen gleichzeitig, siehe unten. Nur, wenn keine freie Lehrkraft und keine abziehbare Zweitbesetzung existiert.
6. **Aufteilung der Klasse.** Die Schüler:innen werden auf andere Klassen verteilt, siehe unten.
7. **Entfall.** Die Stunde entfällt nur, wenn danach keine Leerstunde entsteht, also in der ersten oder letzten Stunde des Tages der Klasse (späterer Beginn oder früherer Schluss). Liegt die Stunde in der Tagesmitte, rutschen folgende Stunden der Klasse nach vorn oder die Klasse erhält eine Aufsicht (Status `aufsicht`) durch eine beliebige freie Lehrkraft. Jeder Entfall und jede Aufsicht erscheint im Ausfallbericht mit Grund.

### Zweitbesetzung (zwei Lehrkräfte, eine Klasse)

Bei Personalüberhang betreuen zwei Lehrkräfte eine Klasse gleichzeitig. Das Programm vergibt Zweitbesetzungen erst, nachdem alle Klassen vollständig versorgt sind. Ausfall (Ziel 1) hat immer Vorrang.

- **Zweck:** Team-Teaching, Förderung, Inklusion oder Absicherung bei Ausfall. Der Zweck ist je Zuordnung als Freitext vermerkbar und beeinflusst die Planung nicht.
- **Kontingent:** Zweitbesetzungsstunden zählen gegen Soll- und Höchststunden. Die Vertretungsreserve (Standard 10 % der Sollstunden je Lehrkraft) bleibt frei.
- **Vergabe:** Vorrang haben Klassen mit hoher Schülerzahl, niedriger Stufe und Fächer mit wenigen qualifizierten Lehrkräften (W9). Eine Klasse behält ihre Zweitlehrkraft möglichst über die ganze Woche (W10).
- **Aufrücken:** Fällt die Hauptlehrkraft aus, übernimmt die Zweitbesetzung die Stunde. Plan und Raum bleiben unverändert (Stufe 1 der Kette).
- **Abziehen:** Wird eine Lehrkraft für eine Vertretung in einer anderen Klasse gebraucht, wird ihre Zweitbesetzung zuerst abgezogen. Die Klasse behält ihre Hauptlehrkraft (Stufe 4 der Kette).
- **Grenze:** Höchstens zwei Lehrkräfte je Klasse und Zeitslot (H10).

### Doppelbetreuung

Eine Lehrkraft betreut zwei Klassen im selben Slot, typischerweise zwei Parallelklassen derselben Stufe, deren Fächer sich zu einer Betreuung eignen (Stillarbeit, Förderung). Voraussetzungen:

- Beide Klassen sind im Slot ohne Lehrkraft oder die betreuende Lehrkraft hat in einer der Klassen ohnehin Unterricht (Kern-Klasse). Die zweite Klasse kommt dazu.
- Summe der Schülerzahlen ≤ Kapazität des Raums, oder beide Klassen bleiben in ihren Räumen und liegen auf demselben Flur (Feld `nahe` in den Raumdaten).
- Pro Lehrkraft höchstens eine Doppelbetreuung pro Tag und höchstens zwei zusammenhängende Stunden (einstellbar).
- Die betreuende Lehrkraft ist für mindestens eine der beiden Klassen Fach- oder Klassenlehrkraft, sonst gilt sie als Notfalleinsatz.

### Aufteilung einer Klasse

Letzte Stufe vor dem Entfall. Die Schüler:innen einer Klasse werden auf andere Klassen verteilt, die im Slot Unterricht haben.

- Zielklassen: bevorzugt dieselbe Stufe, dann benachbarte Stufe. Das Programm schlägt eine Verteilung vor, die Zielräume nicht über Kapazität füllt (H6).
- Die Verteilung wird je Schüler:innen-Gruppe angegeben (`Gruppe A → Klasse 3b: 6 Schüler:innen`). Einzelne Schüler:innen verwaltet das Programm nicht. Gruppen legt die Nutzerin fest, oder das Programm teilt die Klasse gleichmäßig.
- Dieselbe Klasse darf nicht in zwei aufeinanderfolgenden Stunden aufgeteilt werden, wenn eine Alternative existiert.
- Der Plan der Zielklassen erhält einen Hinweis `+ n Gäste`, die Gesamtzahl wird gegen die Raumkapazität geprüft.

### Aufsichtsvertretung

Fällt eine Lehrkraft an einem Datum aus, werden auch ihre Pausenaufsichten dieses Tages vertreten. Reihenfolge:

1. Anwesende Lehrkraft mit Unterricht direkt vor oder nach der Pause, die in dieser Pause keine Aufsicht hat (W12).
2. Andere an diesem Tag anwesende Lehrkraft, bevorzugt mit der geringsten Zahl an Aufsichten in dieser Woche (einschließlich Mehraufsichten).
3. Bleibt die Aufsicht unbesetzt, erscheint sie als Warnung im Ausfallbericht (Ziel 1A).

Fällt eine Lehrkraft aus, die eine Unterrichtsvertretung übernehmen soll, und hat sie zugleich eine Aufsicht, gilt H13 unverändert; Unterricht und Aufsicht schließen sich nicht aus, da sie in verschiedenen Zeitfenstern liegen.

Das Ergebnis jeder Stufe wird als Vorschlag angezeigt. Die Nutzerin bestätigt, ändert oder verwirft ihn. Nichts wird ohne Bestätigung in den Plan übernommen.

## 6. Planungsalgorithmus

Es handelt sich um ein Constraint-Problem mit lexikografischer Optimierung. Vorgesehen ist ein zweistufiges Verfahren, das ohne Bibliothek im Browser läuft und für typische Schulgrößen (bis ca. 40 Klassen, 80 Lehrkräfte, 50 Räume) in unter 30 Sekunden ein Ergebnis liefert.

1. **Bedarfsermittlung.** Aus Stundentafeln und Festzuordnungen entsteht eine Liste von Unterrichtseinheiten (Klasse, Fach, Hauptlehrkraft, Dauer 1 oder 2). Doppelstunden werden als eine Einheit mit Dauer 2 geführt.
2. **Vorprüfung.** Das Programm prüft, ob der Bedarf gedeckt werden kann: Summe der Stundenbedarfe je Fach gegen Summe der Kontingente qualifizierter Lehrkräfte. Eine Unterdeckung wird als Warnung ausgegeben (erwarteter Ausfall je Fach). Bei Überdeckung meldet es die freie Kapazität je Lehrkraft (Sollstunden minus Hauptbedarf minus Vertretungsreserve).
3. **Lehrkräfte-Zuweisung.** Wo keine Festzuordnung existiert oder das Kontingent nicht reicht, löst das Programm die Zuordnung als Flussproblem (Bedarf → Lehrkraft) mit Kosten nach Ziel 2 und 3. So wird zuerst der Ausfall minimiert, dann die Treue zur eigenen Klasse. Lehrkräfte ohne Hauptzuweisung oder mit freiem Kontingent bilden den Springerpool.
4. **Konstruktion.** Einheiten werden nach Schwierigkeit sortiert (wenige freie Slots, Doppelstunden, Fachräume zuerst) und per Backtracking mit Forward-Checking in Slots und Räume gesetzt. Je Klasse und Tag wird ein zusammenhängender Block gebildet, damit H12 schon bei der Platzierung erfüllt ist. Schlägt eine Platzierung fehl, wird die Einheit zurückgestellt.
5. **Zweitbesetzung.** Erst wenn alle Klassen versorgt sind, vergibt das Programm freie Lehrkraft-Slots als Zweitbesetzung. Das ist ein Zuordnungsproblem (freier Slot einer Lehrkraft → Klasse im selben Slot) mit Prioritäten aus W9 und W10. H1, H4, H7, H10 und die Vertretungsreserve bleiben gewahrt. Der Schritt entfällt, wenn `zweitbesetzungErlaubt` aus ist.
5a. **Pausenaufsichten.** Nach der Unterrichtsplanung verteilt das Programm die Aufsichten als Zuordnungsproblem (Bedarf je Pause und Tag → anwesende Lehrkraft) mit Kapazität = Aufsichtssoll. Kosten: unbesetzte Aufsicht (Ziel 1A) vor W11 und W12. Eine Unterdeckung (Summe der Aufsichtssolls kleiner als der Wochenbedarf) meldet bereits die Vorprüfung.
6. **Nachoptimierung.** Lokale Suche (Verschieben, Tauschen zweier Einheiten, Tausch von Lehrkräften, Umsetzen einer Zweitbesetzung; Züge, die eine Leerstunde für eine Klasse erzeugen, sind unzulässig) mit Simulated Annealing, bewertet über den Kostenvektor. Zeitbudget und Zufallsstartwert sind einstellbar, die Ausführung ist mit gleichem Startwert reproduzierbar.
7. **Ausfallbehandlung.** Zurückgestellte Einheiten durchlaufen die Eskalationskette aus Abschnitt 5.

Die Berechnung läuft in einem Web Worker, damit die Oberfläche bedienbar bleibt. Ein Fortschrittsbalken zeigt aktuelle Kosten und verbleibende Zeit, ein Abbruchknopf übernimmt die beste bisherige Lösung. Der Worker wird aus einem Blob erzeugt, damit weiterhin nur eine HTML-Datei nötig ist.

## 7. Oberfläche

Eine Seite mit Reitern. Alle Eingaben werden sofort validiert (Pflichtfelder, doppelte Kürzel, Zahlenbereiche).

| Reiter | Inhalt |
| --- | --- |
| Stammdaten | Tabellen für Lehrkräfte (mit Aufsichtssoll), Fächer, Räume, Klassen, Zeitraster mit Pausen und Aufsichtsbedarf mit Zeilen hinzufügen, bearbeiten, löschen. Löschen blockiert, solange die Entität referenziert wird (mit Liste der Verweise). |
| Zuordnung | Matrix Klasse × Fach mit Auswahl von Haupt- und Zweitlehrkraft; Anzeige von Soll-/Ist-Stunden je Lehrkraft und Warnung bei Überschreitung. |
| Planung | Knopf „Plan erstellen“ mit Optionen (Zeitbudget, Startwert, Gewichte, Zweitbesetzung ein/aus, Vertretungsreserve), Anzeige des Kostenvektors und des Fortschritts. |
| Plan | Wochenraster mit Umschalter Klasse, Lehrkraft, Raum oder Aufsicht. Pausen erscheinen als schmale Zeilen zwischen den Stunden mit den eingeteilten Aufsichten. Drag-and-drop verschiebt Stunden und Aufsichten; Konflikte werden rot markiert und mit Regelnummer erklärt. |
| Ausfall | Abwesenheit erfassen (Lehrkraft oder Raum, Zeitraum), Vertretungsvorschläge je Datum und Stunde bzw. Pause prüfen, bestätigen, ändern oder verwerfen. Ansicht je Tag (Tagesvertretungsplan). |
| Bericht | Ausfallstunden je Klasse und Fach, Vertretungsquote, Auslastung je Lehrkraft (mit Zweitbesetzungsstunden und ungenutztem Kontingent), Aufsichten je Lehrkraft (Soll, Ist, Mehraufsichten), unbesetzte Aufsichten, Verstöße gegen weiche Regeln. |
| Daten | JSON exportieren, JSON importieren, Daten zurücksetzen. |

**Darstellung der Betreuungsformen:** Doppelbetreuung zeigt in beiden Klassen den Namen der Lehrkraft mit Symbol „⇄“. Aufgeteilte Klassen sind grau mit dem Hinweis „aufgeteilt“, bei den Zielklassen erscheint „+ n Gäste“.

**Darstellung der Zweitbesetzung:** In der Klassenansicht stehen beide Namen, die Zweitbesetzung mit vorangestelltem „+“. In der Lehrkraftansicht erscheint die Stunde mit dem Zusatz „(2.)“. Lehrkräfte mit ungenutztem Kontingent werden in einer Liste neben dem Plan angezeigt und lassen sich per Drag-and-drop einer Klasse als Zweitbesetzung zuweisen.

**Bedienung:** Rückgängig und Wiederholen (mindestens 50 Schritte), Tastaturbedienung für alle Tabellen, Druckansicht je Klasse und Lehrkraft (CSS `@media print`), Beschriftungen auf Deutsch, Seite nutzbar ab 1280 px Breite.

## 8. Persistenz (JSON)

Das Programm speichert nichts selbst. Der gesamte Zustand liegt in einer JSON-Datei, die die Nutzerin exportiert und später wieder importiert. Der Export erfolgt als Download (`Blob` + `<a download>`), der Import über Dateiauswahl oder Drag-and-drop (`FileReader`). Dateiname: `stundenplan-JJJJ-MM-TT.json`.

Das folgende Beispiel ist gekürzt (nur zwei Stunden im Zeitraster, nicht alle referenzierten Klassen und Räume) und zeigt die Struktur; für sich allein importiert, meldet die Prüfung die fehlenden Referenzen.

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-11-25T16:59:00+01:00",
  "schule": { "name": "Beispielschule", "schuljahr": "2026/27" },
  "zeitraster": {
    "tage": ["Mo", "Di", "Mi", "Do", "Fr"],
    "stunden": [
      { "nr": 1, "von": "08:00", "bis": "08:45" },
      { "nr": 2, "von": "08:50", "bis": "09:35" }
    ],
    "doppelstundenStart": [1, 3, 5],
    "pausen": [
      { "vorStunde": 1, "name": "Frühaufsicht", "aufsichten": 2 },
      { "vorStunde": 3, "name": "1. große Pause", "aufsichten": 4 },
      { "vorStunde": 5, "name": "2. große Pause", "aufsichten": 3 }
    ]
  },
  "faecher": [
    { "id": "f-ma", "name": "Mathematik", "kuerzel": "MA", "raumtyp": null, "blockbar": true }
  ],
  "lehrkraefte": [
    {
      "id": "l-mue", "name": "Anna Müller", "kuerzel": "MÜ",
      "qualifikationen": [ { "fach": "f-ma", "stufenVon": 1, "stufenBis": 4 } ],
      "sollStunden": 24, "minStunden": 20, "maxStunden": 26, "aufsichtenProWoche": 3,
      "gesperrt": [ { "tag": "Fr", "stunden": [5, 6] } ],
      "abwesenheiten": [ { "von": "2026-11-16", "bis": "2026-11-20", "grund": "" } ]
    },
    {
      "id": "l-bau", "name": "Ben Bauer", "kuerzel": "BA",
      "qualifikationen": [ { "fach": "f-ma", "stufenVon": 1, "stufenBis": 4 } ],
      "sollStunden": 20, "minStunden": 16, "maxStunden": 24, "aufsichtenProWoche": 2,
      "gesperrt": [],
      "abwesenheiten": []
    }
  ],
  "raeume": [
    { "id": "r-101", "name": "101", "typ": "klassenraum", "kapazitaet": 28, "nahe": ["r-102"], "gesperrt": [] },
    { "id": "r-nawi1", "name": "NaWi 1", "typ": "fachraum", "fachraumtyp": "nawi", "kapazitaet": 32, "nahe": [], "gesperrt": [] },
    { "id": "r-bad", "name": "Hallenbad", "typ": "schwimmhalle", "kapazitaet": 35, "nahe": [], "gesperrt": [ { "tag": "Mi", "stunden": [1, 2] } ] }
  ],
  "klassen": [
    {
      "id": "k-2a", "name": "2a", "stufe": 2, "schueler": 24,
      "klassenlehrkraft": "l-mue", "heimatraum": "r-101",
      "stundentafel": [ { "fach": "f-ma", "stunden": 5, "doppelt": false, "tagesende": false } ]
    }
  ],
  "zuordnungen": [
    { "klasse": "k-2a", "fach": "f-ma", "lehrkraft": "l-mue", "rolle": "haupt" },
    { "klasse": "k-2a", "fach": "f-ma", "lehrkraft": "l-bau", "rolle": "zweit", "zweck": "Förderung" }
  ],
  "einstellungen": {
    "gewichte": { "W1": 10, "W2": 5, "W3": 8, "W4": 3, "W5": 4, "W6": 2, "W7": 2, "W8": 6, "W9": 4, "W10": 3, "W11": 5, "W12": 3, "W13": 4 },
    "maxDoppelbetreuungProTag": 1,
    "zweitbesetzungErlaubt": true,
    "maxLehrkraefteProKlasseUndSlot": 2,
    "vertretungsreserveProzent": 10,
    "zeitbudgetSekunden": 30,
    "zufallsStartwert": 42
  },
  "plan": {
    "regelplan": [
      { "klasse": "k-2a", "fach": "f-ma", "lehrkraefte": ["l-mue", "l-bau"], "raum": "r-101",
        "tag": "Mo", "stunde": 1, "status": "regulaer" }
    ],
    "aufsichten": [
      { "tag": "Mo", "vorStunde": 1, "lehrkraft": "l-mue" },
      { "tag": "Mo", "vorStunde": 3, "lehrkraft": "l-bau" }
    ],
    "vertretungen": [
      { "datum": "2026-11-16", "klasse": "k-2a", "stunde": 1, "status": "vertreten",
        "lehrkraefte": ["l-bau"], "raum": "r-101", "grund": "zweitbesetzungRueckt" },
      { "datum": "2026-11-17", "klasse": "k-2a", "stunde": 2, "status": "doppeltBetreut",
        "lehrkraefte": ["l-bau"], "raum": "r-101", "mitKlasse": "k-2b" },
      { "datum": "2026-11-17", "klasse": "k-3a", "stunde": 3, "status": "aufgeteilt",
        "verteilung": [ { "zielKlasse": "k-3b", "anzahl": 6 }, { "zielKlasse": "k-3c", "anzahl": 6 } ] }
    ],
    "aufsichtsVertretungen": [
      { "datum": "2026-11-16", "vorStunde": 1, "fuer": "l-mue", "lehrkraft": "l-bau", "status": "vertreten" }
    ]
  }
}
```

**Regeln für Import und Export:**

- Statuswerte im JSON: `regulaer`, `vertreten`, `doppeltBetreut`, `aufgeteilt`, `entfaellt`. Ohne Umlaute, damit die Datei werkzeugfreundlich bleibt. Zusätzlich gilt `aufsicht` (Betreuung ohne Fachunterricht).
- Beim Import prüft das Programm `schemaVersion`, Pflichtfelder, Typen sowie alle Referenzen (`fach`, `lehrkraft`, `raum`, `klasse` müssen existieren) und Eindeutigkeit der `id`. Fehler erscheinen als Liste mit Pfad (`lehrkraefte[3].qualifikationen[0].fach`). Bei einem Fehler wird nichts übernommen.
- Vor dem Überschreiben vorhandener Daten fragt das Programm nach und bietet einen Export des aktuellen Stands an.
- Ältere `schemaVersion` werden durch Migrationsfunktionen in der Datei hochgezogen. Neuere Versionen lehnt das Programm mit Hinweis ab.
- Unbekannte Zusatzfelder bleiben beim Import erhalten und werden beim Export wieder geschrieben.
- Die Oberfläche zeigt an, wann zuletzt exportiert wurde und ob es ungespeicherte Änderungen gibt (Warnung beim Schließen des Tabs über `beforeunload`).
- Als Zusatz ist ein Export einzelner Teile möglich: nur Stammdaten, nur Plan. Beim Import eines Teils werden nur diese Bereiche ersetzt.
- Pausen werden über `vorStunde` identifiziert (eindeutig, muss eine Stunde des Rasters sein). `aufsichten` und `aufsichtenProWoche` sind ganze Zahlen ≥ 0. Aufsichtsvertretungen haben den Status `vertreten` oder `unbesetzt`.
- Vertretungen und Aufsichtsvertretungen tragen ein `datum` (ISO, `JJJJ-MM-TT`), das auf einen Tag des Zeitrasters fallen muss.
- Zuordnungen tragen eine `rolle` (`haupt` oder `zweit`). In jeder Stunde ist `lehrkraefte` eine Liste mit einem oder zwei Einträgen; der erste ist die Hauptlehrkraft, ein zweiter die Zweitbesetzung. Der Import prüft, dass je Klasse und Fach höchstens eine Hauptlehrkraft eingetragen ist, dass nie mehr als `maxLehrkraefteProKlasseUndSlot` Lehrkräfte in einer Stunde stehen und dass eine Lehrkraft nicht zugleich Haupt- und Zweitlehrkraft derselben Stunde ist.

## 9. Nichtfunktionale Anforderungen und Abnahme

- **Datenschutz:** Keine Übertragung ins Netz, keine Cookies, kein `localStorage` als Pflichtspeicher. Es gibt keine externen Skripte, Schriften oder Analysedienste. Personenbezogene Daten verlassen den Rechner nur über den Export.
- **Browser:** Aktuelle Versionen von Firefox, Chrome, Edge und Safari.
- **Leistung:** Erstplan für 30 Klassen und 60 Lehrkräfte in höchstens 30 Sekunden. Oberfläche bleibt währenddessen bedienbar. Plan-Ansicht reagiert unter 100 ms.
- **Nachvollziehbarkeit:** Jede Entscheidung des Programms lässt sich erklären (welche Regel, welche Stufe der Eskalationskette, welcher Kostenanteil).
- **Barrierefreiheit:** Kontrast nach WCAG AA, Fokusanzeige, Farbe nie alleiniger Informationsträger (Konflikte zusätzlich mit Symbol).
- **Wartbarkeit:** Eine Datei, gegliedert in Module (Datenmodell, Validierung, Planer, Vertretung, Ansicht, Import/Export), mit Kommentaren auf Deutsch.

**Abnahmekriterien:**

1. Ein Export, der wieder importiert wird, ergibt einen identischen Zustand (Vergleich der JSON-Inhalte ohne `exportedAt`).
2. Der erzeugte Regelplan verletzt keine harte Regel H1–H9 (automatische Prüfung im Programm).
3. Testdatensatz mit gezielter Unterdeckung (zu wenige qualifizierte Lehrkräfte): Das Programm minimiert den Ausfall nachweislich, d. h. kein anderer geprüfter Plan hat weniger Ausfallstunden.
4. Bei gleichem Ausfall wählt das Programm die Lösung mit den meisten Stunden durch die eigene Lehrkraft der Klasse.
5. Fällt eine Lehrkraft aus, entstehen Vorschläge in der Reihenfolge der Eskalationskette. Doppelbetreuung und Aufteilung erscheinen nur, wenn keine frühere Stufe möglich ist.
6. Eine aufgeteilte Klasse überschreitet in keiner Zielklasse die Raumkapazität.
7. Fehlerhafte JSON-Dateien (falsche Referenz, fehlendes Pflichtfeld, unbekannte Version) werden mit Pfadangabe abgewiesen, ohne den aktuellen Zustand zu verändern.
8. Testdatensatz mit mehr Lehrkräften als Klassen: Alle Klassen sind vollständig versorgt, keine Lehrkraft überschreitet ihre Höchstgrenze, jede Lehrkraft behält ihre Vertretungsreserve, und freie Kontingente werden als Zweitbesetzung vergeben (nie mehr als zwei Lehrkräfte je Klasse und Slot).
9. Fällt eine Hauptlehrkraft mit eingeplanter Zweitbesetzung aus, rückt diese auf. Plan und Raum der Klasse bleiben unverändert, und es entsteht kein Ausfall.
10. Wird eine Lehrkraft als Vertretung gebraucht, die in einer anderen Klasse nur Zweitbesetzung ist, verliert diese Klasse nur die Zweitbesetzung, nicht ihre Hauptlehrkraft.
11. In keinem Plan, auch nicht im Vertretungsplan, hat eine Klasse eine Leerstunde zwischen ihrer ersten und letzten Stunde eines Tages (H12). Der Test fällt eine Lehrkraft in der Tagesmitte aus und prüft, dass die Klasse nachrückt oder eine Aufsicht erhält.
12. Im Regelplan ist jede Pause an jedem Tag mit der erforderlichen Zahl an Aufsichten besetzt, sofern die Summe der Aufsichtssolls ausreicht. Keine Lehrkraft überschreitet ihr Aufsichtssoll, keine führt Aufsicht an einem Tag ohne eigenen Unterricht oder in einem gesperrten Zeitfenster (H13, H14).
13. Fällt eine Lehrkraft an einem Datum aus, werden ihre Aufsichten dieses Tages datumsgenau vertreten; andere Tage und der Regelplan bleiben unverändert.

## 10. Offene Fragen

- [ ] Schulform und Bundesland: Gelten feste Pflichtstunden, Aufsichtsregeln oder Obergrenzen für Doppelbetreuung und Klassenzusammenlegung?
- [ ] Wie groß darf eine Klasse bei Doppelbetreuung oder Aufnahme von Gästen höchstens werden (Zahl oder Raumkapazität)?
- [x] Sollen Teams oder Jahrgangsstufen-Bänder (Parallelunterricht, Wahlpflicht, Religion/Ethik) abgebildet werden? Das erfordert gruppenübergreifende Kurse im Datenmodell. - keine Klassenübergreifende Kurse
- [x] Brauchen Sie Wochen-A/B-Pläne oder nur einen festen Wochenplan? - fester Wochenplan
- [x] Sollen Vertretungen datumsgenau für einzelne Wochen geplant werden (wie im Schema vorgesehen) oder nur als Alternativplan? - datumsgenau
- [x] Wie werden Pausen festgelegt? - Pausen vor der 1. Stunde und danach vor jeder zweiten Stunde, je Pause eine konfigurierbare Anzahl an Aufsichten; das Aufsichtssoll je Lehrkraft wird individuell festgelegt.
- [x] Zählen Pausenaufsichten gegen das Stundenkontingent (z. B. als Bruchteil einer Stunde)? - nein, eigenes Aufsichtssoll
- [x] Gibt es Aufsichtsbereiche (Hof, Flur, Bushaltestelle), denen Aufsichten fest zugeordnet werden? - nein, je Pause zählt nur die Anzahl
- [ ] Ist ein Export als PDF oder CSV für Aushang und Weitergabe nötig (zusätzlich zum JSON)?
- [ ] Welche Klassen oder Fächer sollen bevorzugt eine Zweitbesetzung bekommen (z. B. Klassen 1–2, Inklusion, Sprachförderung)? Und reicht eine Vertretungsreserve von 10 % der Sollstunden?
