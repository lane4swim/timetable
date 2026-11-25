import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ladeKern } from '../hilfe/lade-kern.mjs';

const { Fluss } = ladeKern();

test('maximaler Fluss mit minimalen Kosten', () => {
  // q=0 → a=2 (3), q → b=3 (2); a → s=1 (2, Kosten 1), a → b (1, Kosten 1), b → s (3, Kosten 2)
  const g = Fluss.graph(4);
  Fluss.kante(g, 0, 2, 3);
  Fluss.kante(g, 0, 3, 2);
  const as = Fluss.kante(g, 2, 1, 2, 1);
  const ab = Fluss.kante(g, 2, 3, 1, 1);
  const bs = Fluss.kante(g, 3, 1, 3, 2);
  const r = Fluss.minKostenMaxFluss(g, 0, 1);
  assert.equal(r.fluss, 5);
  assert.equal(r.kosten, 2 * 1 + 1 * (1 + 2) + 2 * 2);
  assert.deepEqual([Fluss.flussVon(g, as), Fluss.flussVon(g, ab), Fluss.flussVon(g, bs)], [2, 1, 3]);
});

test('billigerer Weg wird bevorzugt, teurer nur bei Bedarf', () => {
  const g = Fluss.graph(3);
  Fluss.kante(g, 0, 2, 4);
  const billig = Fluss.kante(g, 2, 1, 3, 0);
  const teuer = Fluss.kante(g, 2, 1, 5, 100);
  const r = Fluss.minKostenMaxFluss(g, 0, 1);
  assert.equal(r.fluss, 4);
  assert.deepEqual([Fluss.flussVon(g, billig), Fluss.flussVon(g, teuer)], [3, 1]);
});

test('Grenze und kein Weg', () => {
  const g = Fluss.graph(3);
  Fluss.kante(g, 0, 2, 10);
  Fluss.kante(g, 2, 1, 10);
  assert.equal(Fluss.minKostenMaxFluss(g, 0, 1, 4).fluss, 4);
  assert.equal(Fluss.minKostenMaxFluss(Fluss.graph(2), 0, 1).fluss, 0);
});
