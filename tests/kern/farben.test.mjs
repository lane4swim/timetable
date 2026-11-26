/* Farben der Plan-Ansicht: unterscheidbar und kontraststark (WCAG). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ladeKern } from '../hilfe/lade-kern.mjs';
import { miniSchule } from '../hilfe/mini.mjs';

const { Farben, Schema } = ladeKern();
const fach = Array.from({ length: 40 }, (_, i) => Farben.fachStandard(i));
const lehrer = Array.from({ length: 80 }, (_, i) => Farben.lehrkraftStandard(i));

test('Fachfarben: Text und Nebentext mindestens 4,5 : 1', () => {
  for (const f of fach) {
    assert.ok(Farben.kontrast(Farben.TEXT, f) >= 4.5, f);
    assert.ok(Farben.kontrast(Farben.NEBENTEXT, f) >= 4.5, `${f}: ${Farben.kontrast(Farben.NEBENTEXT, f).toFixed(2)}`);
  }
});

test('Lehrkraftbalken: mindestens 3 : 1 gegen Weiß und gegen jede Fachfarbe', () => {
  for (const l of lehrer) {
    assert.ok(Farben.kontrast(l, '#ffffff') >= 3, l);
    for (const f of fach) assert.ok(Farben.kontrast(l, f) >= 3, `${l} auf ${f}: ${Farben.kontrast(l, f).toFixed(2)}`);
  }
});

test('benachbarte Standardfarben unterscheiden sich deutlich', () => {
  const abstand = (a, b) => Math.hypot(...[1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)));
  for (let i = 0; i + 1 < 12; i++) assert.ok(abstand(fach[i], fach[i + 1]) > 25, `${fach[i]} ~ ${fach[i + 1]}`);
  for (let i = 0; i + 1 < 20; i++) assert.ok(abstand(lehrer[i], lehrer[i + 1]) > 40, `${lehrer[i]} ~ ${lehrer[i + 1]}`);
  assert.equal(new Set(fach.slice(0, 14)).size, 14);
});

test('eigene Farben werden übernommen und bei Bedarf lesbar gemacht', () => {
  const z = miniSchule();
  z.faecher[0].farbe = '#ffe0a0';
  z.faecher[1].farbe = '#202080'; // zu dunkel für Text → aufgehellt
  z.lehrkraefte[0].farbe = '#c00000';
  z.lehrkraefte[1].farbe = '#ffff80'; // zu hell für einen Balken → abgedunkelt
  assert.equal(Farben.fach(z, 'f-de'), '#ffe0a0');
  assert.ok(Farben.kontrast(Farben.NEBENTEXT, Farben.fach(z, 'f-ma')) >= 4.5);
  assert.equal(Farben.lehrkraft(z, 'l-a'), '#c00000');
  assert.ok(Farben.kontrast(Farben.lehrkraft(z, 'l-b'), '#ffffff') >= 3);
  assert.equal(Farben.fach(z, 'f-sp'), Farben.fachStandard(2));
});

test('Schema: Feld farbe ist optional und muss #rrggbb sein', () => {
  const z = miniSchule();
  z.faecher[0].farbe = '#12ab9F';
  assert.deepEqual(Schema.validiere(Schema.normalisiere(z)).fehler, []);
  z.lehrkraefte[0].farbe = 'rot';
  assert.equal(Schema.validiere(z).fehler[0].pfad, 'lehrkraefte[0].farbe');
});
