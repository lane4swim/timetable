/* Planer: gültige Regelpläne (Abnahme 2), minimaler Ausfall (Abnahme 3),
 * eigene Lehrkräfte (Abnahme 4), Überhang mit Zweitbesetzung (Abnahme 8),
 * Pausenaufsichten (Abnahme 12), Reproduzierbarkeit, Leistung, Abbruch. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ladeKern } from '../hilfe/lade-kern.mjs';
import { datensatz } from '../hilfe/beispiele.mjs';
import { miniSchule } from '../hilfe/mini.mjs';

const { Planer, Regeln, Kosten, Index, Modell } = ladeKern();
const leererPlan = (z) => { z.plan.regelplan = []; z.plan.aufsichten = []; return z; };
const ergebnisse = new Map();
/** Plant einen Datensatz einmal (Ergebnis wird für mehrere Tests wiederverwendet). */
function geplant(name) {
  if (!ergebnisse.has(name)) {
    const z = name === 'mini' ? leererPlan(miniSchule()) : datensatz(name);
    const r = Planer.plane(z, { zeitbudgetMs: 30000 });
    z.plan.regelplan = r.plan.regelplan;
    z.plan.aufsichten = r.plan.aufsichten;
    ergebnisse.set(name, { z, r });
  }
  return ergebnisse.get(name);
}

describe('Abnahme 2: erzeugte Regelpläne verletzen keine harte Regel', () => {
  for (const name of ['mini', 'klein', 'unterdeckung', 'ueberhang', 'gross']) {
    test(name, { timeout: 60000 }, () => {
      const { z, r } = geplant(name);
      assert.deepEqual(r.bericht.verstoesse, []);
      assert.deepEqual(Regeln.pruefeHart(z), [], 'unabhängige Nachprüfung');
      assert.deepEqual(Kosten.bewerte(z).vektor, r.bericht.vektor);
      // Jede Stunde hat genau eine Hauptlehrkraft und einen Raum, Status regulär
      for (const s of r.plan.regelplan) {
        assert.equal(s.status, 'regulaer');
        assert.ok(s.raum);
        assert.ok(s.lehrkraefte.length >= 1 && s.lehrkraefte.length <= 2);
      }
    });
  }
});

describe('Abnahme 3: Ausfall nachweislich minimal', () => {
  test('ohne Unterdeckung kein Ausfall', () => {
    for (const name of ['mini', 'klein', 'ueberhang', 'gross']) {
      const { r } = geplant(name);
      assert.equal(r.bericht.vektor[0], 0, name);
      assert.equal(r.bericht.untereSchrankeK1, 0);
    }
  });
  test('Unterdeckung: Ausfall = untere Schranke aus der Zuweisung (kein Plan kann weniger haben)', () => {
    const { r } = geplant('unterdeckung');
    const b = r.bericht;
    assert.ok(b.vektor[0] > 0);
    assert.equal(b.vektor[0], b.untereSchrankeK1);
    assert.equal(b.ausfallMinimalNachgewiesen, true);
    assert.ok(b.ausfall.every((a) => a.fach === 'f-ma'), 'nur Mathematik fällt aus');
    assert.ok(b.vorpruefung.jeFach.find((x) => x.fach === 'f-ma').erwarteterAusfall > 0);
    assert.ok(b.warnungen.some((w) => /MA: Bedarf/.test(w)));
  });
  test('Schranke ist scharf: die einzige Mathe-Lehrkraft unterrichtet bis zur Höchstgrenze', () => {
    const { z, r } = geplant('unterdeckung');
    const ma = z.lehrkraefte.find((l) => l.qualifikationen.some((q) => q.fach === 'f-ma'));
    const stunden = r.plan.regelplan.filter((s) => s.fach === 'f-ma').length;
    const bedarf = z.klassen.reduce((s, k) => s + k.stundentafel.find((e) => e.fach === 'f-ma').stunden, 0);
    assert.equal(stunden, Math.min(bedarf, ma.maxStunden));
    assert.equal(bedarf - stunden, r.bericht.vektor[0]);
  });
});

describe('Abnahme 4: eigene Lehrkraft bevorzugt', () => {
  test('alle Stunden mit Festzuordnung durch die festgelegte Lehrkraft (K2 = 0)', () => {
    for (const name of ['mini', 'klein', 'ueberhang', 'gross']) assert.equal(geplant(name).r.bericht.vektor[2], 0, name);
  });
  test('ohne Festzuordnung wird die Klassenlehrkraft vor anderen Qualifizierten gewählt', () => {
    const z = leererPlan(miniSchule());
    // 1b DE ohne Festzuordnung; qualifiziert: A und D. Klassenlehrkraft von 1b wird D.
    z.zuordnungen = z.zuordnungen.filter((x) => !(x.klasse === 'k-1b' && x.fach === 'f-de'));
    z.klassen[1].klassenlehrkraft = 'l-d';
    const r = Planer.plane(z);
    const de = r.plan.regelplan.filter((s) => s.klasse === 'k-1b' && s.fach === 'f-de');
    assert.equal(de.length, 2);
    assert.ok(de.every((s) => s.lehrkraefte[0] === 'l-d'));
  });
  test('nicht qualifizierte Festzuordnung wird neu zugewiesen (mit Warnung, H8 bleibt gewahrt)', () => {
    const z = leererPlan(miniSchule());
    z.zuordnungen.find((x) => x.klasse === 'k-1b' && x.fach === 'f-mu').lehrkraft = 'l-d';
    z.lehrkraefte[2].sollStunden = 4;
    const r = Planer.plane(z);
    assert.deepEqual(r.bericht.verstoesse, []);
    assert.ok(r.bericht.warnungen.some((w) => /nicht qualifiziert/.test(w)));
    assert.ok(r.plan.regelplan.filter((s) => s.fach === 'f-mu').every((s) => s.lehrkraefte[0] === 'l-c'));
  });
});

describe('Abnahme 8: Überhang – Zweitbesetzung', () => {
  test('alle Klassen versorgt, Höchstgrenzen und Reserve eingehalten, Zweitbesetzungen vergeben', () => {
    const { z, r } = geplant('ueberhang');
    const ix = Index.erstelle(z);
    assert.equal(r.bericht.vektor[0], 0);
    const stunden = Regeln.lehrkraftStunden(r.plan.regelplan);
    let zweit = 0;
    for (const l of z.lehrkraefte) {
      const info = stunden.get(l.id);
      const ist = info?.slots.size || 0;
      assert.ok(ist <= l.maxStunden, `${l.kuerzel} über Höchstgrenze`);
      if (info?.zweit.size) assert.ok(ist <= l.sollStunden - ix.reserve(l), `${l.kuerzel}: Reserve angetastet`);
      zweit += info?.zweit.size || 0;
    }
    assert.ok(zweit > 20, `Zweitbesetzungen vergeben: ${zweit}`);
    assert.ok(r.plan.regelplan.every((s) => s.lehrkraefte.length <= 2));
    assert.equal(r.bericht.vektor[5], 0, 'kein ungenutztes Kontingent, wo Zweitbesetzung möglich wäre');
  });
  test('feste Zweit-Zuordnungen werden berücksichtigt', () => {
    const { z, r } = geplant('ueberhang');
    for (const zu of z.zuordnungen.filter((x) => x.rolle === 'zweit')) {
      const treffer = r.plan.regelplan.filter((s) => s.klasse === zu.klasse && s.fach === zu.fach && s.lehrkraefte[1] === zu.lehrkraft);
      assert.ok(treffer.length > 0, `${zu.klasse} ${zu.fach} ${zu.lehrkraft}`);
    }
  });
  test('Zweitbesetzung abgeschaltet: keine Zweitbesetzung, K5 entfällt', () => {
    const z = datensatz('ueberhang');
    z.einstellungen.zweitbesetzungErlaubt = false;
    const r = Planer.plane(z);
    assert.ok(r.plan.regelplan.every((s) => s.lehrkraefte.length === 1));
    assert.equal(r.bericht.vektor[5], 0);
  });
});

describe('Abnahme 12: Pausenaufsichten', () => {
  test('bei ausreichendem Soll alle besetzt, kein Soll überschritten, nur an Unterrichtstagen', () => {
    for (const name of ['klein', 'ueberhang', 'gross']) {
      const { z, r } = geplant(name);
      assert.equal(r.bericht.vektor[1], 0, name);
      const je = new Map();
      for (const a of r.plan.aufsichten) je.set(a.lehrkraft, (je.get(a.lehrkraft) || 0) + 1);
      for (const l of z.lehrkraefte) assert.ok((je.get(l.id) || 0) <= l.aufsichtenProWoche);
    }
  });
  test('knappes Soll: unbesetzt bleibt genau die Unterdeckung', () => {
    const { z, r } = geplant('unterdeckung');
    const soll = z.lehrkraefte.reduce((s, l) => s + l.aufsichtenProWoche, 0);
    assert.equal(r.plan.aufsichten.length, soll, 'das gesamte Soll wird genutzt');
    // Bedarf laut Plan: je Tag und Pause, wenn eine Klasse die Stunde nach der Pause hat
    const belegt = new Set(r.plan.regelplan.map((s) => s.tag + '|' + s.stunde));
    const bedarf = z.zeitraster.tage.reduce((summe, tag) => summe + z.zeitraster.pausen
      .filter((pa) => belegt.has(tag + '|' + pa.vorStunde)).reduce((x, pa) => x + pa.aufsichten, 0), 0);
    assert.ok(bedarf > soll);
    assert.equal(r.bericht.vektor[1], bedarf - soll);
  });
});

describe('Verfahren', () => {
  test('Reproduzierbarkeit: gleicher Startwert ⇒ gleicher Plan', () => {
    const a = Planer.plane(datensatz('klein'), { startwert: 7 });
    const b = Planer.plane(datensatz('klein'), { startwert: 7 });
    assert.deepEqual(a.plan, b.plan);
    const c = Planer.plane(datensatz('klein'), { startwert: 8 });
    assert.notDeepEqual(a.plan, c.plan);
  });
  test('Leistung: 30 Klassen und 60 Lehrkräfte deutlich unter 30 Sekunden', { timeout: 60000 }, () => {
    const { r } = geplant('gross');
    assert.ok(r.bericht.statistik.dauerMs < 30000, `${r.bericht.statistik.dauerMs} ms`);
    assert.equal(r.bericht.statistik.zeitbudgetErreicht, false);
  });
  test('Zeitscheiben, Fortschritt und Abbruch liefern einen gültigen Plan', () => {
    const z = datensatz('gross');
    const lauf = Planer.starte(z, { iterationen: 50000000 });
    const phasen = new Set();
    for (let i = 0; i < 20 && !lauf.fertig; i++) { lauf.schritt(20); phasen.add(lauf.fortschritt().phase); }
    assert.equal(lauf.fertig, false);
    const f = lauf.fortschritt();
    assert.ok(f.anteil > 0 && f.anteil < 1);
    lauf.abbrechen();
    let schritte = 0;
    while (!lauf.schritt(50)) schritte++;
    assert.ok(schritte < 20, 'Abbruch wirkt schnell');
    const r = lauf.ergebnis();
    assert.equal(r.bericht.statistik.abgebrochen, true);
    assert.deepEqual(r.bericht.verstoesse, []);
    assert.equal(lauf.fortschritt().anteil, 1);
  });
  test('Zeitbudget wird eingehalten', () => {
    let t = 0;
    // Künstliche Uhr: jede Abfrage rückt 5 ms vor (der Planer fragt etwa alle paar tausend Schritte)
    const r = Planer.plane(datensatz('klein'), { iterationen: 1e9, zeitbudgetMs: 1000, uhr: () => (t += 5) });
    assert.equal(r.bericht.statistik.zeitbudgetErreicht, true);
    assert.deepEqual(r.bericht.verstoesse, []);
  });
  test('Konflikte durch Sperrzeiten werden gelöst', () => {
    const z = leererPlan(miniSchule());
    z.lehrkraefte[0].gesperrt = [{ tag: 'Mo', stunden: [1, 2] }]; // A nur Mo 3–4 und Di
    const r = Planer.plane(z);
    assert.deepEqual(r.bericht.verstoesse, []);
    assert.ok(!r.plan.regelplan.some((s) => s.lehrkraefte.includes('l-a') && s.tag === 'Mo' && s.stunde <= 2));
  });
  test('unlösbare Lage: Stunden entfallen am Tagesende, keine Leerstunde', () => {
    const z = leererPlan(miniSchule());
    // A darf nur noch Di 1–2 unterrichten, hat aber 6 Stunden (DE/MA 1a, DE 1b) und D ist zu knapp
    z.lehrkraefte[0].gesperrt = [{ tag: 'Mo', stunden: [1, 2, 3, 4] }, { tag: 'Di', stunden: [3, 4] }];
    z.lehrkraefte[3].maxStunden = 0; z.lehrkraefte[3].sollStunden = 0; z.lehrkraefte[3].minStunden = 0;
    const r = Planer.plane(z);
    assert.deepEqual(r.bericht.verstoesse, []);
    assert.ok(r.bericht.vektor[0] > 0);
    assert.ok(r.bericht.ausfall.length > 0);
  });
  test('leere Schule', () => {
    const r = Planer.plane(Modell.leererZustand());
    assert.deepEqual(r.plan, { regelplan: [], aufsichten: [] });
    assert.deepEqual(r.bericht.verstoesse, []);
  });
});

describe('Raumtypen (Rückmeldung: Sport wurde nicht eingeplant)', () => {
  test('Schreibweise des Raumtyps spielt keine Rolle („Turnhalle“, „ turnhalle “)', () => {
    for (const wert of ['Turnhalle', ' turnhalle ', 'TURNHALLE']) {
      const z = datensatz('klein');
      z.faecher.find((f) => f.kuerzel === 'SP').raumtyp = wert;
      const r = Planer.plane(z);
      assert.equal(r.bericht.vektor[0], 0, wert);
      assert.equal(r.plan.regelplan.filter((s) => s.fach === 'f-sp').length, 12, wert);
      assert.ok(r.plan.regelplan.filter((s) => s.fach === 'f-sp').every((s) => z.raeume.find((x) => x.id === s.raum).typ === 'turnhalle'));
      assert.deepEqual(r.bericht.verstoesse, []);
    }
  });
  test('fehlt der Raum ganz, fällt nur dieses Fach aus – mit Begründung und Hinweis', () => {
    const z = datensatz('klein');
    z.raeume = z.raeume.filter((x) => x.typ !== 'turnhalle');
    const r = Planer.plane(z);
    const sport = z.klassen.reduce((s, k) => s + k.stundentafel.find((e) => e.fach === 'f-sp').stunden, 0);
    assert.equal(r.bericht.vektor[0], sport, 'genau die Sportstunden fallen aus');
    assert.equal(r.bericht.untereSchrankeK1, sport);
    assert.ok(r.bericht.ausfall.every((a) => a.fach === 'f-sp' && /kein Raum vom Typ „turnhalle“ vorhanden/.test(a.grund)));
    assert.ok(r.bericht.warnungen.some((w) => /SP: kein Raum vom Typ „turnhalle“ vorhanden/.test(w)));
    assert.ok(!r.bericht.warnungen.some((w) => /Kapazität qualifizierter Lehrkräfte/.test(w)), 'keine irreführende Personalwarnung');
    assert.deepEqual(r.bericht.verstoesse, []);
  });
  test('zu kleine Räume des Typs: Ausfall nur für die betroffene Klasse', () => {
    const z = leererPlan(miniSchule());
    z.raeume.find((x) => x.id === 'r-th').kapazitaet = 21; // 1a (20) passt, 1b (22) nicht
    const r = Planer.plane(z);
    assert.deepEqual(r.bericht.ausfall.map((a) => [a.klasse, a.fach, a.grund]), [['k-1b', 'f-sp', 'kein Raum vom Typ „turnhalle“ mit 22 Plätzen']]);
    assert.equal(r.plan.regelplan.filter((s) => s.klasse === 'k-1a' && s.fach === 'f-sp').length, 1);
  });
});
