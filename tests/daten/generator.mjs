#!/usr/bin/env node
/* ==========================================================================
 * Testdatengenerator
 * Erzeugt deterministisch (fester Startwert) die Testdatensätze für alle
 * Meilensteine. Personen und Schule sind frei erfunden.
 *
 *   node tests/daten/generator.mjs            schreibt tests/daten/*.json
 *   node tests/daten/generator.mjs --pruefen  prüft, ob die Dateien aktuell sind
 *
 * Datensätze:
 *   klein        4 Klassen (Grundschule, Stufe 1–2), knapp ausreichendes Personal
 *   unterdeckung 4 Klassen (Stufe 3–4), zu wenige Mathe-Lehrkräfte, knappes Aufsichtssoll
 *   ueberhang    4 Klassen, deutlich mehr Lehrkräfte als nötig, feste Zweitbesetzungen
 *   gross        30 Klassen (Sek I, Stufe 5–10, fünfzügig), 60 Lehrkräfte, Fachräume,
 *                Turnhallen und Schwimmhalle – Leistungstest
 * ========================================================================== */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ladeKern } from '../hilfe/lade-kern.mjs';

const { Hilfen, Modell, Schema } = ladeKern();
const ORDNER = dirname(fileURLToPath(import.meta.url));

/* ------------------------------ Fächer ---------------------------------- */

/** Fachkatalog. `raumtyp` verweist auf Turnhalle oder einen Fachraumtyp. */
const FAECHER = {
  DE: { name: 'Deutsch', raumtyp: null, blockbar: true, hauptfach: true },
  MA: { name: 'Mathematik', raumtyp: null, blockbar: true, hauptfach: true },
  EN: { name: 'Englisch', raumtyp: null, blockbar: true, hauptfach: true },
  SU: { name: 'Sachunterricht', raumtyp: null, blockbar: true },
  BI: { name: 'Biologie', raumtyp: null, blockbar: true },
  PH: { name: 'Physik', raumtyp: 'nawi', blockbar: true },
  CH: { name: 'Chemie', raumtyp: 'nawi', blockbar: true },
  GE: { name: 'Geschichte', raumtyp: null, blockbar: true },
  EK: { name: 'Erdkunde', raumtyp: null, blockbar: true },
  SP: { name: 'Sport', raumtyp: 'turnhalle', blockbar: true },
  MU: { name: 'Musik', raumtyp: 'musik', blockbar: false },
  KU: { name: 'Kunst', raumtyp: 'kunst', blockbar: true },
  RE: { name: 'Religion/Ethik', raumtyp: null, blockbar: false },
  IF: { name: 'Informatik', raumtyp: 'informatik', blockbar: true },
  SW: { name: 'Schwimmen', raumtyp: 'schwimmhalle', blockbar: true },
};

/** Stundentafeln je Stufe: [Kürzel, Wochenstunden, Doppelstunde gewünscht]. */
const STUNDENTAFELN = {
  1: [['DE', 6, false], ['MA', 5, false], ['SU', 3, false], ['SP', 3, false], ['MU', 1, false], ['KU', 2, true], ['RE', 2, false]],
  2: [['DE', 6, false], ['MA', 5, false], ['SU', 3, false], ['SP', 3, false], ['MU', 2, false], ['KU', 2, true], ['RE', 2, false]],
  3: [['DE', 6, false], ['MA', 5, false], ['SU', 4, false], ['EN', 2, false], ['SP', 3, false], ['MU', 2, false], ['KU', 2, true], ['RE', 2, false]],
  4: [['DE', 6, false], ['MA', 5, false], ['SU', 4, false], ['EN', 2, false], ['SP', 3, false], ['MU', 2, false], ['KU', 2, true], ['RE', 2, false]],
  5: [['DE', 5, false], ['MA', 4, false], ['EN', 5, false], ['BI', 2, false], ['GE', 1, false], ['EK', 2, false], ['SP', 3, true], ['MU', 2, false], ['KU', 2, true], ['RE', 2, false], ['IF', 1, false], ['SW', 2, true]],
  6: [['DE', 5, false], ['MA', 4, false], ['EN', 4, false], ['BI', 2, false], ['GE', 2, false], ['EK', 1, false], ['SP', 3, true], ['MU', 2, false], ['KU', 2, true], ['RE', 2, false], ['IF', 1, false]],
  7: [['DE', 4, false], ['MA', 4, false], ['EN', 4, false], ['BI', 2, false], ['PH', 2, true], ['CH', 2, true], ['GE', 2, false], ['EK', 2, false], ['SP', 3, true], ['MU', 1, false], ['KU', 2, true], ['RE', 2, false]],
  8: [['DE', 4, false], ['MA', 4, false], ['EN', 3, false], ['BI', 2, false], ['PH', 2, true], ['CH', 2, true], ['GE', 2, false], ['EK', 2, false], ['SP', 3, true], ['MU', 2, false], ['KU', 1, false], ['RE', 2, false], ['IF', 1, false]],
  9: [['DE', 4, false], ['MA', 4, false], ['EN', 3, false], ['BI', 2, false], ['PH', 2, true], ['CH', 2, true], ['GE', 2, false], ['EK', 2, false], ['SP', 2, true], ['MU', 1, false], ['KU', 2, true], ['RE', 2, false], ['IF', 2, true]],
  10: [['DE', 4, false], ['MA', 4, false], ['EN', 3, false], ['BI', 2, false], ['PH', 2, true], ['CH', 2, true], ['GE', 2, false], ['EK', 1, false], ['SP', 2, true], ['MU', 1, false], ['KU', 2, true], ['RE', 2, false], ['IF', 2, true]],
};

/* ------------------------------ Namen ----------------------------------- */

const VORNAMEN = ['Anna', 'Ben', 'Clara', 'David', 'Elif', 'Finn', 'Greta', 'Hannes', 'Ida', 'Jonas', 'Katrin', 'Lukas',
  'Mara', 'Nils', 'Olga', 'Paul', 'Rosa', 'Sami', 'Tara', 'Ugur', 'Vera', 'Wim', 'Yara', 'Zoe', 'Malte', 'Lea', 'Emil', 'Nora'];
const NACHNAMEN = ['Abel', 'Brandt', 'Conrad', 'Dietz', 'Engel', 'Fink', 'Graf', 'Hahn', 'Imhof', 'Jäger', 'Kluge', 'Lorenz',
  'Mertens', 'Noll', 'Ortmann', 'Pohl', 'Quast', 'Roth', 'Sauer', 'Thiel', 'Ulrich', 'Voigt', 'Wolff', 'Zeller', 'Bühler',
  'Kranz', 'Lindner', 'Marx', 'Nagel', 'Otten', 'Pieper', 'Rehm', 'Seidel', 'Teuber', 'Vogt', 'Weber', 'Yilmaz', 'Ziegler',
  'Arnold', 'Busch', 'Christ', 'Dorn', 'Eckert', 'Frey', 'Gärtner', 'Heinz', 'Iske', 'Jahn', 'Kern', 'Loos', 'Mohr', 'Nowak',
  'Oswald', 'Petri', 'Raabe', 'Stein', 'Tews', 'Uhl', 'Vollmer', 'Wendt', 'Zahn', 'Albers', 'Bauer', 'Cramer'];

/* ------------------------------ Generator ------------------------------- */

/**
 * @param {object} o
 * @param {string} o.name           Schulname
 * @param {number} o.startwert      Zufallsstartwert
 * @param {number[]} o.stufen       Jahrgangsstufen
 * @param {number} o.zuege          Parallelklassen je Stufe
 * @param {number} o.lehrkraefte    Anzahl Lehrkräfte
 * @param {number} o.stundenProTag  Stunden je Tag
 * @param {number[]} o.pausenAufsichten erforderliche Aufsichten je Pause
 * @param {number[]} o.sollWerte    mögliche Sollstunden (zufällig gewählt)
 * @param {number} [o.aufsichtsFaktor=1.1] Σ Aufsichtssoll / Wochenbedarf
 * @param {{fach:string, sollStunden:number}} [o.mangel] nur eine qualifizierte Lehrkraft mit kleinem Soll
 * @param {number} [o.zweitbesetzungen=0] Anzahl fester Zweit-Zuordnungen
 * @param {boolean} [o.mitAbwesenheit=false] eine Lehrkraft mit Abwesenheit (für Vertretungstests)
 */
export function erzeugeDatensatz(o) {
  const z = Hilfen.erzeugeZufall(o.startwert);
  const zustand = Modell.leererZustand();
  zustand.exportedAt = '2026-11-25T00:00:00+01:00'; // fest, damit Dateien reproduzierbar sind
  zustand.schule = { name: o.name, schuljahr: '2026/27' };
  zustand.zeitraster = Modell.standardZeitraster(o.stundenProTag);
  zustand.zeitraster.pausen = Modell.standardPausen(o.stundenProTag, o.pausenAufsichten);
  zustand.einstellungen.zufallsStartwert = o.startwert;
  const reserveProzent = zustand.einstellungen.vertretungsreserveProzent;

  // --- Fächer: nur die, die in den Stundentafeln der gewählten Stufen vorkommen
  const genutzt = new Set(o.stufen.flatMap((s) => STUNDENTAFELN[s].map(([k]) => k)));
  const fachId = (k) => 'f-' + k.toLowerCase();
  zustand.faecher = [...genutzt].map((k) => {
    const f = FAECHER[k];
    const fach = { id: fachId(k), name: f.name, kuerzel: k, raumtyp: f.raumtyp, blockbar: f.blockbar };
    if (f.hauptfach) fach.hauptfach = true;
    return fach;
  });

  // --- Klassen und Klassenräume
  const raeume = [];
  const klassen = [];
  for (const stufe of o.stufen) {
    const raumIds = [];
    for (let zug = 0; zug < o.zuege; zug++) {
      const name = `${stufe}${'abcdefgh'[zug]}`;
      const kapazitaet = z.ganzzahl(28, 32);
      const raum = { id: `r-${100 * stufe + zug + 1}`, name: String(100 * stufe + zug + 1), typ: 'klassenraum', kapazitaet, nahe: [], gesperrt: [] };
      raumIds.push(raum.id);
      raeume.push(raum);
      klassen.push({
        id: 'k-' + name, name, stufe, schueler: z.ganzzahl(20, Math.min(28, kapazitaet)),
        klassenlehrkraft: null, heimatraum: raum.id,
        stundentafel: STUNDENTAFELN[stufe].map(([k, stunden, doppelt]) => ({ fach: fachId(k), stunden, doppelt })),
      });
    }
    // Parallelklassen liegen auf demselben Flur (Feld „nahe“, symmetrisch)
    for (const r of raeume.filter((x) => raumIds.includes(x.id))) r.nahe = raumIds.filter((id) => id !== r.id);
  }

  // --- Fachräume nach Bedarf (Wochenstunden je Raumtyp / nutzbare Slots, aufgerundet + 1 Puffer bei großen Schulen)
  const slotsProWoche = zustand.zeitraster.tage.length * o.stundenProTag;
  const bedarfJeTyp = {};
  for (const k of klassen) for (const e of k.stundentafel) {
    const typ = zustand.faecher.find((f) => f.id === e.fach).raumtyp;
    if (typ) bedarfJeTyp[typ] = (bedarfJeTyp[typ] || 0) + e.stunden;
  }
  const raumNamen = { turnhalle: 'Turnhalle', schwimmhalle: 'Schwimmhalle', nawi: 'NaWi', musik: 'Musik', kunst: 'Kunst', informatik: 'Informatik' };
  for (const [typ, bedarf] of Object.entries(bedarfJeTyp)) {
    const anzahl = Math.ceil(bedarf / (slotsProWoche * 0.75));
    for (let i = 1; i <= anzahl; i++) {
      const sonderraum = Modell.SONDERRAUMTYPEN.includes(typ);
      raeume.push({
        id: `r-${typ}${i}`, name: `${raumNamen[typ]} ${i}`,
        typ: sonderraum ? typ : 'fachraum',
        ...(sonderraum ? {} : { fachraumtyp: typ }),
        kapazitaet: typ === 'turnhalle' ? 60 : typ === 'schwimmhalle' ? 35 : 32, nahe: [], gesperrt: [],
      });
    }
  }
  // Eine Turnhalle ist dienstags in der letzten Stunde gesperrt (Vereinsnutzung) – für H5-Tests.
  const halle = raeume.find((r) => r.typ === 'turnhalle');
  if (halle) halle.gesperrt = [{ tag: 'Di', stunden: [o.stundenProTag] }];
  // Die Schwimmhalle ist mittwochs in den ersten beiden Stunden belegt (öffentliches Schwimmen).
  const bad = raeume.find((r) => r.typ === 'schwimmhalle');
  if (bad) bad.gesperrt = [{ tag: 'Mi', stunden: [1, 2] }];

  // --- Bedarf je Fach (Wochenstunden über alle Klassen)
  const bedarf = {};
  for (const k of klassen) for (const e of k.stundentafel) bedarf[e.fach] = (bedarf[e.fach] || 0) + e.stunden;

  // --- Lehrkräfte: Qualifikationen dort, wo der ungedeckte Bedarf am größten ist
  const stufeVon = Math.min(...o.stufen) <= 4 ? 1 : 5;
  const stufeBis = Math.min(...o.stufen) <= 4 ? 4 : 10;
  const offen = { ...bedarf };
  const lehrkraefte = [];
  const ids = new Set();
  const kuerzelVergeben = new Set();
  const namen = z.gemischt(NACHNAMEN);
  for (let i = 0; i < o.lehrkraefte; i++) {
    const nachname = namen[i % namen.length];
    const vorname = z.auswahl(VORNAMEN);
    let kuerzel = Hilfen.normalisiereStamm(nachname).slice(0, 3).toUpperCase();
    for (let n = 2; kuerzelVergeben.has(kuerzel); n++) kuerzel = kuerzel.slice(0, 2) + n;
    kuerzelVergeben.add(kuerzel);
    const id = Hilfen.neueId('l', ids, kuerzel);
    ids.add(id);
    const soll = z.auswahl(o.sollWerte);
    const nutzbar = soll - Modell.vertretungsreserve(soll, reserveProzent);
    // 2–3 Fächer: die mit größtem offenen Bedarf (bei Gleichstand zufällig)
    const sortiert = z.gemischt(Object.keys(offen)).sort((a, b) => offen[b] - offen[a]);
    const anzahlFaecher = z.ganzzahl(2, 3);
    const faecher = sortiert.slice(0, anzahlFaecher);
    faecher.forEach((f, j) => { offen[f] -= nutzbar * (j === 0 ? 0.6 : 0.4 / (anzahlFaecher - 1)); });
    lehrkraefte.push({
      id, name: `${vorname} ${nachname}`, kuerzel,
      qualifikationen: faecher.map((f) => ({ fach: f, stufenVon: stufeVon, stufenBis: stufeBis })),
      sollStunden: soll,
      minStunden: Math.max(0, soll - 4),
      maxStunden: soll + 2,
      aufsichtenProWoche: 0,
      gesperrt: [],
      abwesenheiten: [],
    });
  }

  // Gezielter Mangel: nur eine Lehrkraft für das Fach, mit kleinem Soll.
  if (o.mangel) {
    const f = fachId(o.mangel.fach);
    const mitFach = lehrkraefte.filter((l) => l.qualifikationen.some((q) => q.fach === f));
    mitFach.slice(1).forEach((l) => { l.qualifikationen = l.qualifikationen.filter((q) => q.fach !== f); });
    const einzige = mitFach[0] || lehrkraefte[0];
    if (!einzige.qualifikationen.some((q) => q.fach === f)) einzige.qualifikationen.push({ fach: f, stufenVon: stufeVon, stufenBis: stufeBis });
    einzige.sollStunden = o.mangel.sollStunden;
    einzige.minStunden = Math.max(0, o.mangel.sollStunden - 2);
    einzige.maxStunden = o.mangel.sollStunden + 2;
    // Lehrkräfte ohne Qualifikation erhalten ein Ersatzfach, damit jede Lehrkraft mindestens eines hat.
    for (const l of lehrkraefte) if (!l.qualifikationen.length) l.qualifikationen.push({ fach: fachId('DE'), stufenVon: stufeVon, stufenBis: stufeBis });
  }

  // Teilzeitkräfte (Soll < 20) sind freitags ab der 5. Stunde gesperrt.
  for (const l of lehrkraefte) {
    if (l.sollStunden < 20 && o.stundenProTag >= 5) {
      l.gesperrt = [{ tag: 'Fr', stunden: range(5, o.stundenProTag) }];
      l.teilzeitfaktor = Math.round((l.sollStunden / 28) * 100) / 100;
    }
  }
  if (o.mitAbwesenheit) lehrkraefte[0].abwesenheiten = [{ von: '2026-11-16', bis: '2026-11-18', grund: 'Fortbildung' }];

  // --- Zuordnungen: Klassenlehrkräfte, dann Hauptlehrkräfte (knappe Fächer zuerst)
  const rest = new Map(lehrkraefte.map((l) => [l.id, l.sollStunden - Modell.vertretungsreserve(l.sollStunden, reserveProzent)]));
  const qualifiziert = (l, fach, stufe) => l.qualifikationen.some((q) => q.fach === fach && q.stufenVon <= stufe && stufe <= q.stufenBis);
  const klassenlehrkraftVon = new Set();
  for (const k of klassen) {
    const kandidaten = lehrkraefte
      .filter((l) => !klassenlehrkraftVon.has(l.id) && qualifiziert(l, fachId('DE'), k.stufe))
      .concat(lehrkraefte.filter((l) => !klassenlehrkraftVon.has(l.id)));
    const wahl = kandidaten.sort((a, b) => rest.get(b.id) - rest.get(a.id))[0];
    if (wahl) { k.klassenlehrkraft = wahl.id; klassenlehrkraftVon.add(wahl.id); }
  }
  const anzahlQualifizierte = (fach, stufe) => lehrkraefte.filter((l) => qualifiziert(l, fach, stufe)).length;
  const auftraege = klassen.flatMap((k) => k.stundentafel.map((e) => ({ k, e })));
  auftraege.sort((a, b) => anzahlQualifizierte(a.e.fach, a.k.stufe) - anzahlQualifizierte(b.e.fach, b.k.stufe)
    || b.e.stunden - a.e.stunden || a.k.id.localeCompare(b.k.id));
  const zuordnungen = [];
  for (const { k, e } of auftraege) {
    const passend = lehrkraefte.filter((l) => qualifiziert(l, e.fach, k.stufe) && rest.get(l.id) >= e.stunden);
    if (!passend.length) continue; // Unterdeckung: keine Festzuordnung, der Planer muss den Ausfall minimieren
    passend.sort((a, b) =>
      (b.id === k.klassenlehrkraft) - (a.id === k.klassenlehrkraft)
      || unterrichtetKlasse(b, k) - unterrichtetKlasse(a, k)
      || rest.get(b.id) - rest.get(a.id));
    const l = passend[0];
    rest.set(l.id, rest.get(l.id) - e.stunden);
    zuordnungen.push({ klasse: k.id, fach: e.fach, lehrkraft: l.id, rolle: 'haupt' });
  }
  function unterrichtetKlasse(l, k) {
    return zuordnungen.some((x) => x.klasse === k.id && x.lehrkraft === l.id) ? 1 : 0;
  }

  // --- Feste Zweitbesetzungen: niedrigste Stufe, Hauptfächer, Lehrkräfte mit größtem Rest
  const zweckListe = ['Förderung', 'Inklusion', 'Team-Teaching', 'Sprachförderung'];
  let vergeben = 0;
  const kandidatenZweit = auftraege
    .filter(({ e }) => FAECHER[zustand.faecher.find((f) => f.id === e.fach).kuerzel].hauptfach)
    .sort((a, b) => a.k.stufe - b.k.stufe || b.k.schueler - a.k.schueler);
  for (const { k, e } of kandidatenZweit) {
    if (vergeben >= (o.zweitbesetzungen || 0)) break;
    const haupt = zuordnungen.find((x) => x.klasse === k.id && x.fach === e.fach && x.rolle === 'haupt');
    const frei = lehrkraefte
      .filter((l) => (!haupt || l.id !== haupt.lehrkraft) && rest.get(l.id) >= e.stunden)
      .sort((a, b) => rest.get(b.id) - rest.get(a.id))[0];
    if (!frei) continue;
    rest.set(frei.id, rest.get(frei.id) - e.stunden);
    zuordnungen.push({ klasse: k.id, fach: e.fach, lehrkraft: frei.id, rolle: 'zweit', zweck: zweckListe[vergeben % zweckListe.length] });
    vergeben++;
  }

  // --- Aufsichtssoll: Wochenbedarf × Faktor, verteilt nach Sollstunden (größte Reste zuerst)
  const wochenbedarf = zustand.zeitraster.tage.length * zustand.zeitraster.pausen.reduce((s, p) => s + p.aufsichten, 0);
  const ziel = Math.round(wochenbedarf * (o.aufsichtsFaktor ?? 1.1));
  const summeSoll = lehrkraefte.reduce((s, l) => s + l.sollStunden, 0);
  const anteile = lehrkraefte.map((l) => {
    const roh = (ziel * l.sollStunden) / summeSoll;
    return { l, ganz: Math.floor(roh), rest: roh - Math.floor(roh) };
  });
  let verteilt = anteile.reduce((s, a) => s + a.ganz, 0);
  anteile.sort((a, b) => b.rest - a.rest || a.l.id.localeCompare(b.l.id));
  for (const a of anteile) { if (verteilt < ziel) { a.ganz++; verteilt++; } a.l.aufsichtenProWoche = a.ganz; }

  zustand.raeume = raeume;
  zustand.klassen = klassen;
  zustand.lehrkraefte = lehrkraefte;
  zustand.zuordnungen = zuordnungen;
  return zustand;
}

function range(von, bis) {
  const r = [];
  for (let i = von; i <= bis; i++) r.push(i);
  return r;
}

/** Definition der Standard-Testdatensätze. */
export const DATENSAETZE = {
  klein: {
    name: 'Grundschule Am Weiher (Testdaten klein)', startwert: 1,
    stufen: [1, 2], zuege: 2, lehrkraefte: 5, stundenProTag: 6,
    pausenAufsichten: [1, 3, 2], sollWerte: [28, 28, 26, 20], mitAbwesenheit: true,
  },
  unterdeckung: {
    name: 'Grundschule Lindenhof (Testdaten Unterdeckung)', startwert: 2,
    stufen: [3, 4], zuege: 2, lehrkraefte: 6, stundenProTag: 6,
    pausenAufsichten: [1, 3, 2], sollWerte: [28, 26], aufsichtsFaktor: 0.8,
    mangel: { fach: 'MA', sollStunden: 12 },
  },
  ueberhang: {
    name: 'Grundschule Sonnenhang (Testdaten Überhang)', startwert: 3,
    stufen: [1, 2], zuege: 2, lehrkraefte: 10, stundenProTag: 6,
    pausenAufsichten: [2, 3, 2], sollWerte: [28, 26, 20, 14], zweitbesetzungen: 6,
  },
  gross: {
    name: 'Gesamtschule Nord (Testdaten groß)', startwert: 4,
    stufen: [5, 6, 7, 8, 9, 10], zuege: 5, lehrkraefte: 60, stundenProTag: 8,
    pausenAufsichten: [3, 6, 5, 3], sollWerte: [26, 26, 25, 25, 20, 14],
  },
};

/** Kanonischer Text einer Datensatzdatei (Standardwerte ergänzt, Schemareihenfolge). */
export function alsText(zustand) {
  return JSON.stringify(Schema.ordne(Schema.normalisiere(Hilfen.tiefeKopie(zustand))), null, 2) + '\n';
}

// Aufruf als Programm
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pruefen = process.argv.includes('--pruefen');
  let fehler = 0;
  for (const [name, optionen] of Object.entries(DATENSAETZE)) {
    const datei = join(ORDNER, `${name}.json`);
    const text = alsText(erzeugeDatensatz(optionen));
    if (pruefen) {
      const ok = existsSync(datei) && readFileSync(datei, 'utf8') === text;
      if (!ok) { console.error(`${name}.json ist nicht aktuell`); fehler++; }
    } else {
      writeFileSync(datei, text);
      console.log(`${name}.json geschrieben`);
    }
  }
  if (fehler) process.exit(1);
}
