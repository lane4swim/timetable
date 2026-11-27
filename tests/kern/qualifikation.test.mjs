import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ladeKern } from '../hilfe/lade-kern.mjs';
import { miniSchule } from '../hilfe/mini.mjs';

const { Qualifikation: Q } = ladeKern();
const lk = (quali) => ({ qualifikationen: quali });
const faecher = [{ id: 'f-de', kuerzel: 'DE' }, { id: 'f-ma', kuerzel: 'MA' }, { id: 'f-en', kuerzel: 'EN' }, { id: 'f-ku', kuerzel: 'KU' }];

test('Status je Stufengruppe: ganz, teilweise, nicht', () => {
  const l = lk([{ fach: 'f-de', stufenVon: 1, stufenBis: 10 }, { fach: 'f-ku', stufenVon: 3, stufenBis: 4 }]);
  assert.deepEqual(['P', 'SI', 'SII'].map((g) => Q.status(l, 'f-de', g)), ['ja', 'ja', 'nein']);
  assert.equal(Q.status(l, 'f-ku', 'P'), 'teilweise');
  assert.equal(Q.teilText(l, 'f-ku', 'P'), '3–4');
  assert.equal(Q.status(l, 'f-ma', 'P'), 'nein');
});

test('Gruppe setzen und entfernen: Bereiche werden zusammengefasst, andere Fächer bleiben', () => {
  const l = lk([{ fach: 'f-ma', stufenVon: 1, stufenBis: 4 }, { fach: 'f-de', stufenVon: 1, stufenBis: 4 }, { fach: 'f-en', stufenVon: 5, stufenBis: 10 }]);
  Q.setze(l, 'f-de', 'SI', true);
  assert.deepEqual(l.qualifikationen, [{ fach: 'f-ma', stufenVon: 1, stufenBis: 4 }, { fach: 'f-de', stufenVon: 1, stufenBis: 10 }, { fach: 'f-en', stufenVon: 5, stufenBis: 10 }]);
  Q.setze(l, 'f-de', 'P', false);
  assert.deepEqual(l.qualifikationen[1], { fach: 'f-de', stufenVon: 5, stufenBis: 10 });
  Q.setze(l, 'f-de', 'SI', false);
  assert.deepEqual(l.qualifikationen.map((q) => q.fach), ['f-ma', 'f-en'], 'Fach ohne Gruppe verschwindet');
  Q.setze(l, 'f-ku', 'SII', true);
  assert.deepEqual(l.qualifikationen.at(-1), { fach: 'f-ku', stufenVon: 11, stufenBis: 13 });
  Q.setze(l, 'f-en', 'SII', true);
  assert.deepEqual(l.qualifikationen.find((q) => q.fach === 'f-en'), { fach: 'f-en', stufenVon: 5, stufenBis: 13 });
});

test('teilweise Gruppe wird durch Setzen vervollständigt', () => {
  const l = lk([{ fach: 'f-ku', stufenVon: 3, stufenBis: 4 }]);
  Q.setze(l, 'f-ku', 'P', true);
  assert.deepEqual(l.qualifikationen, [{ fach: 'f-ku', stufenVon: 1, stufenBis: 4 }]);
});

test('Zusammenfassung gruppiert Fächer mit gleichen Stufengruppen', () => {
  const l = lk([{ fach: 'f-de', stufenVon: 1, stufenBis: 4 }, { fach: 'f-ma', stufenVon: 1, stufenBis: 4 }, { fach: 'f-en', stufenVon: 1, stufenBis: 10 }, { fach: 'f-ku', stufenVon: 3, stufenBis: 4 }]);
  assert.equal(Q.zusammenfassung(l, faecher), 'DE, MA (P) · EN (P, SI) · KU (3–4)');
  assert.equal(Q.zusammenfassung(lk([]), faecher), '');
  const alle = lk(faecher.map((f) => ({ fach: f.id, stufenVon: 1, stufenBis: 4 })));
  assert.equal(Q.zusammenfassung(alle, faecher), 'alle Fächer (P)');
});

test('angezeigte Gruppen richten sich nach den Klassen', () => {
  const z = miniSchule();
  assert.deepEqual(Q.genutzteGruppen(z), ['P']);
  z.klassen[0].stufe = 7;
  assert.deepEqual(Q.genutzteGruppen(z), ['P', 'SI']);
  z.klassen = [];
  assert.deepEqual(Q.genutzteGruppen(z), ['P', 'SI', 'SII']);
});
