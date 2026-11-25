/* Import und Export (Spezifikation §8): Rundlauf (Abnahme 1), atomarer Import
 * (Abnahme 7), Erhalt unbekannter Felder, Teil-Export und -Import. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ladeKern } from '../hilfe/lade-kern.mjs';
import { datensatz, datensatzText, kleinMitPlan } from '../hilfe/beispiele.mjs';

const { Io, Modell, Hilfen } = ladeKern();
const JETZT = new Date(2026, 10, 25, 16, 59, 0);
const leer = () => Modell.leererZustand();

/** Importiert und erwartet Erfolg. */
function importOk(text, aktuell = leer(), optionen) {
  const r = Io.importiere(text, aktuell, optionen);
  assert.ok(r.ok, 'Import fehlgeschlagen:\n' + r.fehler.map((f) => f.pfad + ': ' + f.meldung).join('\n'));
  return r;
}
const ohneZeit = (text) => { const d = JSON.parse(text); delete d.exportedAt; return d; };

describe('Abnahme 1: Export → Import → Export ergibt identischen Zustand', () => {
  const faelle = {
    klein: () => datensatz('klein'),
    unterdeckung: () => datensatz('unterdeckung'),
    ueberhang: () => datensatz('ueberhang'),
    gross: () => datensatz('gross'),
    'klein mit Plan und Zusatzfeldern': kleinMitPlan,
    'leerer Zustand': leer,
  };
  for (const [name, erzeuge] of Object.entries(faelle)) {
    test(name, () => {
      const start = importOk(JSON.stringify(erzeuge())).zustand;
      const export1 = Io.exportiere(start, { jetzt: JETZT });
      const zurueck = importOk(export1.text).zustand;
      const export2 = Io.exportiere(zurueck, { jetzt: new Date(2027, 0, 1) });
      assert.deepEqual(ohneZeit(export2.text), ohneZeit(export1.text));
      // Mit gleichem Zeitpunkt sogar byte-gleich
      assert.equal(Io.exportiere(zurueck, { jetzt: JETZT }).text, export1.text);
    });
  }
  test('Testdatei bleibt bis auf exportedAt unverändert (bereits kanonisch)', () => {
    const z = importOk(datensatzText('klein')).zustand;
    assert.deepEqual(ohneZeit(Io.exportiere(z, { jetzt: JETZT }).text), ohneZeit(datensatzText('klein')));
  });
});

describe('Export', () => {
  test('Dateiname und Kopf nach §8', () => {
    const e = Io.exportiere(datensatz('klein'), { jetzt: JETZT });
    assert.equal(e.dateiname, 'stundenplan-2026-11-25.json');
    assert.equal(e.daten.schemaVersion, 1);
    assert.match(e.daten.exportedAt, /^2026-11-25T16:59:00[+-]\d{2}:\d{2}$/);
    assert.deepEqual(Object.keys(e.daten).slice(0, 3), ['schemaVersion', 'exportedAt', 'schule']);
    assert.ok(e.text.endsWith('}\n'));
  });
  test('verändert den Zustand nicht', () => {
    const z = kleinMitPlan();
    const vorher = JSON.stringify(z);
    Io.exportiere(z, { jetzt: JETZT });
    Io.exportiere(z, { teil: 'stammdaten', jetzt: JETZT });
    assert.equal(JSON.stringify(z), vorher);
  });
  test('kanonische Feldreihenfolge: bekannte Felder nach Schema, unbekannte dahinter', () => {
    const z = datensatz('klein');
    const l = z.lehrkraefte[0];
    z.lehrkraefte[0] = { zusatz: 1, abwesenheiten: l.abwesenheiten, ...l };
    const daten = Io.exportiere(z, { jetzt: JETZT }).daten;
    const schluessel = Object.keys(daten.lehrkraefte[0]);
    assert.equal(schluessel[0], 'id');
    assert.equal(schluessel.at(-1), 'zusatz');
  });
  test('nur Stammdaten', () => {
    const e = Io.exportiere(kleinMitPlan(), { teil: 'stammdaten', jetzt: JETZT });
    assert.equal(e.dateiname, 'stundenplan-stammdaten-2026-11-25.json');
    assert.equal(e.daten.teil, 'stammdaten');
    assert.equal(e.daten.plan, undefined);
    assert.equal(e.daten.lehrkraefte.length, 5);
    assert.deepEqual(e.daten.erweiterung, kleinMitPlan().erweiterung, 'unbekannte Felder gehören zu den Stammdaten');
  });
  test('nur Plan', () => {
    const e = Io.exportiere(kleinMitPlan(), { teil: 'plan', jetzt: JETZT });
    assert.equal(e.dateiname, 'stundenplan-plan-2026-11-25.json');
    assert.deepEqual(Object.keys(e.daten), ['schemaVersion', 'exportedAt', 'teil', 'plan']);
    assert.equal(e.daten.plan.regelplan.length, 2);
  });
});

describe('Import', () => {
  test('unbekannte Zusatzfelder bleiben erhalten und werden wieder geschrieben', () => {
    const z = importOk(JSON.stringify(kleinMitPlan())).zustand;
    assert.deepEqual(z.erweiterung, { quelle: 'Test', liste: [1, 2, { a: true }] });
    assert.equal(z.lehrkraefte[0].telefon, 'intern 123');
    assert.equal(z.klassen[0].stundentafel[0].bemerkung, 'Lesezeit');
    assert.equal(z.einstellungen.experiment, 7);
    assert.deepEqual(z.plan.notizen, ['Zusatz']);
    assert.equal(z.plan.regelplan[1].notiz, 'unbekanntes Feld');
    const text = Io.exportiere(z, { jetzt: JETZT }).text;
    for (const s of ['"erweiterung"', '"telefon"', '"bemerkung"', '"experiment"', '"notizen"', '"notiz"']) assert.ok(text.includes(s), s);
  });
  test('ergänzt Standardwerte', () => {
    const z = importOk('{"schemaVersion":1,"zeitraster":{"tage":["Mo","Di"],"stunden":[{"nr":1,"von":"08:00","bis":"08:45"}]}}').zustand;
    assert.equal(z.einstellungen.vertretungsreserveProzent, 10);
    assert.deepEqual(z.plan, { regelplan: [], aufsichten: [], vertretungen: [], aufsichtsVertretungen: [] });
  });
  test('Byte-Order-Mark am Dateianfang wird toleriert', () => {
    importOk('﻿' + datensatzText('klein'));
  });
});

describe('Abnahme 7: fehlerhafte Dateien werden mit Pfad abgewiesen, Zustand bleibt unverändert', () => {
  const aktuell = kleinMitPlan();
  const vorher = JSON.stringify(aktuell);
  const faelle = [
    ['falsche Referenz', (d) => { d.lehrkraefte[3].qualifikationen[0].fach = 'f-xy'; }, 'lehrkraefte[3].qualifikationen[0].fach'],
    ['fehlendes Pflichtfeld', (d) => { delete d.klassen[0].name; }, 'klassen[0].name'],
    ['unbekannte (neuere) Version', (d) => { d.schemaVersion = 2; }, 'schemaVersion'],
    ['falscher Typ', (d) => { d.raeume[0].kapazitaet = 'groß'; }, 'raeume[0].kapazitaet'],
    ['doppelte ID', (d) => { d.faecher[1].id = d.faecher[0].id; }, 'faecher[1].id'],
  ];
  for (const [name, verderbe, pfad] of faelle) {
    test(name, () => {
      const d = datensatz('ueberhang');
      verderbe(d);
      const r = Io.importiere(JSON.stringify(d), aktuell);
      assert.equal(r.ok, false);
      assert.equal(r.zustand, undefined);
      assert.ok(r.fehler.some((f) => f.pfad === pfad), `Pfad ${pfad} erwartet; erhalten: ${r.fehler.map((f) => f.pfad).join(', ')}`);
      assert.equal(JSON.stringify(aktuell), vorher);
    });
  }
  test('kein JSON', () => {
    const r = Io.importiere('{ "schemaVersion": 1, ', aktuell);
    assert.equal(r.ok, false);
    assert.match(r.fehler[0].meldung, /keine gültige JSON-Datei/);
  });
  test('JSON, aber kein Objekt', () => {
    for (const text of ['[]', '42', 'null', '"text"']) {
      const r = Io.importiere(text, aktuell);
      assert.equal(r.ok, false, text);
      assert.match(r.fehler[0].meldung, /JSON-Objekt/);
    }
  });
  test('unbekannter Teil', () => {
    const d = datensatz('klein');
    d.teil = 'alles';
    const r = Io.importiere(JSON.stringify(d), aktuell);
    assert.equal(r.fehler[0].pfad, 'teil');
  });
  test('Zustand nach allen Fehlversuchen unverändert', () => {
    assert.equal(JSON.stringify(aktuell), vorher);
  });
});

describe('Teil-Import', () => {
  test('Stammdaten ersetzen nur Stammdaten, Plan bleibt', () => {
    const aktuell = importOk(JSON.stringify(kleinMitPlan())).zustand;
    const neu = Hilfen.tiefeKopie(aktuell);
    neu.lehrkraefte[0].name = 'Geänderter Name';
    neu.schule.name = 'Neue Schule';
    const datei = Io.exportiere(neu, { teil: 'stammdaten', jetzt: JETZT }).text;
    const r = importOk(datei, aktuell);
    assert.equal(r.teil, 'stammdaten');
    assert.equal(r.zustand.lehrkraefte[0].name, 'Geänderter Name');
    assert.equal(r.zustand.schule.name, 'Neue Schule');
    assert.deepEqual(r.zustand.plan, aktuell.plan);
  });
  test('Plan ersetzt nur den Plan, Stammdaten bleiben', () => {
    const quelle = importOk(JSON.stringify(kleinMitPlan())).zustand;
    const datei = Io.exportiere(quelle, { teil: 'plan', jetzt: JETZT }).text;
    const aktuell = importOk(datensatzText('klein')).zustand; // gleiche Stammdaten, leerer Plan
    aktuell.schule.name = 'Bleibt';
    const r = importOk(datei, aktuell);
    assert.equal(r.teil, 'plan');
    assert.deepEqual(r.zustand.plan, quelle.plan);
    assert.equal(r.zustand.schule.name, 'Bleibt');
    assert.deepEqual(r.zustand.lehrkraefte, aktuell.lehrkraefte);
  });
  test('Plan mit Verweis auf fehlende Klasse wird abgelehnt', () => {
    const datei = Io.exportiere(kleinMitPlan(), { teil: 'plan', jetzt: JETZT }).text;
    const aktuell = importOk(datensatzText('ueberhang')).zustand; // andere Klassen-IDs? gleiche Namen, andere Lehrkräfte
    const r = Io.importiere(datei, aktuell);
    assert.equal(r.ok, false);
    assert.ok(r.fehler.every((f) => f.pfad.startsWith('plan.')));
  });
  test('Plan in leeren Zustand importieren wird abgelehnt (keine Stammdaten)', () => {
    const datei = Io.exportiere(kleinMitPlan(), { teil: 'plan', jetzt: JETZT }).text;
    const r = Io.importiere(datei, leer());
    assert.equal(r.ok, false);
    assert.ok(r.fehler.some((f) => /unbekannte Referenz/.test(f.meldung)));
  });
  test('Stammdaten, zu denen der vorhandene Plan nicht passt: abgelehnt, mit Option „Plan verwerfen“ möglich', () => {
    const aktuell = importOk(JSON.stringify(kleinMitPlan())).zustand;
    const datei = Io.exportiere(datensatz('ueberhang'), { teil: 'stammdaten', jetzt: JETZT }).text;
    const r = Io.importiere(datei, aktuell);
    assert.equal(r.ok, false);
    assert.equal(r.planUnvertraeglich, true);
    const r2 = importOk(datei, aktuell, { planVerwerfen: true });
    assert.deepEqual(r2.zustand.plan, { regelplan: [], aufsichten: [], vertretungen: [], aufsichtsVertretungen: [] });
    assert.equal(r2.zustand.lehrkraefte.length, 10);
  });
  test('Stammdaten-Fehler sind nie „plan-unverträglich“', () => {
    const d = datensatz('klein');
    d.teil = 'stammdaten';
    delete d.plan;
    delete d.klassen[0].name;
    const r = Io.importiere(JSON.stringify(d), kleinMitPlan());
    assert.equal(r.ok, false);
    assert.equal(r.planUnvertraeglich, false);
  });
  test('Teil-Dateien dürfen nicht gemischt sein', () => {
    const d = datensatz('klein');
    d.teil = 'stammdaten';
    assert.equal(Io.importiere(JSON.stringify(d), leer()).fehler[0].pfad, 'plan');
    const p = { schemaVersion: 1, teil: 'plan', plan: {}, lehrkraefte: [] };
    assert.equal(Io.importiere(JSON.stringify(p), kleinMitPlan()).fehler[0].pfad, 'lehrkraefte');
  });
});
