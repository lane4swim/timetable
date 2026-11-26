import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ladeKern } from '../hilfe/lade-kern.mjs';

const { Modell } = ladeKern();

test('Standardpausen: vor der 1. und dann vor jeder zweiten Stunde', () => {
  assert.deepEqual(Modell.standardPausen(10, 2).map((p) => p.vorStunde), [1, 3, 5, 7, 9]);
  assert.deepEqual(Modell.standardPausen(6, 2).map((p) => p.vorStunde), [1, 3, 5]);
  assert.deepEqual(Modell.standardPausen(1, 2).map((p) => p.vorStunde), [1]);
  assert.equal(Modell.standardPausen(6)[0].name, 'Frühaufsicht');
});

test('Standardpausen: Anzahl der Aufsichten je Pause einstellbar', () => {
  assert.deepEqual(Modell.standardPausen(8, [2, 4, 3]).map((p) => p.aufsichten), [2, 4, 3, 3]);
  assert.deepEqual(Modell.standardPausen(6, 0).map((p) => p.aufsichten), [0, 0, 0]);
});

test('Standard-Zeitraster: Zeiten, Doppelstundenstarts, Pausen', () => {
  const r = Modell.standardZeitraster(6);
  assert.deepEqual(r.tage, ['Mo', 'Di', 'Mi', 'Do', 'Fr']);
  assert.equal(r.stunden.length, 6);
  assert.deepEqual(r.stunden[0], { nr: 1, von: '08:00', bis: '08:45' });
  assert.equal(r.stunden[2].von, '09:55'); // 20 Minuten Pause vor der 3. Stunde
  assert.deepEqual(r.doppelstundenStart, [1, 3, 5]);
  assert.deepEqual(r.pausen.map((p) => p.vorStunde), [1, 3, 5]);
});

test('Leerer Zustand: Schemaversion, Bereiche, Einstellungen', () => {
  const z = Modell.leererZustand();
  assert.equal(z.schemaVersion, 1);
  for (const k of ['faecher', 'lehrkraefte', 'raeume', 'klassen', 'zuordnungen']) assert.deepEqual(z[k], []);
  assert.deepEqual(Object.keys(z.plan), ['regelplan', 'aufsichten', 'vertretungen', 'aufsichtsVertretungen']);
  assert.deepEqual(Object.keys(z.einstellungen.gewichte), ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12', 'W13']);
  assert.equal(z.einstellungen.vertretungsreserveProzent, 10);
  assert.equal(z.einstellungen.maxLehrkraefteProKlasseUndSlot, 2);
  // Zwei Aufrufe liefern unabhängige Objekte
  z.einstellungen.gewichte.W1 = 99;
  assert.equal(Modell.leererZustand().einstellungen.gewichte.W1, 10);
});

test('Vertretungsreserve wird aufgerundet', () => {
  assert.equal(Modell.vertretungsreserve(24, 10), 3);
  assert.equal(Modell.vertretungsreserve(20, 10), 2);
  assert.equal(Modell.vertretungsreserve(0, 10), 0);
  assert.equal(Modell.vertretungsreserve(28, 0), 0);
});
