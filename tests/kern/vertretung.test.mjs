/* Vertretung (§5): Tagesplan, Eskalationskette in der Reihenfolge der Stufen
 * (Abnahme 5), Aufteilung ohne Kapazitätsüberschreitung (Abnahme 6),
 * Aufrücken der Zweitbesetzung (Abnahme 9), Abziehen einer Zweitbesetzung
 * (Abnahme 10), keine Leerstunde (Abnahme 11), Aufsichtsvertretung (Abnahme 13). */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ladeKern } from '../hilfe/lade-kern.mjs';
import { miniSchule } from '../hilfe/mini.mjs';
import { datensatz } from '../hilfe/beispiele.mjs';

const { Vertretung, Regeln, Planer, Kosten } = ladeKern();
const MO = '2026-11-16';
const DI = '2026-11-17';
const lk = (z, id) => z.lehrkraefte.find((l) => l.id === id);
const raum = (z, id) => z.raeume.find((r) => r.id === id);
const abwesend = (z, id, von = MO, bis = von) => { lk(z, id).abwesenheiten = [{ von, bis, grund: 'krank' }]; };
/** Löst 1a Mo 2. Stunde (MA bei A) bei Abwesenheit von A. */
const loese1aMo2 = (z) => Vertretung.loese(z, { art: 'lehrkraft', datum: MO, klasse: 'k-1a', stunde: 2, lehrkraft: 'l-a' });
const nachher = (z, v, datum = MO) => { Vertretung.uebernehmen(z, v); return Regeln.pruefeHart(z, Vertretung.tagesplan(z, datum), { datum }); };

describe('Tagesplan', () => {
  test('Regelplan des Wochentags, überlagert von Vertretungen; Regelplan bleibt unverändert', () => {
    const z = miniSchule();
    const regel = JSON.stringify(z.plan.regelplan);
    z.plan.vertretungen.push({ datum: MO, klasse: 'k-1a', stunde: 2, status: 'entfaellt', lehrkraefte: [], raum: null, grund: 'test' });
    const tp = Vertretung.tagesplan(z, MO);
    assert.equal(tp.stunden.length, 5);
    assert.equal(tp.stunden.find((s) => s.klasse === 'k-1a' && s.stunde === 2).status, 'entfaellt');
    assert.equal(tp.stunden.find((s) => s.klasse === 'k-1a' && s.stunde === 2).fach, 'f-ma', 'Fach aus dem Regelplan');
    assert.equal(Vertretung.tagesplan(z, '2026-11-23').stunden.find((s) => s.klasse === 'k-1a' && s.stunde === 2).status, 'regulaer', 'anderer Montag unberührt');
    assert.equal(JSON.stringify(z.plan.regelplan), regel);
  });
  test('betroffene Stunden und Aufsichten', () => {
    const z = miniSchule();
    abwesend(z, 'l-a');
    const b = Vertretung.betroffen(z, MO);
    assert.deepEqual(b.filter((x) => x.art === 'lehrkraft').map((x) => x.klasse + x.stunde), ['k-1a1', 'k-1a2']);
    assert.deepEqual(b.filter((x) => x.art === 'aufsicht').map((x) => x.vorStunde), [1]);
    assert.deepEqual(Vertretung.betroffen(z, DI), []);
  });
});

describe('Abnahme 5: Eskalationskette in fester Reihenfolge', () => {
  test('Stufe 1: Zweitbesetzung rückt auf (Abnahme 9: Raum und Zeit bleiben, kein Ausfall)', () => {
    const z = miniSchule();
    abwesend(z, 'l-a');
    z.plan.regelplan[1].lehrkraefte = ['l-a', 'l-d'];
    const v = loese1aMo2(z);
    assert.equal(v.stufe, 1);
    assert.equal(v.stufeText, 'Zweitbesetzung rückt auf');
    assert.deepEqual(v.eintraege, [{ datum: MO, klasse: 'k-1a', fach: 'f-ma', stunde: 2, status: 'vertreten', lehrkraefte: ['l-d'], raum: 'r-a', grund: 'zweitbesetzungRueckt' }]);
    assert.equal(v.vektor[0], 0);
    assert.ok(v.alternativen.every((a) => a.stufe >= 1));
  });
  test('Stufe 2: Umplanen (Tausch in der Woche), wenn keine Zweitbesetzung', () => {
    const z = miniSchule();
    abwesend(z, 'l-a');
    // 1a Deutsch unterrichtet D (fest zugeordnet), A nur Mathematik
    z.plan.regelplan[3].lehrkraefte = ['l-d'];
    z.plan.regelplan[4].lehrkraefte = ['l-d'];
    z.zuordnungen.find((x) => x.klasse === 'k-1a' && x.fach === 'f-de').lehrkraft = 'l-d';
    const v = loese1aMo2(z);
    assert.equal(v.stufe, 2);
    assert.deepEqual(v.eintraege.map((e) => [e.datum, e.fach, e.lehrkraefte[0]]), [[MO, 'f-de', 'l-d'], [DI, 'f-ma', 'l-a']]);
    assert.equal(v.eintraege[0].stunde, 2);
    assert.equal(v.vektor[0], 0);
    assert.equal(v.vektor[2], 0, 'beide Stunden durch die eigene Lehrkraft (K2 = 0)');
  });
  test('Stufe 3: Lehrkraft der Klasse; spätere Stufen nur als Alternativen', () => {
    const z = miniSchule();
    abwesend(z, 'l-a');
    const v = loese1aMo2(z);
    assert.equal(v.stufe, 3);
    assert.deepEqual(v.eintraege[0].lehrkraefte, ['l-b']);
    assert.match(v.text, /B vertritt \(Lehrkraft der Klasse\)/);
    assert.ok(v.alternativen.every((a) => a.stufe >= 3));
    assert.ok(!v.alternativen.some((a) => a.stufe < 3));
  });
  test('Stufe 4: andere Lehrkraft (hier Notfalleinsatz, fachfremd → K3)', () => {
    const z = miniSchule();
    abwesend(z, 'l-a');
    lk(z, 'l-b').gesperrt.push({ tag: 'Mo', stunden: [2] });
    const v = loese1aMo2(z);
    assert.equal(v.stufe, 4);
    assert.deepEqual(v.eintraege[0].lehrkraefte, ['l-d']);
    assert.match(v.text, /Notfalleinsatz/);
    assert.equal(v.vektor[3], 1);
  });
  test('Abnahme 10: nur Zweitbesetzung im Slot → abziehen; die andere Klasse behält ihre Hauptlehrkraft', () => {
    const z = miniSchule();
    abwesend(z, 'l-a');
    lk(z, 'l-b').gesperrt.push({ tag: 'Mo', stunden: [2] });
    lk(z, 'l-d').qualifikationen.push({ fach: 'f-ma', stufenVon: 1, stufenBis: 4 });
    z.plan.regelplan[6].lehrkraefte = ['l-c', 'l-d']; // D ist Mo 2 Zweitbesetzung in 1b
    const v = loese1aMo2(z);
    assert.equal(v.stufe, 4);
    assert.match(v.text, /Zweitbesetzung in 1b wird abgezogen/);
    const e1b = v.eintraege.find((e) => e.klasse === 'k-1b');
    assert.deepEqual(e1b.lehrkraefte, ['l-c'], '1b behält C');
    assert.deepEqual(v.eintraege.find((e) => e.klasse === 'k-1a').lehrkraefte, ['l-d']);
    // übrig bleiben nur Meldungen zu A (abwesend, noch offen) und zur Testsperre von B (Aufsicht)
    assert.deepEqual(nachher(z, v).filter((x) => x.regel !== 'H4' && x.regel !== 'H13'), []);
  });
  test('Stufe 5: Doppelbetreuung, nur wenn niemand frei ist', () => {
    const z = miniSchule();
    abwesend(z, 'l-a');
    lk(z, 'l-b').gesperrt.push({ tag: 'Mo', stunden: [2] });
    lk(z, 'l-d').abwesenheiten = [{ von: MO, bis: MO, grund: '' }];
    raum(z, 'r-mu').nahe = ['r-a'];
    raum(z, 'r-a').nahe.push('r-mu');
    const v = loese1aMo2(z);
    assert.equal(v.stufe, 5);
    assert.deepEqual(v.eintraege[0], { datum: MO, klasse: 'k-1a', fach: 'f-ma', stunde: 2, status: 'doppeltBetreut', lehrkraefte: ['l-c'], raum: 'r-a', mitKlasse: 'k-1b', grund: 'doppelbetreuung' });
    assert.equal(v.vektor[4], 1);
  });
  test('Stufe 6 und Abnahme 6: Aufteilung ohne Kapazitätsüberschreitung', () => {
    const z = miniSchule();
    abwesend(z, 'l-a');
    lk(z, 'l-b').gesperrt.push({ tag: 'Mo', stunden: [2] });
    lk(z, 'l-d').abwesenheiten = [{ von: MO, bis: MO, grund: '' }];
    z.einstellungen.maxDoppelbetreuungProTag = 0; // Doppelbetreuung nicht erlaubt
    raum(z, 'r-mu').kapazitaet = 45;
    const v = loese1aMo2(z);
    assert.equal(v.stufe, 6);
    const e = v.eintraege[0];
    assert.equal(e.status, 'aufgeteilt');
    assert.deepEqual(e.verteilung, [{ zielKlasse: 'k-1b', anzahl: 20, gruppe: 'A' }]);
    assert.match(v.text, /Gruppe A → 1b: 20 Schüler:innen/);
    const verstoesse = nachher(z, v);
    assert.ok(!verstoesse.some((x) => x.regel === 'H6'));
    // Mehr Schüler:innen als Platz: keine Aufteilung
    const y = miniSchule();
    abwesend(y, 'l-a');
    lk(y, 'l-b').gesperrt.push({ tag: 'Mo', stunden: [2] });
    lk(y, 'l-d').abwesenheiten = [{ von: MO, bis: MO, grund: '' }];
    y.einstellungen.maxDoppelbetreuungProTag = 0;
    raum(y, 'r-mu').kapazitaet = 41; // 22 + 20 = 42 > 41
    assert.notEqual(loese1aMo2(y).stufe, 6);
  });
  test('Stufe 7 und Abnahme 11: Ausfall in der Tagesmitte → Nachrücken, keine Leerstunde', () => {
    const z = miniSchule();
    abwesend(z, 'l-a');
    lk(z, 'l-d').abwesenheiten = [{ von: MO, bis: MO, grund: '' }];
    Object.assign(lk(z, 'l-b'), { sollStunden: 2, minStunden: 0, maxStunden: 2 }); // B ist ausgelastet
    const alle = Vertretung.vorschlaege(z, MO, MO);
    const v = alle.find((x) => x.klasse === 'k-1a' && x.stunde === 2);
    assert.equal(v.stufe, 7);
    assert.match(v.text, /Nachrücken/);
    for (const x of alle) Vertretung.uebernehmen(z, x);
    const tp = Vertretung.tagesplan(z, MO);
    const tag1a = tp.stunden.filter((s) => s.klasse === 'k-1a').sort((a, b) => a.stunde - b.stunde);
    assert.deepEqual(tag1a.map((s) => [s.stunde, s.fach, s.status]), [[1, 'f-ma', 'vertreten'], [2, 'f-sp', 'regulaer'], [3, 'f-ma', 'entfaellt']]);
    assert.ok(!Regeln.pruefeHart(z, tp, { datum: MO }).some((x) => x.regel === 'H12'), 'keine Leerstunde');
    assert.equal(Kosten.bewerte(z, tp, { datum: MO }).vektor[0], 1, 'genau eine Stunde Ausfall');
    const bericht = Vertretung.ausfallbericht(z, MO, MO);
    assert.deepEqual(bericht.map((b) => [b.klasse, b.stunde, b.fach, b.grund]), [['1a', 3, 'MA', 'Folgende Stunden nachgerückt']]);
  });
  test('Stufe 7: Entfall am Tagesrand', () => {
    const z = miniSchule();
    abwesend(z, 'l-b');
    lk(z, 'l-a').abwesenheiten = [{ von: MO, bis: MO, grund: '' }];
    lk(z, 'l-c').abwesenheiten = [{ von: MO, bis: MO, grund: '' }];
    lk(z, 'l-d').abwesenheiten = [{ von: MO, bis: MO, grund: '' }];
    const v = Vertretung.loese(z, { art: 'lehrkraft', datum: MO, klasse: 'k-1a', stunde: 3, lehrkraft: 'l-b' });
    assert.equal(v.stufe, 7);
    assert.match(v.text, /früherer Unterrichtsschluss/);
    assert.equal(v.eintraege[0].status, 'entfaellt');
  });
});

describe('weitere Fälle', () => {
  test('abwesende Zweitbesetzung: nur die Zweitbesetzung entfällt', () => {
    const z = miniSchule();
    z.plan.regelplan[0].lehrkraefte = ['l-a', 'l-d'];
    abwesend(z, 'l-d');
    const [v] = Vertretung.vorschlaege(z, MO, MO);
    assert.equal(v.stufe, 0);
    assert.deepEqual(v.eintraege[0].lehrkraefte, ['l-a']);
    assert.equal(v.eintraege[0].status, 'regulaer');
  });
  test('Raumausfall: Ersatzraum gleicher Art mit genug Plätzen', () => {
    const z = miniSchule();
    raum(z, 'r-a').abwesenheiten = [{ von: MO, bis: MO, grund: 'Wasserschaden' }];
    const v = Vertretung.vorschlaege(z, MO, MO);
    assert.deepEqual(v.map((x) => [x.klasse, x.stunde, x.art, x.stufe, x.eintraege[0].raum]), [['k-1a', 1, 'raum', 1, 'r-b'], ['k-1a', 2, 'raum', 1, 'r-b']]);
  });
  test('Abnahme 13: Aufsichtsvertretung datumsgenau; andere Tage und Regelplan unverändert', () => {
    const z = miniSchule();
    abwesend(z, 'l-a');
    const regelVorher = JSON.stringify([z.plan.regelplan, z.plan.aufsichten]);
    const alle = Vertretung.vorschlaege(z, MO, DI);
    const a = alle.find((x) => x.art === 'aufsicht');
    assert.equal(a.datum, MO);
    assert.equal(a.aufsichtsEintraege[0].fuer, 'l-a');
    assert.equal(a.aufsichtsEintraege[0].status, 'vertreten');
    assert.ok(!alle.some((x) => x.datum === DI), 'Dienstag nicht betroffen');
    for (const x of alle) Vertretung.uebernehmen(z, x);
    assert.equal(JSON.stringify([z.plan.regelplan, z.plan.aufsichten]), regelVorher);
    const tpMo = Vertretung.tagesplan(z, MO);
    assert.ok(!tpMo.aufsichten.some((x) => x.lehrkraft === 'l-a'));
    assert.ok(tpMo.aufsichten.some((x) => x.lehrkraft === a.aufsichtsEintraege[0].lehrkraft && x.vorStunde === 1));
    assert.ok(Vertretung.tagesplan(z, DI).aufsichten.some((x) => x.lehrkraft === 'l-a'), 'Di bleibt A');
    assert.deepEqual(Vertretung.tagesplan(z, '2026-11-23').aufsichten, Vertretung.tagesplan(miniSchule(), '2026-11-23').aufsichten);
  });
  test('Aufsicht bleibt unbesetzt, wenn niemand anwesend und frei ist', () => {
    const z = miniSchule();
    for (const id of ['l-a', 'l-b', 'l-c', 'l-d']) abwesend(z, id);
    const v = Vertretung.vorschlaege(z, MO, MO).filter((x) => x.art === 'aufsicht');
    assert.ok(v.length >= 1);
    assert.ok(v.every((x) => x.aufsichtsEintraege[0].status === 'unbesetzt'));
  });
  test('verworfene Vorschläge werden übersprungen', () => {
    const z = miniSchule();
    abwesend(z, 'l-a');
    const alle = Vertretung.vorschlaege(z, MO, MO);
    const ohne = Vertretung.vorschlaege(z, MO, MO, { ausgeschlossen: new Set([alle[0].schluessel]) });
    assert.equal(ohne.length, alle.length - 1);
  });
  test('Datensatz: mehrtägige Abwesenheit, alle Vorschläge zusammen ohne neue Verstöße', { timeout: 60000 }, () => {
    for (const name of ['ueberhang', 'gross']) {
      const z = datensatz(name);
      const r = Planer.plane(z);
      z.plan.regelplan = r.plan.regelplan;
      z.plan.aufsichten = r.plan.aufsichten;
      z.lehrkraefte[1].abwesenheiten = [{ von: MO, bis: '2026-11-18', grund: 'krank' }];
      const t0 = Date.now();
      const alle = Vertretung.vorschlaege(z, MO, '2026-11-20');
      assert.ok(Date.now() - t0 < 15000, `${name}: ${Date.now() - t0} ms`);
      assert.ok(alle.length > 0);
      for (const x of alle) Vertretung.uebernehmen(z, x);
      for (const d of [MO, DI, '2026-11-18']) assert.deepEqual(Regeln.pruefeHart(z, Vertretung.tagesplan(z, d), { datum: d }), [], `${name} ${d}`);
      assert.deepEqual(Vertretung.betroffen(z, MO), []);
    }
  });
});

describe('Zwei-Schritt-Ersatz und Mehrarbeit', () => {
  /** B wäre mit einer weiteren Stunde über dem Soll; Di 3 ist B Zweitbesetzung in 1b. */
  const schule = (mitDoppel = true) => {
    const z = miniSchule();
    abwesend(z, 'l-a');
    if (mitDoppel) z.plan.regelplan[7].lehrkraefte = ['l-a', 'l-b'];
    lk(z, 'l-b').sollStunden = mitDoppel ? 3 : 2;
    return z;
  };

  test('Lehrkraft mit Freistunde vertritt und wird aus einer doppelt besetzten Stunde herausgenommen', () => {
    const z = schule();
    const v = loese1aMo2(z);
    assert.equal(v.stufe, 3);
    assert.ok(v.zweiSchritt);
    assert.equal(v.stufeText, 'Vertretung durch Lehrkraft der Klasse (Zwei-Schritt-Ersatz)');
    assert.match(v.text, /^B vertritt und wird dafür am Di 2026-11-17 in der 3\. Stunde \(1b DE, A unterrichtet allein\) entlastet – ohne Mehrarbeit$/);
    assert.deepEqual(v.eintraege, [
      { datum: MO, klasse: 'k-1a', fach: 'f-ma', stunde: 2, status: 'vertreten', lehrkraefte: ['l-b'], raum: 'r-a', grund: 'vertretungEigeneLehrkraft' },
      { datum: DI, klasse: 'k-1b', fach: 'f-de', stunde: 3, status: 'regulaer', lehrkraefte: ['l-a'], raum: 'r-b', grund: 'entlastung' },
    ]);
    // Wochenstunden von B bleiben gleich, keine neuen Verstöße (übrig: nur noch offene Einträge der abwesenden A)
    assert.ok(nachher(z, v).every((x) => /A ist am 2026-11-16 abwesend/.test(x.text)));
    assert.deepEqual(Regeln.pruefeHart(z, Vertretung.tagesplan(z, DI), { datum: DI }), []);
    const stundenB = [MO, DI].flatMap((d) => Vertretung.tagesplan(z, d).stunden).filter((s) => s.status !== 'entfaellt' && s.lehrkraefte.includes('l-b')).length;
    assert.equal(stundenB, 3);
    // Die direkte Vertretung mit Mehrarbeit bleibt als Alternative sichtbar
    assert.ok(v.alternativen.some((a) => a.mehrarbeit && /B vertritt .*Mehrarbeit: 4 statt 3 Soll-Stunden/.test(a.text)));
  });

  test('ohne Entlastungsmöglichkeit hat eine Vertretung ohne Mehrarbeit Vorrang vor der eigenen Lehrkraft mit Mehrarbeit', () => {
    const z = schule(false);
    const v = loese1aMo2(z);
    assert.equal(v.stufe, 4);
    assert.ok(!v.mehrarbeit);
    assert.ok(!/^B /.test(v.text));
    const b = v.alternativen.find((a) => /^B vertritt/.test(a.text));
    assert.ok(b && b.stufe === 3 && b.mehrarbeit, 'B mit Mehrarbeit als Alternative');
  });

  test('keine rückwirkende Entlastung: nur am Vertretungstag oder später in der Woche', () => {
    const z = schule();
    // Vertretung am Dienstag (1a Di 2 DE bei A); B ist nur Mo 1 in 1b doppelt besetzt
    z.plan.regelplan[7].lehrkraefte = ['l-a'];
    z.plan.regelplan[5].lehrkraefte = ['l-b', 'l-c'];
    lk(z, 'l-a').abwesenheiten = [{ von: DI, bis: DI, grund: 'krank' }];
    lk(z, 'l-b').qualifikationen.push({ fach: 'f-de', stufenVon: 1, stufenBis: 4 });
    const v = Vertretung.loese(z, { art: 'lehrkraft', datum: DI, klasse: 'k-1a', stunde: 2, lehrkraft: 'l-a' });
    assert.ok([v, ...v.alternativen].every((c) => !c.zweiSchritt));
  });

  test('Hauptlehrkraft wird entlastet: die Zweitbesetzung übernimmt die Stunde', () => {
    const z = schule();
    z.plan.regelplan[7].lehrkraefte = ['l-b', 'l-a'];
    lk(z, 'l-b').qualifikationen.push({ fach: 'f-de', stufenVon: 1, stufenBis: 4 });
    const v = loese1aMo2(z);
    assert.ok(v.zweiSchritt);
    assert.match(v.text, /1b DE, A übernimmt/);
    assert.deepEqual(v.eintraege[1], { datum: DI, klasse: 'k-1b', fach: 'f-de', stunde: 3, status: 'vertreten', lehrkraefte: ['l-a'], raum: 'r-b', grund: 'entlastung' });
    Vertretung.uebernehmen(z, v);
    assert.deepEqual(Regeln.pruefeHart(z, Vertretung.tagesplan(z, DI), { datum: DI }), []);
  });
});
