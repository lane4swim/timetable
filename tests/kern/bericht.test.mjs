import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ladeKern } from '../hilfe/lade-kern.mjs';
import { miniSchule, st } from '../hilfe/mini.mjs';

const { Bericht, Vertretung } = ladeKern();
const MO = '2026-11-16';

test('Regelplan: Kostenvektor, Ausfall je Klasse und Fach, Auslastung', () => {
  const z = miniSchule();
  z.plan.regelplan.splice(2, 1); // 1a Sport fehlt
  z.plan.regelplan[0].lehrkraefte = ['l-a', 'l-d'];
  const b = Bericht.erstelle(z, MO, MO);
  assert.equal(b.regelplan.vektor[0], 1);
  assert.deepEqual(b.regelplan.ausfall, [{ klasse: 'k-1a', fach: 'f-sp', soll: 1, ist: 0, ausfall: 1 }]);
  const d = b.auslastung.find((x) => x.lehrkraft === 'l-d');
  assert.deepEqual([d.haupt, d.zweit, d.gesamt, d.ungenutzt], [0, 1, 1, 8]);
  const a = b.auslastung.find((x) => x.lehrkraft === 'l-a');
  assert.deepEqual([a.aufsichtenSoll, a.aufsichtenIst], [2, 2]);
  assert.equal(b.aufsichten.unbesetztRegel.length, 1);
});

test('Vertretungen im Zeitraum: Quote, Ausfall, offene Fälle, Mehraufsichten', () => {
  const z = miniSchule();
  z.lehrkraefte[0].abwesenheiten = [{ von: MO, bis: MO, grund: '' }];
  let b = Bericht.erstelle(z, MO, '2026-11-20');
  assert.equal(b.vertretung.offen, 3);
  assert.equal(b.vertretung.quote, null);
  for (const v of Vertretung.vorschlaege(z, MO, MO)) Vertretung.uebernehmen(z, v);
  z.plan.vertretungen.push({ datum: '2026-11-17', klasse: 'k-1b', fach: 'f-de', stunde: 4, status: 'entfaellt', lehrkraefte: [], raum: null, grund: 'entfallRand' });
  b = Bericht.erstelle(z, MO, '2026-11-20');
  assert.equal(b.vertretung.offen, 0);
  assert.equal(b.vertretung.faelle, 3);
  assert.equal(b.vertretung.ausfallStunden, 1);
  assert.equal(Math.round(b.vertretung.quote * 100), 67);
  assert.deepEqual(b.vertretung.ausfall, [{ klasse: 'k-1b', fach: 'f-de', anzahl: 1 }]);
  const mehr = b.auslastung.reduce((s, x) => s + x.mehrAufsichten, 0);
  assert.equal(mehr, 1);
  // außerhalb des Zeitraums zählt nichts
  assert.equal(Bericht.erstelle(z, '2026-11-23', '2026-11-27').vertretung.faelle, 0);
});
