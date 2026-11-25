/* Harte Regeln H1–H14: der gültige Miniplan ist fehlerfrei; jede Regel wird
 * gezielt verletzt und mit Regelnummer und betroffenen Einträgen erkannt. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ladeKern } from '../hilfe/lade-kern.mjs';
import { miniSchule, st } from '../hilfe/mini.mjs';
import { datensatz } from '../hilfe/beispiele.mjs';

const { Regeln, Schema } = ladeKern();

const pruefe = (z, plan, optionen) => Regeln.pruefeHart(z, plan, optionen);
const regeln = (v) => [...new Set(v.map((x) => x.regel))];
/** Erwartet mindestens einen Verstoß gegen `regel`; liefert die Verstöße dieser Regel. */
function erwarte(v, regel, muster) {
  const treffer = v.filter((x) => x.regel === regel);
  assert.ok(treffer.length, `Verstoß gegen ${regel} erwartet; gefunden: ${v.map((x) => x.regel + ' ' + x.text).join(' | ') || '(keine)'}`);
  if (muster) assert.ok(treffer.some((x) => muster.test(x.text)), `${regel}: Text passt nicht: ${treffer.map((x) => x.text).join(' | ')}`);
  return treffer;
}

describe('gültige Pläne', () => {
  test('Miniplan ist schemagültig und verletzt keine harte Regel', () => {
    const z = miniSchule();
    assert.deepEqual(Schema.validiere(Schema.normalisiere(z)).fehler, []);
    assert.deepEqual(pruefe(z), []);
  });
  test('leere Pläne der Testdatensätze verletzen keine Regel', () => {
    for (const name of ['klein', 'unterdeckung', 'ueberhang', 'gross']) assert.deepEqual(pruefe(datensatz(name)), [], name);
  });
  test('alle Regeln haben einen Titel', () => {
    assert.deepEqual(Object.keys(Regeln.TITEL), Array.from({ length: 14 }, (_, i) => 'H' + (i + 1)));
  });
});

describe('H1 Lehrkraft je Zeitslot', () => {
  test('dieselbe Lehrkraft in zwei Klassen', () => {
    const z = miniSchule();
    z.plan.regelplan[5].lehrkraefte = ['l-a']; // 1b Mo1 statt B nun A, die zugleich 1a hat
    const [v] = erwarte(pruefe(z), 'H1', /A ist Mo 1\. Stunde in 2 Klassen/);
    assert.deepEqual(v.stunden.sort(), [0, 5]);
  });
  test('genehmigte Doppelbetreuung ist erlaubt', () => {
    const z = miniSchule();
    z.plan.regelplan[6] = st('k-1b', 'f-mu', ['l-a'], 'r-b', 'Mo', 2, 'doppeltBetreut', { mitKlasse: 'k-1a' });
    assert.deepEqual(regeln(pruefe(z)), []);
  });
  test('Doppelbetreuung ohne betreute Partnerklasse', () => {
    const z = miniSchule();
    z.plan.regelplan[7] = st('k-1b', 'f-de', ['l-a'], 'r-b', 'Di', 3, 'doppeltBetreut', { mitKlasse: 'k-1a' });
    erwarte(pruefe(z), 'H1', /wird in diesem Slot nicht von A betreut/);
  });
  test('Grenzen je Tag: Stunden am Stück und Anzahl', () => {
    const z = miniSchule();
    z.plan.regelplan[5] = st('k-1b', 'f-sp', ['l-a'], 'r-th', 'Mo', 1, 'doppeltBetreut', { mitKlasse: 'k-1a' });
    z.plan.regelplan[6] = st('k-1b', 'f-mu', ['l-a'], 'r-b', 'Mo', 2, 'doppeltBetreut', { mitKlasse: 'k-1a' });
    assert.ok(!regeln(pruefe(z)).includes('H1'), 'zwei Stunden am Stück sind erlaubt');
    z.einstellungen.maxDoppelbetreuungStundenAmStueck = 1;
    erwarte(pruefe(z), 'H1', /2 Stunden am Stück/);
    z.einstellungen.maxDoppelbetreuungStundenAmStueck = 2;
    z.einstellungen.maxDoppelbetreuungProTag = 0;
    erwarte(pruefe(z), 'H1', /1 Doppelbetreuungen \(erlaubt: 0\)/);
  });
});

describe('H2, H3 Klasse und Raum je Zeitslot', () => {
  test('zwei Veranstaltungen einer Klasse', () => {
    const z = miniSchule();
    z.plan.regelplan.push(st('k-1a', 'f-de', ['l-d'], 'r-b', 'Mo', 1));
    const [v] = erwarte(pruefe(z), 'H2', /1a hat Mo 1\. Stunde 2 Veranstaltungen/);
    assert.deepEqual(v.stunden, [0, 9]);
  });
  test('Raum doppelt belegt', () => {
    const z = miniSchule();
    z.plan.regelplan[0].raum = 'r-th'; // 1a MA in der Halle, in der 1b Sport hat
    erwarte(pruefe(z), 'H3', /Halle ist Mo 1\. Stunde 2-fach belegt/);
  });
  test('Doppelbetreuung im selben Raum ist erlaubt, Kapazität wird geprüft (H6)', () => {
    const z = miniSchule();
    z.plan.regelplan[6] = st('k-1b', 'f-mu', ['l-a'], 'r-a', 'Mo', 2, 'doppeltBetreut', { mitKlasse: 'k-1a' });
    const v = pruefe(z);
    assert.ok(!regeln(v).includes('H3'));
    erwarte(v, 'H6', /42 Schüler:innen bei Kapazität 28/);
  });
});

describe('H4 Lehrkraft gesperrt oder abwesend', () => {
  test('gesperrtes Zeitfenster (auch als Zweitbesetzung)', () => {
    const z = miniSchule();
    z.plan.regelplan[8].lehrkraefte = ['l-a', 'l-b'];
    erwarte(pruefe(z), 'H4', /B ist Di 4\. Stunde gesperrt/);
  });
  test('Abwesenheit nur im Tagesplan mit Datum', () => {
    const z = miniSchule();
    z.lehrkraefte[2].abwesenheiten = [{ von: '2026-11-16', bis: '2026-11-16', grund: '' }];
    const montag = { stunden: z.plan.regelplan.filter((s) => s.tag === 'Mo'), aufsichten: [] };
    assert.ok(!regeln(pruefe(z, montag)).includes('H4'), 'ohne Datum keine Abwesenheitsprüfung');
    erwarte(pruefe(z, montag, { datum: '2026-11-16' }), 'H4', /C ist am 2026-11-16 abwesend/);
    assert.ok(!regeln(pruefe(z, montag, { datum: '2026-11-23' })).includes('H4'));
  });
});

describe('H5 Raum gesperrt, Raumtyp', () => {
  test('Sport im Klassenraum', () => {
    const z = miniSchule();
    z.plan.regelplan[2].raum = 'r-a';
    erwarte(pruefe(z), 'H5', /SP braucht Raumtyp „turnhalle“/);
  });
  test('Deutsch im Musikraum', () => {
    const z = miniSchule();
    z.plan.regelplan[3].raum = 'r-mu';
    erwarte(pruefe(z), 'H5', /DE gehört in einen Klassenraum/);
  });
  test('gesperrter Raum und fehlender Raum', () => {
    const z = miniSchule();
    z.raeume[2].gesperrt = [{ tag: 'Mo', stunden: [3] }];
    z.plan.regelplan[4].raum = null;
    const v = pruefe(z);
    erwarte(v, 'H5', /Halle ist Mo 3\. Stunde gesperrt/);
    erwarte(v, 'H5', /kein Raum zugewiesen/);
  });
  test('Raumausfall an einem Datum', () => {
    const z = miniSchule();
    z.raeume[0].abwesenheiten = [{ von: '2026-11-17', bis: '2026-11-17', grund: 'Wasserschaden' }];
    const dienstag = { stunden: z.plan.regelplan.filter((s) => s.tag === 'Di'), aufsichten: [] };
    erwarte(pruefe(z, dienstag, { datum: '2026-11-17' }), 'H5', /Raum A steht am 2026-11-17 nicht zur Verfügung/);
  });
});

describe('H6 Kapazität', () => {
  test('Raum zu klein', () => {
    const z = miniSchule();
    z.plan.regelplan[3].raum = 'r-klein';
    erwarte(pruefe(z), 'H6', /20 Schüler:innen bei Kapazität 10/);
  });
  test('Gäste aus einer Aufteilung zählen mit', () => {
    const z = miniSchule();
    z.plan.regelplan[6] = st('k-1b', 'f-mu', [], null, 'Mo', 2, 'aufgeteilt', { verteilung: [{ zielKlasse: 'k-1a', anzahl: 8 }] });
    assert.ok(!regeln(pruefe(z)).includes('H6'), '20 + 8 = 28 passt');
    z.plan.regelplan[6].verteilung[0].anzahl = 9;
    erwarte(pruefe(z), 'H6', /29 Schüler:innen bei Kapazität 28/);
  });
  test('Zielklasse ohne Unterricht im Slot', () => {
    const z = miniSchule();
    z.plan.regelplan[7] = st('k-1b', 'f-de', [], null, 'Di', 3, 'aufgeteilt', { verteilung: [{ zielKlasse: 'k-1a', anzahl: 5 }] });
    erwarte(pruefe(z), 'H6', /Zielklasse 1a hat in diesem Slot keinen Unterricht/);
  });
});

describe('H7–H11', () => {
  test('H7 Höchstgrenze', () => {
    const z = miniSchule();
    Object.assign(z.lehrkraefte[0], { sollStunden: 5, minStunden: 4, maxStunden: 5 });
    erwarte(pruefe(z), 'H7', /A hat 6 Wochenstunden \(Höchstgrenze 5\)/);
  });
  test('H7 zählt Zweitbesetzungen mit, Doppelbetreuung je Slot einmal', () => {
    const z = miniSchule();
    Object.assign(z.lehrkraefte[2], { maxStunden: 1, sollStunden: 1, minStunden: 0 });
    z.plan.regelplan[0].lehrkraefte = ['l-a', 'l-c'];
    erwarte(pruefe(z), 'H7', /C hat 2 Wochenstunden/);
    const y = miniSchule();
    Object.assign(y.lehrkraefte[0], { sollStunden: 6, minStunden: 4, maxStunden: 6 });
    y.plan.regelplan[6] = st('k-1b', 'f-mu', ['l-a'], 'r-b', 'Mo', 2, 'doppeltBetreut', { mitKlasse: 'k-1a' });
    assert.ok(!regeln(pruefe(y)).includes('H7'), 'Doppelbetreuung Mo 2 kostet keine zusätzliche Stunde');
  });
  test('H8 reguläre Stunde nur qualifiziert; Vertretung ist erlaubt', () => {
    const z = miniSchule();
    z.plan.regelplan[6].lehrkraefte = ['l-d']; // D ist nicht für Musik qualifiziert
    erwarte(pruefe(z), 'H8', /D ist für MU in Stufe 1 nicht qualifiziert/);
    z.plan.regelplan[6].status = 'vertreten';
    assert.ok(!regeln(pruefe(z)).includes('H8'));
  });
  test('H9 Stundentafel', () => {
    const z = miniSchule();
    z.plan.regelplan.push(st('k-1a', 'f-sp', ['l-b'], 'r-th', 'Mo', 4));
    z.plan.regelplan.push(st('k-1a', 'f-mu', ['l-c'], 'r-mu', 'Di', 3));
    const v = pruefe(z);
    erwarte(v, 'H9', /1a: 2 Stunden SP, Stundentafel sieht 1 vor/);
    erwarte(v, 'H9', /MU steht nicht in der Stundentafel/);
  });
  test('H10 Lehrkräfte je Stunde', () => {
    const z = miniSchule();
    z.plan.regelplan[0].lehrkraefte = ['l-a', 'l-c', 'l-d'];
    erwarte(pruefe(z), 'H10', /3 Lehrkräfte \(erlaubt: 2\)/);
  });
  test('H11 Zweitbesetzung nur innerhalb Soll minus Reserve', () => {
    const z = miniSchule();
    Object.assign(z.lehrkraefte[1], { sollStunden: 3, minStunden: 2 }); // Reserve 1 → höchstens 2 Stunden mit Zweitbesetzung
    z.plan.regelplan[1].lehrkraefte = ['l-a', 'l-b'];
    erwarte(pruefe(z), 'H11', /B hat 3 Stunden davon 1 als Zweitbesetzung; mit Zweitbesetzung höchstens 2/);
    // Ohne Zweitbesetzung gilt nur die Höchstgrenze
    z.plan.regelplan[1].lehrkraefte = ['l-a'];
    assert.ok(!regeln(pruefe(z)).includes('H11'));
  });
});

describe('H12 keine Leerstunden für Klassen', () => {
  test('fehlende Stunde in der Tagesmitte', () => {
    const z = miniSchule();
    z.plan.regelplan.splice(1, 1); // 1a Mo2 fehlt
    erwarte(pruefe(z), 'H12', /1a hat am Mo eine Leerstunde \(2\. Stunde\)/);
  });
  test('Entfall in der Mitte ist eine Lücke, Aufsicht nicht', () => {
    const z = miniSchule();
    z.plan.regelplan[1] = st('k-1a', 'f-ma', [], null, 'Mo', 2, 'entfaellt');
    erwarte(pruefe(z), 'H12');
    z.plan.regelplan[1] = st('k-1a', 'f-ma', ['l-d'], 'r-a', 'Mo', 2, 'aufsicht');
    assert.ok(!regeln(pruefe(z)).includes('H12'));
  });
  test('Entfall am Tagesrand ist keine Lücke', () => {
    const z = miniSchule();
    z.plan.regelplan[2] = st('k-1a', 'f-sp', [], null, 'Mo', 3, 'entfaellt');
    assert.deepEqual(regeln(pruefe(z)), []);
  });
});

describe('H13, H14 Pausenaufsichten', () => {
  test('Aufsicht ohne Unterricht am Tag', () => {
    const z = miniSchule();
    z.plan.aufsichten.push({ tag: 'Di', vorStunde: 3, lehrkraft: 'l-d' });
    const [v] = erwarte(pruefe(z), 'H13', /D hat am Di keinen Unterricht/);
    assert.deepEqual(v.aufsichten, [3]);
  });
  test('angrenzende Stunde gesperrt', () => {
    const z = miniSchule();
    z.lehrkraefte[1].gesperrt.push({ tag: 'Mo', stunden: [2] });
    erwarte(pruefe(z), 'H13', /B: Aufsicht Mo 1\. Pause \(vor der 3\. Stunde\), aber 2\. Stunde gesperrt/);
  });
  test('doppelt eingeteilt und abwesend', () => {
    const z = miniSchule();
    z.plan.aufsichten.push({ tag: 'Mo', vorStunde: 1, lehrkraft: 'l-a' });
    erwarte(pruefe(z), 'H13', /mehrfach eingeteilt/);
    const y = miniSchule();
    y.lehrkraefte[0].abwesenheiten = [{ von: '2026-11-16', bis: '2026-11-16', grund: '' }];
    const montag = { stunden: y.plan.regelplan.filter((s) => s.tag === 'Mo'), aufsichten: [y.plan.aufsichten[0]] };
    erwarte(pruefe(y, montag, { datum: '2026-11-16' }), 'H13', /A ist am 2026-11-16 abwesend/);
  });
  test('H14 Aufsichtssoll im Regelplan, nicht im Tagesplan', () => {
    const z = miniSchule();
    z.plan.aufsichten.push({ tag: 'Mo', vorStunde: 1, lehrkraft: 'l-b' });
    erwarte(pruefe(z), 'H14', /B hat 2 Aufsichten \(Aufsichtssoll 1\)/);
    const montag = { stunden: z.plan.regelplan.filter((s) => s.tag === 'Mo'), aufsichten: z.plan.aufsichten.filter((a) => a.tag === 'Mo') };
    assert.ok(!regeln(pruefe(z, montag, { datum: '2026-11-16' })).includes('H14'));
  });
});

test('Verstöße sind nach Regelnummer sortiert und zählbar', () => {
  const z = miniSchule();
  z.plan.regelplan.splice(1, 1);
  z.plan.regelplan[0].lehrkraefte = ['l-a', 'l-c', 'l-d'];
  z.plan.aufsichten.push({ tag: 'Mo', vorStunde: 1, lehrkraft: 'l-b' });
  const v = pruefe(z);
  const nummern = v.map((x) => Number(x.regel.slice(1)));
  assert.deepEqual(nummern, [...nummern].sort((a, b) => a - b));
  const zahl = Regeln.zaehle(v);
  assert.equal(zahl.H10, 1);
  assert.equal(zahl.H12, 1);
  assert.equal(zahl.H14, 1);
});
