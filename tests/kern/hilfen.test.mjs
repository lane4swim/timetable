import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ladeKern } from '../hilfe/lade-kern.mjs';

const { Hilfen } = ladeKern();

test('Zufall: gleicher Startwert ergibt gleiche Folge', () => {
  const a = Hilfen.erzeugeZufall(42);
  const b = Hilfen.erzeugeZufall(42);
  const folgeA = Array.from({ length: 100 }, () => a.naechste());
  const folgeB = Array.from({ length: 100 }, () => b.naechste());
  assert.deepEqual(folgeA, folgeB);
});

test('Zufall: Referenzwerte bleiben stabil (Reproduzierbarkeit über Versionen)', () => {
  const z = Hilfen.erzeugeZufall(42);
  const werte = Array.from({ length: 3 }, () => z.naechste().toFixed(10));
  // Bei absichtlicher Änderung des Generators müssen gespeicherte Startwerte neu bewertet werden.
  assert.deepEqual(werte, ['0.6011037519', '0.4482905590', '0.8524657935']);
});

test('Zufall: verschiedene Startwerte ergeben verschiedene Folgen', () => {
  assert.notEqual(Hilfen.erzeugeZufall(1).naechste(), Hilfen.erzeugeZufall(2).naechste());
});

test('Zufall: Werte in [0,1), ganzzahl im Bereich, grob gleichverteilt', () => {
  const z = Hilfen.erzeugeZufall(7);
  const zaehler = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 60000; i++) {
    const x = z.naechste();
    assert.ok(x >= 0 && x < 1);
    const g = z.ganzzahl(1, 6);
    assert.ok(Number.isInteger(g) && g >= 1 && g <= 6);
    zaehler[g - 1]++;
  }
  for (const n of zaehler) assert.ok(Math.abs(n - 10000) < 500, `Häufigkeit ${n} weicht zu stark ab`);
});

test('Zufall: gemischt ist eine Permutation und verändert das Original nicht', () => {
  const z = Hilfen.erzeugeZufall(3);
  const original = [1, 2, 3, 4, 5, 6, 7, 8];
  const m = z.gemischt(original);
  assert.deepEqual(original, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...m].sort((a, b) => a - b), original);
});

test('neueId: lesbarer Stamm, bei Kollision Zähler, Umlaute ersetzt', () => {
  assert.equal(Hilfen.neueId('l', [], 'MÜ'), 'l-mue');
  assert.equal(Hilfen.neueId('l', ['l-mue'], 'MÜ'), 'l-mue1');
  assert.equal(Hilfen.neueId('l', ['l-mue', 'l-mue1'], 'MÜ'), 'l-mue2');
  assert.equal(Hilfen.neueId('k', new Set()), 'k-x1');
  assert.equal(Hilfen.neueId('r', [], 'Raum 1.01'), 'r-raum101');
});

test('tiefeKopie: unabhängige Kopie', () => {
  const a = { x: [1, { y: 2 }] };
  const b = Hilfen.tiefeKopie(a);
  b.x[1].y = 3;
  assert.equal(a.x[1].y, 2);
});

test('Datum: Prüfung, Wochentag, Verschieben', () => {
  assert.ok(Hilfen.istIsoDatum('2026-11-16'));
  assert.ok(!Hilfen.istIsoDatum('2026-02-30'));
  assert.ok(!Hilfen.istIsoDatum('16.11.2026'));
  assert.equal(Hilfen.wochentag('2026-11-16'), 'Mo');
  assert.equal(Hilfen.wochentag('2026-11-22'), 'So');
  assert.equal(Hilfen.wochentag('2027-02-28'), 'So');
  assert.equal(Hilfen.plusTage('2026-12-31', 1), '2027-01-01');
  assert.equal(Hilfen.plusTage('2026-03-29', 1), '2026-03-30'); // Zeitumstellung ohne Fehler
  assert.equal(Hilfen.wochenbeginn('2026-11-19'), '2026-11-16');
  assert.equal(Hilfen.wochenbeginn('2026-11-22'), '2026-11-16');
  assert.throws(() => Hilfen.wochentag('kein Datum'));
});

test('Datum: Unterrichtstage eines Zeitraums ohne Wochenende (datumsgenaue Vertretung)', () => {
  const tage = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
  assert.deepEqual(Hilfen.unterrichtstage('2026-11-20', '2026-11-24', tage),
    ['2026-11-20', '2026-11-23', '2026-11-24']);
  assert.deepEqual(Hilfen.unterrichtstage('2026-11-21', '2026-11-22', tage), []);
  assert.deepEqual(Hilfen.unterrichtstage('2026-11-18', '2026-11-18', tage), ['2026-11-18']);
});

test('Exportdateiname nach §8', () => {
  const d = new Date(2026, 10, 5, 23, 30);
  assert.equal(Hilfen.exportDateiname(d), 'stundenplan-2026-11-05.json');
  assert.equal(Hilfen.exportDateiname(d, 'stammdaten'), 'stundenplan-stammdaten-2026-11-05.json');
});
