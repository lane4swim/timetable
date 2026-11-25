import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ladeKern } from '../hilfe/lade-kern.mjs';
import { miniSchule } from '../hilfe/mini.mjs';

const { Verweise } = ladeKern();

test('alle Verweise auf eine Lehrkraft, lesbar beschrieben', () => {
  const v = Verweise.finde(miniSchule(), 'lehrkraefte', 'l-b');
  const pfade = v.map((x) => x.pfad);
  assert.ok(pfade.includes('klassen[1].klassenlehrkraft'));
  assert.ok(pfade.includes('zuordnungen[2].lehrkraft'));
  assert.ok(pfade.includes('plan.regelplan[2].lehrkraefte[0]'));
  assert.ok(pfade.includes('plan.aufsichten[1].lehrkraft'));
  assert.ok(v.some((x) => x.text === 'Klasse 1b: klassenlehrkraft'));
  assert.ok(v.some((x) => x.text === 'Zuordnung 1a SP (haupt): lehrkraft'));
  assert.ok(v.some((x) => x.text === 'Regelplan 1a Mo 3. Stunde: lehrkraefte'));
  assert.ok(v.some((x) => x.text === 'Pausenaufsicht Mo vor der 3. Stunde: lehrkraft'));
});

test('Räume: Nachbarschaft anderer Räume zählt, eigene nicht', () => {
  const z = miniSchule();
  const v = Verweise.finde(z, 'raeume', 'r-a').map((x) => x.pfad);
  assert.ok(v.includes('raeume[1].nahe[0]'));
  assert.ok(v.includes('klassen[0].heimatraum'));
  assert.ok(!v.some((p) => p.startsWith('raeume[0].')));
});

test('unbenutzte Entität hat keine Verweise', () => {
  const z = miniSchule();
  assert.deepEqual(Verweise.finde(z, 'raeume', 'r-klein'), []);
  assert.deepEqual(Verweise.finde(z, 'faecher', 'f-xy'), []);
});
