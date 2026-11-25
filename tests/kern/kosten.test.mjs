/* Kostenvektor (K1, K1A, K2–K6) und weiche Regeln W1–W12 am von Hand
 * nachgerechneten Miniplan (Herleitung in den Kommentaren). */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ladeKern } from '../hilfe/lade-kern.mjs';
import { miniSchule, st } from '../hilfe/mini.mjs';
import { datensatz } from '../hilfe/beispiele.mjs';

const { Kosten } = ladeKern();
const bewerte = (z, plan, o) => Kosten.bewerte(z, plan, o);
const anzahl = (b) => Object.fromEntries(Kosten.WEICH.map((w) => [w, b.weich[w].anzahl]));

describe('gültiger Miniplan – von Hand nachgerechnet', () => {
  const b = bewerte(miniSchule());

  test('Kostenvektor', () => {
    // K1 0: alle Stunden der Stundentafeln liegen im Plan
    // K1A 1: Di vor der 3. Stunde ist unbesetzt (1b hat Di 3)
    // K5 12: B 3 (Lücke 5−2=3, möglich Mo2, Di1–3), C 2 (Lücke 3−1), D 7 (Lücke 9, möglich 7 Slots)
    // K6 90: siehe weiche Regeln
    assert.deepEqual(b.vektor, [0, 1, 0, 0, 0, 12, 90]);
  });

  test('weiche Regeln', () => {
    assert.deepEqual(anzahl(b), {
      W1: 4, // 1b beginnt Di erst zur 3. (2) und endet nach der 4. statt der 2. (2)
      W2: 1, // B hat Mo eine Leerstunde (1 und 3)
      W3: 0, // MA 1a als Doppelstunde Mo 1–2
      W4: 1, // Sport 1a Mo 3 direkt nach der Pause
      W5: 0,
      W6: 2, // 1a Mo: A → Halle; 1b Mo: Halle → Musik
      W7: 5, // A 2/4 (2), B 2/0 (2), C 1/0 (1)
      W8: 3, // B 2 < 4 (2), C 1 < 2 (1)
      W9: 0,
      W10: 0,
      W11: 2, // D 0 von 2 Aufsichten
      W12: 0,
    });
    assert.equal(b.weich.W1.beitrag, 40);
    assert.equal(b.weich.W8.gewicht, 6);
  });

  test('Posten erklären jeden Kostenanteil', () => {
    assert.deepEqual(b.ziele.K1A.posten.map((p) => p.text), ['Di 1. Pause (vor der 3. Stunde): 1 von 1 Aufsichten unbesetzt']);
    const k5 = b.ziele.K5.posten.map((p) => [p.text.slice(0, 2), p.menge]);
    assert.deepEqual(k5, [['B:', 3], ['C:', 2], ['D:', 7]]);
    assert.ok(b.weich.W4.posten[0].text.includes('SP direkt nach der Pause'));
    for (const k of Kosten.ZIELE) assert.equal(typeof b.ziele[k].titel, 'string');
  });

  test('Bewertung ändert den Zustand nicht', () => {
    const z = miniSchule();
    const vorher = JSON.stringify(z);
    bewerte(z);
    assert.equal(JSON.stringify(z), vorher);
  });
});

describe('Ziele K1–K5', () => {
  test('K1: fehlende und entfallene Stunden', () => {
    const z = miniSchule();
    z.plan.regelplan.splice(2, 1); // 1a Sport fehlt
    z.plan.regelplan[0] = st('k-1a', 'f-ma', [], null, 'Mo', 1, 'entfaellt');
    const b = bewerte(z);
    assert.equal(b.vektor[0], 2);
    assert.deepEqual(b.ziele.K1.posten.map((p) => p.text), ['1a MA: 1 von 2 Stunden fallen aus', '1a SP: 1 von 1 Stunden fallen aus']);
  });
  test('K1: Aufsicht statt Unterricht zählt als Ausfall, Doppelbetreuung und Aufteilung nicht', () => {
    const z = miniSchule();
    z.plan.regelplan[6] = st('k-1b', 'f-mu', ['l-d'], 'r-b', 'Mo', 2, 'aufsicht');
    assert.equal(bewerte(z).vektor[0], 1);
    z.plan.regelplan[6] = st('k-1b', 'f-mu', ['l-a'], 'r-b', 'Mo', 2, 'doppeltBetreut', { mitKlasse: 'k-1a' });
    assert.equal(bewerte(z).vektor[0], 0);
  });
  test('K1A: Bedarf nur, wenn nach der Pause Unterricht ist', () => {
    const z = miniSchule();
    z.plan.regelplan = z.plan.regelplan.filter((s) => s.tag !== 'Di' || s.stunde < 3);
    // 1b hat Di keinen Unterricht mehr ab der 3. Stunde → kein Bedarf Di vor 3
    assert.equal(bewerte(z).vektor[1], 0);
    z.plan.aufsichten = [];
    assert.equal(bewerte(z).vektor[1], 3);
  });
  test('K2 mit Art der Vertretung, K3 fachfremd', () => {
    const z = miniSchule();
    z.plan.regelplan[7] = st('k-1b', 'f-de', ['l-d'], 'r-b', 'Di', 3, 'vertreten');
    let b = bewerte(z);
    assert.deepEqual([b.vektor[2], b.vektor[3]], [1, 0]);
    assert.match(b.ziele.K2.posten[0].text, /D \(qualifizierte Lehrkraft\) statt A/);
    z.plan.regelplan[7] = st('k-1b', 'f-de', ['l-b'], 'r-b', 'Di', 3, 'vertreten');
    b = bewerte(z);
    assert.deepEqual([b.vektor[2], b.vektor[3]], [1, 1]);
    assert.match(b.ziele.K2.posten[0].text, /B \(Klassenlehrkraft\)/);
    z.plan.regelplan[7] = st('k-1b', 'f-de', ['l-c'], 'r-b', 'Di', 3, 'vertreten');
    assert.match(bewerte(z).ziele.K2.posten[0].text, /C \(Lehrkraft der Klasse\)/);
  });
  test('K2: festgelegte Zweitlehrkraft zählt als eigene Lehrkraft', () => {
    const z = miniSchule();
    z.zuordnungen.push({ klasse: 'k-1b', fach: 'f-de', lehrkraft: 'l-d', rolle: 'zweit' });
    z.plan.regelplan[7] = st('k-1b', 'f-de', ['l-d'], 'r-b', 'Di', 3, 'vertreten');
    assert.equal(bewerte(z).vektor[2], 0);
  });
  test('K4: Aufteilung wiegt schwerer als Doppelbetreuung', () => {
    const z = miniSchule();
    z.plan.regelplan[6] = st('k-1b', 'f-mu', ['l-a'], 'r-b', 'Mo', 2, 'doppeltBetreut', { mitKlasse: 'k-1a' });
    assert.equal(bewerte(z).vektor[4], 1);
    z.plan.regelplan[6] = st('k-1b', 'f-mu', [], null, 'Mo', 2, 'aufgeteilt', { verteilung: [{ zielKlasse: 'k-1a', anzahl: 8 }] });
    assert.equal(bewerte(z).vektor[4], 3);
  });
  test('K5: Zweitbesetzung senkt K5; entfällt, wenn Zweitbesetzung abgeschaltet', () => {
    const z = miniSchule();
    z.plan.regelplan[0].lehrkraefte = ['l-a', 'l-d'];
    assert.equal(bewerte(z).vektor[5], 11); // D: Lücke 8, möglich 6 → 6; B 3, C 2
    z.einstellungen.zweitbesetzungErlaubt = false;
    assert.equal(bewerte(z).vektor[5], 0);
  });
});

describe('weiche Regeln im Einzelnen', () => {
  test('W3: Doppelstunde nur ab erlaubtem Beginn', () => {
    const z = miniSchule();
    z.zeitraster.doppelstundenStart = [3];
    assert.equal(bewerte(z).weich.W3.anzahl, 1);
  });
  test('W4: Hauptfach am Nachmittag', () => {
    const z = miniSchule();
    z.zeitraster.stunden[3] = { nr: 4, von: '12:15', bis: '13:00' };
    assert.equal(bewerte(z).weich.W4.anzahl, 2); // Sport nach der Pause + DE 1b Di 4
  });
  test('W5: zwei Einzelstunden eines Fachs am selben Tag; nicht blockbares Fach', () => {
    const z = miniSchule();
    z.plan.regelplan[4].stunde = 3; // 1a DE Di 1 und 3 (Mo bleibt gültig, Di nun mit Lücke – egal für W5)
    assert.equal(bewerte(z).weich.W5.anzahl, 1);
    const y = miniSchule();
    y.faecher[1].blockbar = false; // MA nicht blockbar → Mo 1–2 ist ein zu langer Block
    assert.equal(bewerte(y).weich.W5.anzahl, 1);
  });
  test('W6: Klasse außerhalb des Heimatraums ohne Notwendigkeit', () => {
    const z = miniSchule();
    z.plan.regelplan[3].raum = 'r-b';
    z.plan.regelplan[4].raum = 'r-b';
    assert.equal(bewerte(z).weich.W6.anzahl, 4);
  });
  test('W9, W10: Zweitbesetzung – Priorität und Beständigkeit', () => {
    const z = miniSchule();
    z.plan.regelplan[0].lehrkraefte = ['l-a', 'l-d'];
    z.plan.regelplan[1].lehrkraefte = ['l-a', 'l-c'];
    const b = bewerte(z);
    // 1a: Schülerzahl kleinste (0), Stufe gleich (neutral 0,5), MA hat 2 Qualifizierte (0,5) → Priorität 1/3
    assert.equal(b.weich.W9.anzahl, 1.34);
    assert.equal(b.weich.W10.anzahl, 1);
  });
  test('W12: Aufsicht ohne angrenzenden Unterricht und Häufung', () => {
    const z = miniSchule();
    z.plan.aufsichten.push({ tag: 'Mo', vorStunde: 1, lehrkraft: 'l-c' }); // C hat Mo erst die 2. Stunde
    z.plan.aufsichten.push({ tag: 'Mo', vorStunde: 3, lehrkraft: 'l-a' }); // A zweimal am Mo
    assert.equal(bewerte(z).weich.W12.anzahl, 2);
  });
  test('Gewichte aus den Einstellungen', () => {
    const z = miniSchule();
    z.einstellungen.gewichte.W1 = 0;
    assert.equal(bewerte(z).vektor[6], 50);
  });
});

describe('Vergleich und Tagesplan', () => {
  test('lexikografischer Vergleich', () => {
    assert.ok(Kosten.vergleiche([0, 9, 9, 9, 9, 9, 999], [1, 0, 0, 0, 0, 0, 0]) < 0);
    assert.ok(Kosten.vergleiche([0, 0, 1, 0, 0, 0, 0], [0, 0, 0, 5, 5, 5, 5]) > 0);
    assert.equal(Kosten.vergleiche([0, 1, 2], [0, 1, 2]), 0);
    assert.equal(Kosten.vergleiche([0.1 + 0.2], [0.3]), 0);
    assert.equal(Kosten.formatiere([0, 1, 0, 0, 0, 12, 90]), 'K1 0 · K1A 1 · K2 0 · K3 0 · K4 0 · K5 12 · K6 90');
  });
  test('Tagesplan: Ausfall zählt die ausdrücklich entfallenen Stunden des Tages', () => {
    const z = miniSchule();
    const dienstag = { stunden: z.plan.regelplan.filter((s) => s.tag === 'Di'), aufsichten: z.plan.aufsichten.filter((a) => a.tag === 'Di') };
    dienstag.stunden[3] = st('k-1b', 'f-de', [], null, 'Di', 4, 'entfaellt');
    const b = bewerte(z, dienstag, { datum: '2026-11-17' });
    assert.equal(b.vektor[0], 1);
    assert.equal(b.vektor[1], 1); // Di vor 3 unbesetzt
    assert.equal(b.vektor[5], 0); // Wochenziel K5 entfällt
  });
  test('leerer Plan: alles fällt aus, keine Aufsicht nötig', () => {
    const b = bewerte(datensatz('klein'));
    assert.equal(b.vektor[0], 90);
    assert.equal(b.vektor[1], 0);
  });
});
