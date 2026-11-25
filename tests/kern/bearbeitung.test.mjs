import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ladeKern } from '../hilfe/lade-kern.mjs';
import { miniSchule } from '../hilfe/mini.mjs';

const { Bearbeitung, Regeln } = ladeKern();

test('Stunde in freien Slot verschieben', () => {
  const z = miniSchule();
  const r = Bearbeitung.verschiebeStunde(z, 4, 'Di', 3); // 1a DE Di2 → Di3
  assert.equal(r.text, '1a DE Di 2. → Di 3.');
  assert.deepEqual([z.plan.regelplan[4].tag, z.plan.regelplan[4].stunde], ['Di', 3]);
});

test('Stunde auf belegten Slot der Klasse: Tausch, H12 bleibt gewahrt', () => {
  const z = miniSchule();
  const r = Bearbeitung.verschiebeStunde(z, 0, 'Mo', 3); // 1a MA Mo1 ↔ SP Mo3
  assert.match(r.text, /getauscht mit SP/);
  assert.deepEqual([z.plan.regelplan[0].stunde, z.plan.regelplan[2].stunde], [3, 1]);
  assert.ok(!Regeln.zaehle(Regeln.pruefeHart(z)).H12);
});

test('Verschieben kann Verstöße erzeugen – sie werden gemeldet, nicht verhindert', () => {
  const z = miniSchule();
  Bearbeitung.verschiebeStunde(z, 6, 'Mo', 4); // 1b MU Mo2 → Mo4: Lücke Mo3
  assert.ok(Regeln.zaehle(Regeln.pruefeHart(z)).H12);
});

test('ungültige Ziele werden abgewiesen', () => {
  const z = miniSchule();
  assert.ok(Bearbeitung.verschiebeStunde(z, 0, 'Sa', 1).fehler);
  assert.ok(Bearbeitung.verschiebeStunde(z, 0, 'Mo', 9).fehler);
  assert.ok(Bearbeitung.verschiebeStunde(z, 0, 'Mo', 1).fehler);
  assert.ok(Bearbeitung.verschiebeStunde(z, 99, 'Mo', 1).fehler);
});

test('Zweitbesetzung setzen, ersetzen, entfernen', () => {
  const z = miniSchule();
  assert.match(Bearbeitung.setzeZweit(z, 0, 'l-d').text, /D als Zweitbesetzung in 1a Mo 1\./);
  assert.deepEqual(z.plan.regelplan[0].lehrkraefte, ['l-a', 'l-d']);
  Bearbeitung.setzeZweit(z, 0, 'l-c');
  assert.deepEqual(z.plan.regelplan[0].lehrkraefte, ['l-a', 'l-c']);
  assert.ok(Bearbeitung.setzeZweit(z, 0, 'l-a').fehler, 'Hauptlehrkraft nicht zugleich Zweit');
  assert.match(Bearbeitung.setzeZweit(z, 0, null).text, /entfernt/);
  assert.deepEqual(z.plan.regelplan[0].lehrkraefte, ['l-a']);
  z.einstellungen.maxLehrkraefteProKlasseUndSlot = 1;
  assert.ok(Bearbeitung.setzeZweit(z, 0, 'l-d').fehler);
});

test('Aufsichten verschieben, hinzufügen, entfernen', () => {
  const z = miniSchule();
  assert.match(Bearbeitung.verschiebeAufsicht(z, 1, 'Di', 3).text, /B Mo vor 3\. → Di vor 3\./);
  assert.ok(Bearbeitung.verschiebeAufsicht(z, 0, 'Di', 1).fehler, 'A hat Di vor 1 schon');
  assert.match(Bearbeitung.neueAufsicht(z, 'Mo', 3, 'l-a').text, /eingeteilt/);
  assert.ok(Bearbeitung.neueAufsicht(z, 'Mo', 3, 'l-a').fehler);
  assert.equal(z.plan.aufsichten.length, 4);
  Bearbeitung.entferneAufsicht(z, 3);
  assert.equal(z.plan.aufsichten.length, 3);
});

test('freie Kontingente und offenes Aufsichtssoll', () => {
  const z = miniSchule();
  const frei = Object.fromEntries(Bearbeitung.freieKontingente(z).map((x) => [x.lehrkraft, x.frei]));
  assert.deepEqual(frei, { 'l-b': 3, 'l-c': 2, 'l-d': 9 });
  assert.deepEqual(Bearbeitung.offeneAufsichten(z), [{ lehrkraft: 'l-d', offen: 2 }]);
});
