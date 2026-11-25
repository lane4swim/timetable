/* Prüft die Testdatensätze selbst: reproduzierbar, referenziell korrekt und
 * mit den Eigenschaften, für die sie gebaut sind. Die vollständige
 * Schema-Validierung folgt in M1 und ersetzt die einfache Prüfung hier. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATENSAETZE, erzeugeDatensatz, alsText } from '../daten/generator.mjs';
import { ladeKern } from '../hilfe/lade-kern.mjs';

const { Modell } = ladeKern();
const ORDNER = join(dirname(fileURLToPath(import.meta.url)), '..', 'daten');
const lade = (name) => JSON.parse(readFileSync(join(ORDNER, `${name}.json`), 'utf8'));

/** Kennzahlen eines Datensatzes. */
function kennzahlen(d) {
  const reserve = d.einstellungen.vertretungsreserveProzent;
  const qualifiziert = (l, fach, stufe) => l.qualifikationen.some((q) => q.fach === fach && q.stufenVon <= stufe && stufe <= q.stufenBis);
  const bedarfJeFach = {};
  for (const k of d.klassen) for (const e of k.stundentafel) bedarfJeFach[e.fach] = (bedarfJeFach[e.fach] || 0) + e.stunden;
  const nutzbar = (l) => l.sollStunden - Modell.vertretungsreserve(l.sollStunden, reserve);
  const kapazitaetJeFach = {};
  for (const f of Object.keys(bedarfJeFach)) {
    kapazitaetJeFach[f] = d.lehrkraefte.filter((l) => d.klassen.some((k) => qualifiziert(l, f, k.stufe))).reduce((s, l) => s + nutzbar(l), 0);
  }
  return {
    qualifiziert, bedarfJeFach, kapazitaetJeFach, nutzbar,
    bedarf: Object.values(bedarfJeFach).reduce((a, b) => a + b, 0),
    kapazitaet: d.lehrkraefte.reduce((s, l) => s + nutzbar(l), 0),
    aufsichtsBedarf: d.zeitraster.tage.length * d.zeitraster.pausen.reduce((s, p) => s + p.aufsichten, 0),
    aufsichtsSoll: d.lehrkraefte.reduce((s, l) => s + l.aufsichtenProWoche, 0),
  };
}

for (const name of Object.keys(DATENSAETZE)) {
  test(`${name}: Datei entspricht dem Generator (reproduzierbar)`, () => {
    const text = readFileSync(join(ORDNER, `${name}.json`), 'utf8');
    assert.equal(text, alsText(erzeugeDatensatz(DATENSAETZE[name])), 'Bitte „npm run testdaten“ ausführen');
  });

  test(`${name}: IDs eindeutig, Referenzen gültig, Grenzen eingehalten`, () => {
    const d = lade(name);
    const k = kennzahlen(d);
    const ids = [d.faecher, d.lehrkraefte, d.raeume, d.klassen].flat().map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, 'IDs nicht eindeutig');
    for (const liste of [d.faecher, d.lehrkraefte, d.raeume, d.klassen]) {
      const kuerzel = liste.map((x) => x.kuerzel ?? x.name);
      assert.equal(new Set(kuerzel).size, kuerzel.length, 'Kürzel/Namen nicht eindeutig');
    }
    const fach = new Set(d.faecher.map((f) => f.id));
    const lehr = new Map(d.lehrkraefte.map((l) => [l.id, l]));
    const raum = new Map(d.raeume.map((r) => [r.id, r]));
    const klasse = new Map(d.klassen.map((x) => [x.id, x]));
    const stunden = d.zeitraster.stunden.map((s) => s.nr);
    const slotsProWoche = d.zeitraster.tage.length * stunden.length;

    for (const l of d.lehrkraefte) {
      assert.ok(l.qualifikationen.length > 0, `${l.id} ohne Qualifikation`);
      for (const q of l.qualifikationen) assert.ok(fach.has(q.fach), `${l.id}: Fach ${q.fach}`);
      assert.ok(l.minStunden <= l.sollStunden && l.sollStunden <= l.maxStunden, `${l.id}: Min ≤ Soll ≤ Max`);
      assert.ok(Number.isInteger(l.aufsichtenProWoche) && l.aufsichtenProWoche >= 0);
      for (const g of l.gesperrt) {
        assert.ok(d.zeitraster.tage.includes(g.tag));
        for (const s of g.stunden) assert.ok(stunden.includes(s));
      }
    }
    for (const r of d.raeume) {
      assert.ok(Modell.RAUMTYPEN.includes(r.typ), `${r.id}: Raumtyp ${r.typ}`);
      for (const n of r.nahe) assert.ok(raum.get(n)?.nahe.includes(r.id), `${r.id}: „nahe“ nicht symmetrisch`);
    }
    const raumtypen = new Set(d.raeume.map((r) => (r.typ === 'fachraum' ? r.fachraumtyp : r.typ)));
    for (const f of d.faecher) if (f.raumtyp) assert.ok(raumtypen.has(f.raumtyp), `kein Raum für ${f.id}`);
    for (const x of d.klassen) {
      assert.ok(lehr.has(x.klassenlehrkraft), `${x.id}: Klassenlehrkraft`);
      assert.ok(raum.has(x.heimatraum), `${x.id}: Heimatraum`);
      assert.ok(x.schueler <= raum.get(x.heimatraum).kapazitaet, `${x.id}: Heimatraum zu klein`);
      const summe = x.stundentafel.reduce((s, e) => s + e.stunden, 0);
      assert.ok(summe <= slotsProWoche, `${x.id}: ${summe} Stunden passen nicht ins Raster`);
      for (const e of x.stundentafel) assert.ok(fach.has(e.fach));
    }
    const hauptJe = new Map();
    for (const z of d.zuordnungen) {
      assert.ok(klasse.has(z.klasse) && fach.has(z.fach) && lehr.has(z.lehrkraft), 'Zuordnung mit ungültiger Referenz');
      assert.ok(Modell.ROLLEN.includes(z.rolle));
      const schluessel = z.klasse + '|' + z.fach;
      if (z.rolle === 'haupt') {
        assert.ok(!hauptJe.has(schluessel), `${schluessel}: mehr als eine Hauptlehrkraft`);
        hauptJe.set(schluessel, z.lehrkraft);
        assert.ok(k.qualifiziert(lehr.get(z.lehrkraft), z.fach, klasse.get(z.klasse).stufe), `${schluessel}: Hauptlehrkraft nicht qualifiziert (H8)`);
      }
    }
    for (const z of d.zuordnungen.filter((x) => x.rolle === 'zweit')) {
      assert.notEqual(hauptJe.get(z.klasse + '|' + z.fach), z.lehrkraft, 'Haupt- und Zweitlehrkraft identisch');
    }
    // Festzuordnungen lassen jeder Lehrkraft ihre Vertretungsreserve
    const fest = new Map();
    for (const z of d.zuordnungen) {
      const h = klasse.get(z.klasse).stundentafel.find((e) => e.fach === z.fach).stunden;
      fest.set(z.lehrkraft, (fest.get(z.lehrkraft) || 0) + h);
    }
    for (const l of d.lehrkraefte) assert.ok((fest.get(l.id) || 0) <= k.nutzbar(l), `${l.id}: Reserve angetastet`);
    // Pausen
    const vor = d.zeitraster.pausen.map((p) => p.vorStunde);
    assert.equal(new Set(vor).size, vor.length);
    for (const v of vor) assert.ok(stunden.includes(v));
    for (const s of d.zeitraster.doppelstundenStart) assert.ok(stunden.includes(s) && stunden.includes(s + 1));
  });
}

test('klein: 4 Klassen, Bedarf gedeckt, Aufsichten gedeckt, eine Abwesenheit', () => {
  const d = lade('klein');
  const k = kennzahlen(d);
  assert.equal(d.klassen.length, 4);
  assert.ok(k.kapazitaet >= k.bedarf);
  assert.ok(k.aufsichtsSoll >= k.aufsichtsBedarf);
  assert.equal(d.lehrkraefte.filter((l) => l.abwesenheiten.length).length, 1);
});

test('unterdeckung: Mathematik gezielt unterdeckt, Aufsichtssoll zu knapp', () => {
  const d = lade('unterdeckung');
  const k = kennzahlen(d);
  const unterdeckt = Object.keys(k.bedarfJeFach).filter((f) => k.kapazitaetJeFach[f] < k.bedarfJeFach[f]);
  assert.deepEqual(unterdeckt, ['f-ma']);
  assert.equal(k.bedarfJeFach['f-ma'] - k.kapazitaetJeFach['f-ma'], 10, 'erwarteter Mindestausfall');
  assert.ok(k.aufsichtsSoll < k.aufsichtsBedarf);
});

test('ueberhang: mehr Lehrkräfte als Klassen, deutliche Überkapazität, feste Zweitbesetzungen', () => {
  const d = lade('ueberhang');
  const k = kennzahlen(d);
  assert.ok(d.lehrkraefte.length > d.klassen.length);
  assert.ok(k.kapazitaet >= 1.5 * k.bedarf);
  assert.ok(d.zuordnungen.filter((z) => z.rolle === 'zweit').length >= 4);
  // Jede Stunde der Stundentafel hat eine Hauptlehrkraft
  for (const x of d.klassen) for (const e of x.stundentafel) {
    assert.ok(d.zuordnungen.some((z) => z.klasse === x.id && z.fach === e.fach && z.rolle === 'haupt'));
  }
});

test('gross: 30 Klassen, 60 Lehrkräfte, Fachräume, Turn- und Schwimmhalle vorhanden, alles zugeordnet', () => {
  const d = lade('gross');
  assert.equal(d.klassen.length, 30);
  assert.equal(d.lehrkraefte.length, 60);
  assert.equal(d.zeitraster.stunden.length, 8);
  assert.ok(d.raeume.filter((r) => r.typ === 'turnhalle').length >= 2);
  assert.ok(d.raeume.some((r) => r.fachraumtyp === 'nawi'));
  assert.ok(d.raeume.some((r) => r.typ === 'schwimmhalle'));
  assert.ok(d.faecher.some((f) => f.raumtyp === 'schwimmhalle'));
  const haupt = d.zuordnungen.filter((z) => z.rolle === 'haupt').length;
  assert.equal(haupt, d.klassen.reduce((s, x) => s + x.stundentafel.length, 0));
});
