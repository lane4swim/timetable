/* Schema-Validierung: Pflichtfelder, Typen, Bereiche, Referenzen, Eindeutigkeit,
 * Querprüfungen und Migrationen – jeweils mit Pfadangabe (Abnahme 7). */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ladeKern } from '../hilfe/lade-kern.mjs';
import { datensatz, kleinMitPlan } from '../hilfe/beispiele.mjs';

const { Schema, Modell } = ladeKern();

/** Normalisiert und prüft; liefert die Fehler als „pfad: meldung“. */
function pruefe(d) {
  Schema.normalisiere(d);
  return Schema.validiere(d);
}
/** Erwartet genau einen Fehler mit diesem Pfad, dessen Meldung `muster` enthält. */
function erwarteFehler(d, pfad, muster) {
  const { fehler } = pruefe(d);
  const treffer = fehler.filter((f) => f.pfad === pfad);
  assert.equal(treffer.length, 1, `Fehler bei „${pfad}“ erwartet, erhalten:\n${fehler.map((f) => f.pfad + ': ' + f.meldung).join('\n') || '(keine)'}`);
  if (muster) assert.match(treffer[0].meldung, muster);
  return fehler;
}

describe('gültige Daten', () => {
  for (const name of ['klein', 'unterdeckung', 'ueberhang', 'gross']) {
    test(`${name} ist fehlerfrei`, () => {
      const { fehler, warnungen } = pruefe(datensatz(name));
      assert.deepEqual(fehler, []);
      assert.deepEqual(warnungen, []);
    });
  }
  test('klein mit Plan aller Arten und Zusatzfeldern ist fehlerfrei', () => {
    assert.deepEqual(pruefe(kleinMitPlan()).fehler, []);
  });
  test('leerer Zustand ist fehlerfrei', () => {
    assert.deepEqual(pruefe(Modell.leererZustand()).fehler, []);
  });
  test('minimale Datei: nur schemaVersion und Zeitraster', () => {
    const d = { schemaVersion: 1, zeitraster: { tage: ['Mo'], stunden: [{ nr: 1, von: '08:00', bis: '08:45' }] } };
    assert.deepEqual(pruefe(d).fehler, []);
    assert.deepEqual(d.lehrkraefte, []);
    assert.equal(d.einstellungen.gewichte.W12, 3);
  });
});

describe('Normalisierung', () => {
  test('fehlende optionale Felder erhalten Standardwerte, vorhandene bleiben', () => {
    const d = datensatz('klein');
    delete d.lehrkraefte[0].maxStunden;
    delete d.lehrkraefte[0].gesperrt;
    delete d.faecher[0].blockbar;
    d.einstellungen = { gewichte: { W1: 99 } };
    Schema.normalisiere(d);
    assert.equal(d.lehrkraefte[0].maxStunden, d.lehrkraefte[0].sollStunden);
    assert.deepEqual(d.lehrkraefte[0].gesperrt, []);
    assert.equal(d.faecher[0].blockbar, true);
    assert.equal(d.einstellungen.gewichte.W1, 99);
    assert.equal(d.einstellungen.gewichte.W2, 5);
    assert.equal(d.einstellungen.vertretungsreserveProzent, 10);
  });
  test('Standardlisten sind unabhängige Objekte', () => {
    const a = { schemaVersion: 1, zeitraster: { tage: ['Mo'], stunden: [{ nr: 1, von: '08:00', bis: '08:45' }] } };
    const b = Modell.leererZustand();
    Schema.normalisiere(a);
    a.faecher.push('x');
    assert.deepEqual(b.faecher, []);
    const c = { schemaVersion: 1, zeitraster: { tage: ['Mo'], stunden: [{ nr: 1, von: '08:00', bis: '08:45' }] } };
    Schema.normalisiere(c);
    assert.deepEqual(c.faecher, []);
  });
});

describe('fehlende Pflichtfelder', () => {
  test('Name einer Klasse', () => {
    const d = datensatz('klein');
    delete d.klassen[1].name;
    erwarteFehler(d, 'klassen[1].name', /Pflichtfeld fehlt/);
  });
  test('Zeitraster', () => {
    const d = datensatz('klein');
    delete d.zeitraster;
    erwarteFehler(d, 'zeitraster', /Pflichtfeld fehlt/);
  });
  test('Sollstunden einer Lehrkraft', () => {
    const d = datensatz('klein');
    delete d.lehrkraefte[2].sollStunden;
    erwarteFehler(d, 'lehrkraefte[2].sollStunden', /Pflichtfeld fehlt/);
  });
  test('Fachraum ohne Fachraumtyp', () => {
    const d = datensatz('gross');
    const i = d.raeume.findIndex((r) => r.typ === 'fachraum');
    delete d.raeume[i].fachraumtyp;
    erwarteFehler(d, `raeume[${i}].fachraumtyp`, /Fachräumen/);
  });
  test('Status einer Stunde', () => {
    const d = kleinMitPlan();
    delete d.plan.regelplan[0].status;
    erwarteFehler(d, 'plan.regelplan[0].status', /Pflichtfeld fehlt/);
  });
  test('leerer Text gilt nicht als vorhanden', () => {
    const d = datensatz('klein');
    d.lehrkraefte[0].name = '   ';
    erwarteFehler(d, 'lehrkraefte[0].name', /nicht leer/);
  });
});

describe('falsche Referenzen', () => {
  test('Qualifikation verweist auf unbekanntes Fach (Pfadbeispiel aus §8)', () => {
    const d = datensatz('klein');
    d.lehrkraefte[3].qualifikationen[0].fach = 'f-xy';
    erwarteFehler(d, 'lehrkraefte[3].qualifikationen[0].fach', /unbekannte Referenz „f-xy“ \(Fach/);
  });
  test('Klassenlehrkraft, Heimatraum, Zuordnung, Plan, Aufsicht', () => {
    const d = kleinMitPlan();
    d.klassen[0].klassenlehrkraft = 'l-niemand';
    d.klassen[1].heimatraum = 'r-999';
    d.zuordnungen[0].klasse = 'k-9z';
    d.plan.regelplan[1].lehrkraefte = ['l-fremd'];
    d.plan.aufsichten[0].lehrkraft = 'l-fremd';
    d.plan.vertretungen[2].verteilung[0].zielKlasse = 'k-fremd';
    const { fehler } = pruefe(d);
    const pfade = fehler.map((f) => f.pfad);
    for (const p of ['klassen[0].klassenlehrkraft', 'klassen[1].heimatraum', 'zuordnungen[0].klasse', 'plan.regelplan[1].lehrkraefte[0]',
      'plan.aufsichten[0].lehrkraft', 'plan.vertretungen[2].verteilung[0].zielKlasse']) {
      assert.ok(pfade.includes(p), `Fehler bei ${p} erwartet; erhalten: ${pfade.join(', ')}`);
    }
  });
  test('Raum „nahe“ verweist auf unbekannten Raum', () => {
    const d = datensatz('klein');
    d.raeume[0].nahe = ['r-xyz'];
    erwarteFehler(d, 'raeume[0].nahe[0]', /Raum existiert nicht/);
  });
});

describe('Typen und Bereiche', () => {
  test('Text statt Zahl', () => {
    const d = datensatz('klein');
    d.lehrkraefte[0].sollStunden = '24';
    erwarteFehler(d, 'lehrkraefte[0].sollStunden', /muss eine Zahl sein/);
  });
  test('Bruchzahl, wo ganze Zahl verlangt', () => {
    const d = datensatz('klein');
    d.klassen[0].schueler = 22.5;
    erwarteFehler(d, 'klassen[0].schueler', /ganze Zahl/);
  });
  test('Zahlenbereiche', () => {
    const d = datensatz('klein');
    d.klassen[0].stufe = 14;
    d.zeitraster.pausen[0].aufsichten = -1;
    d.einstellungen.gewichtAufteilung = 1;
    const { fehler } = pruefe(d);
    const pfade = fehler.map((f) => f.pfad);
    assert.ok(pfade.includes('klassen[0].stufe'));
    assert.ok(pfade.includes('zeitraster.pausen[0].aufsichten'));
    assert.ok(pfade.includes('einstellungen.gewichtAufteilung'), 'Aufteilung muss schwerer wiegen als Doppelbetreuung');
  });
  test('unzulässiger Aufzählungswert', () => {
    const d = datensatz('klein');
    d.raeume[0].typ = 'aula';
    erwarteFehler(d, 'raeume[0].typ', /schwimmhalle/);
  });
  test('Liste statt Objekt und Objekt statt Liste', () => {
    const d = datensatz('klein');
    d.schule = [];
    d.faecher = {};
    const { fehler } = pruefe(d);
    assert.ok(fehler.some((f) => f.pfad === 'schule' && /Objekt/.test(f.meldung)));
    assert.ok(fehler.some((f) => f.pfad === 'faecher' && /Liste/.test(f.meldung)));
  });
  test('Datum und Uhrzeit', () => {
    const d = kleinMitPlan();
    d.lehrkraefte[0].abwesenheiten = [{ von: '2026-11-31', bis: '2026-12-01' }];
    d.zeitraster.stunden[0].von = '8:00';
    const { fehler } = pruefe(d);
    assert.ok(fehler.some((f) => f.pfad === 'lehrkraefte[0].abwesenheiten[0].von' && /JJJJ-MM-TT/.test(f.meldung)));
    assert.ok(fehler.some((f) => f.pfad === 'zeitraster.stunden[0].von' && /HH:MM/.test(f.meldung)));
  });
  test('Tag, Stunde und Pause müssen im Zeitraster vorkommen', () => {
    const d = kleinMitPlan();
    d.plan.regelplan[0].tag = 'Sa';
    d.plan.regelplan[1].stunde = 9;
    d.plan.aufsichten[0].vorStunde = 2;
    const { fehler } = pruefe(d);
    const pfade = fehler.map((f) => f.pfad);
    assert.ok(pfade.includes('plan.regelplan[0].tag'));
    assert.ok(pfade.includes('plan.regelplan[1].stunde'));
    assert.ok(pfade.includes('plan.aufsichten[0].vorStunde'));
  });
  test('Vertretung an einem Samstag', () => {
    const d = kleinMitPlan();
    d.plan.vertretungen[0].datum = '2026-11-21';
    erwarteFehler(d, 'plan.vertretungen[0].datum', /Sa/);
  });
});

describe('Eindeutigkeit', () => {
  test('doppelte ID', () => {
    const d = datensatz('klein');
    d.lehrkraefte[2].id = d.lehrkraefte[0].id;
    erwarteFehler(d, 'lehrkraefte[2].id', /bereits in lehrkraefte\[0\]/);
  });
  test('doppeltes Kürzel (ohne Groß-/Kleinschreibung)', () => {
    const d = datensatz('klein');
    d.lehrkraefte[1].kuerzel = d.lehrkraefte[0].kuerzel.toLowerCase();
    erwarteFehler(d, 'lehrkraefte[1].kuerzel', /Kürzel/);
  });
  test('doppelter Klassenname', () => {
    const d = datensatz('klein');
    d.klassen[1].name = d.klassen[0].name;
    erwarteFehler(d, 'klassen[1].name');
  });
  test('Fach doppelt in der Stundentafel', () => {
    const d = datensatz('klein');
    d.klassen[0].stundentafel.push({ ...d.klassen[0].stundentafel[0] });
    erwarteFehler(d, `klassen[0].stundentafel[${d.klassen[0].stundentafel.length - 1}].fach`, /steht bereits/);
  });
  test('zwei Pausen vor derselben Stunde', () => {
    const d = datensatz('klein');
    d.zeitraster.pausen.push({ vorStunde: 3, name: 'doppelt', aufsichten: 1 });
    erwarteFehler(d, 'zeitraster.pausen[3].vorStunde', /bereits eine Pause/);
  });
});

describe('Zuordnungen und Lehrkräfte je Stunde (§8)', () => {
  test('höchstens eine Hauptlehrkraft je Klasse und Fach', () => {
    const d = datensatz('klein');
    const z = d.zuordnungen[0];
    const andere = d.lehrkraefte.find((l) => l.id !== z.lehrkraft);
    d.zuordnungen.push({ ...z, lehrkraft: andere.id });
    erwarteFehler(d, `zuordnungen[${d.zuordnungen.length - 1}].rolle`, /bereits eine Hauptlehrkraft/);
  });
  test('Lehrkraft nicht zugleich Haupt- und Zweitlehrkraft einer Zuordnung', () => {
    const d = datensatz('klein');
    d.zuordnungen.push({ ...d.zuordnungen[0], rolle: 'zweit' });
    erwarteFehler(d, `zuordnungen[${d.zuordnungen.length - 1}].lehrkraft`, /bereits als „haupt“/);
  });
  test('Zuordnung für ein Fach außerhalb der Stundentafel', () => {
    const d = datensatz('gross');
    const k = d.klassen[0]; // Stufe 5: keine Chemie
    d.zuordnungen.push({ klasse: k.id, fach: 'f-ch', lehrkraft: d.lehrkraefte[0].id, rolle: 'haupt' });
    erwarteFehler(d, `zuordnungen[${d.zuordnungen.length - 1}].fach`, /nicht in der Stundentafel/);
  });
  test('mehr Lehrkräfte in einer Stunde als erlaubt', () => {
    const d = kleinMitPlan();
    d.plan.regelplan[0].lehrkraefte = d.lehrkraefte.slice(0, 3).map((l) => l.id);
    erwarteFehler(d, 'plan.regelplan[0].lehrkraefte', /höchstens 2 Lehrkräfte/);
  });
  test('Grenze folgt der Einstellung maxLehrkraefteProKlasseUndSlot', () => {
    const d = kleinMitPlan();
    d.einstellungen.maxLehrkraefteProKlasseUndSlot = 1;
    erwarteFehler(d, 'plan.regelplan[0].lehrkraefte', /höchstens 1 Lehrkräfte/);
  });
  test('dieselbe Lehrkraft als Haupt- und Zweitlehrkraft einer Stunde', () => {
    const d = kleinMitPlan();
    const l = d.plan.regelplan[0].lehrkraefte[0];
    d.plan.regelplan[0].lehrkraefte = [l, l];
    erwarteFehler(d, 'plan.regelplan[0].lehrkraefte[1]', /zugleich Haupt- und Zweitlehrkraft/);
  });
  test('Stunde ohne Lehrkraft nur bei Entfall oder Aufteilung', () => {
    const d = kleinMitPlan();
    d.plan.regelplan[1].lehrkraefte = [];
    erwarteFehler(d, 'plan.regelplan[1].lehrkraefte', /mindestens eine Lehrkraft/);
  });
  test('Klasse zweimal im selben Zeitslot des Regelplans', () => {
    const d = kleinMitPlan();
    d.plan.regelplan[1].stunde = 1;
    erwarteFehler(d, 'plan.regelplan[1]', /bereits eine Stunde/);
  });
});

describe('fachliche Querprüfungen', () => {
  test('Min ≤ Soll ≤ Max', () => {
    const d = datensatz('klein');
    d.lehrkraefte[0].minStunden = d.lehrkraefte[0].sollStunden + 1;
    d.lehrkraefte[1].maxStunden = d.lehrkraefte[1].sollStunden - 1;
    const { fehler } = pruefe(d);
    assert.ok(fehler.some((f) => f.pfad === 'lehrkraefte[0].minStunden'));
    assert.ok(fehler.some((f) => f.pfad === 'lehrkraefte[1].maxStunden'));
  });
  test('Stufenbereich und Abwesenheitszeitraum', () => {
    const d = datensatz('klein');
    d.lehrkraefte[0].qualifikationen[0].stufenVon = 4;
    d.lehrkraefte[0].qualifikationen[0].stufenBis = 2;
    d.lehrkraefte[1].abwesenheiten = [{ von: '2026-11-20', bis: '2026-11-19' }];
    const { fehler } = pruefe(d);
    assert.ok(fehler.some((f) => f.pfad === 'lehrkraefte[0].qualifikationen[0].stufenBis'));
    assert.ok(fehler.some((f) => f.pfad === 'lehrkraefte[1].abwesenheiten[0].bis'));
  });
  test('Zeitraster: Nummerierung, Reihenfolge, Doppelstunden', () => {
    const d = datensatz('klein');
    d.zeitraster.stunden[2].nr = 4;
    d.zeitraster.stunden[3].von = '09:00';
    d.zeitraster.doppelstundenStart = [1, 6];
    d.zeitraster.tage = ['Di', 'Mo'];
    const { fehler } = pruefe(d);
    const pfade = fehler.map((f) => f.pfad);
    for (const p of ['zeitraster.stunden[2].nr', 'zeitraster.stunden[3].von', 'zeitraster.doppelstundenStart[1]', 'zeitraster.tage']) {
      assert.ok(pfade.includes(p), `Fehler bei ${p} erwartet; erhalten: ${pfade.join(', ')}`);
    }
  });
  test('Fach verlangt Klassenraum oder Fachraum statt eines Typs', () => {
    const d = datensatz('klein');
    d.faecher[0].raumtyp = 'fachraum';
    erwarteFehler(d, 'faecher[0].raumtyp', /kein benötigter Raumtyp/);
  });
  test('Warnung (kein Fehler), wenn kein Raum des verlangten Typs existiert', () => {
    const d = datensatz('klein');
    d.faecher[0].raumtyp = 'schwimmhalle';
    const { fehler, warnungen } = pruefe(d);
    assert.deepEqual(fehler, []);
    assert.ok(warnungen.some((w) => w.pfad === 'faecher[0].raumtyp'));
  });
  test('Warnung bei zu kleinem Heimatraum', () => {
    const d = datensatz('klein');
    d.klassen[0].schueler = 40;
    const { fehler, warnungen } = pruefe(d);
    assert.deepEqual(fehler, []);
    assert.ok(warnungen.some((w) => w.pfad === 'klassen[0].heimatraum' && /H6/.test(w.meldung)));
  });
  test('Doppelbetreuung braucht zweite Klasse, Aufteilung eine Verteilung', () => {
    const d = kleinMitPlan();
    delete d.plan.vertretungen[1].mitKlasse;
    delete d.plan.vertretungen[2].verteilung;
    const { fehler } = pruefe(d);
    assert.ok(fehler.some((f) => f.pfad === 'plan.vertretungen[1].mitKlasse'));
    assert.ok(fehler.some((f) => f.pfad === 'plan.vertretungen[2].verteilung'));
  });
  test('Aufteilung verteilt nicht mehr Schüler:innen als die Klasse hat', () => {
    const d = kleinMitPlan();
    d.plan.vertretungen[2].verteilung[0].anzahl = 60;
    erwarteFehler(d, 'plan.vertretungen[2].verteilung', /verteilt 60/);
  });
  test('Aufsichtsvertretung: Status und Lehrkraft passen zusammen', () => {
    const d = kleinMitPlan();
    d.plan.aufsichtsVertretungen[0].lehrkraft = null;
    d.plan.aufsichtsVertretungen[1].lehrkraft = d.lehrkraefte[0].id;
    const { fehler } = pruefe(d);
    assert.ok(fehler.some((f) => f.pfad === 'plan.aufsichtsVertretungen[0].lehrkraft'));
    assert.ok(fehler.some((f) => f.pfad === 'plan.aufsichtsVertretungen[1].lehrkraft'));
  });
});

describe('Migration und Version', () => {
  test('neuere Version wird mit Hinweis abgelehnt', () => {
    const r = Schema.migriere({ schemaVersion: 99 });
    assert.equal(r.fehler[0].pfad, 'schemaVersion');
    assert.match(r.fehler[0].meldung, /neuer als dieses Programm/);
  });
  test('fehlende oder unsinnige Version', () => {
    assert.match(Schema.migriere({}).fehler[0].meldung, /Pflichtfeld fehlt/);
    assert.match(Schema.migriere({ schemaVersion: '1' }).fehler[0].meldung, /ganze Zahl/);
  });
  test('aktuelle Version bleibt unverändert', () => {
    const d = { schemaVersion: 1, x: 1 };
    const r = Schema.migriere(d);
    assert.deepEqual(r.fehler, []);
    assert.equal(r.daten, d);
    assert.equal(r.migriertVon, undefined);
  });
  test('ältere Version wird stufenweise migriert', () => {
    const migrationen = { 0: (d) => ({ ...d, zeitraster: d.raster, raster: undefined }) };
    const r = Schema.migriere({ schemaVersion: 0, raster: { tage: ['Mo'] } }, migrationen);
    assert.deepEqual(r.fehler, []);
    assert.equal(r.daten.schemaVersion, 1);
    assert.deepEqual(r.daten.zeitraster, { tage: ['Mo'] });
    assert.equal(r.migriertVon, 0);
  });
  test('ältere Version ohne Migration wird abgelehnt', () => {
    assert.match(Schema.migriere({ schemaVersion: 0 }).fehler[0].meldung, /nicht mehr unterstützt/);
  });
});

test('Fehlerliste ist begrenzt', () => {
  const d = datensatz('gross');
  for (const l of d.lehrkraefte) for (const q of l.qualifikationen) q.fach = 'f-falsch';
  for (const k of d.klassen) for (const e of k.stundentafel) e.fach = 'f-falsch';
  const { fehler } = pruefe(d);
  assert.ok(fehler.length <= 501);
  assert.match(fehler.at(-1).meldung, /weitere Fehler/);
});

test('Raumtyp ohne Rücksicht auf Groß-/Kleinschreibung: keine Warnung bei „Turnhalle“', () => {
  const d = datensatz('klein');
  d.faecher.find((f) => f.kuerzel === 'SP').raumtyp = 'Turnhalle';
  const { fehler, warnungen } = pruefe(d);
  assert.deepEqual(fehler, []);
  assert.deepEqual(warnungen, []);
  assert.equal(Modell.raumtypSchluessel('  Turnhalle '), 'turnhalle');
  assert.equal(Modell.raumtypSchluessel('  '), null);
  assert.equal(Modell.raumtypDesRaums({ typ: 'fachraum', fachraumtyp: 'NaWi' }), 'nawi');
  assert.equal(Modell.raumtypDesRaums({ typ: 'klassenraum' }), null);
});
