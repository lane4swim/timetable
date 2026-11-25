/* Veröffentlichung auf GitHub Pages: Inhalt des Zielordners. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bereitePagesVor } from '../tools/pages.mjs';
import { ZIEL } from '../tools/build.mjs';

test('Pages-Ordner enthält index.html (= stundenplan.html), stundenplan.html und .nojekyll', () => {
  const ordner = join(mkdtempSync(join(tmpdir(), 'pages-')), '_site');
  bereitePagesVor(ordner);
  const original = readFileSync(ZIEL, 'utf8');
  assert.equal(readFileSync(join(ordner, 'index.html'), 'utf8'), original);
  assert.equal(readFileSync(join(ordner, 'stundenplan.html'), 'utf8'), original);
  assert.ok(existsSync(join(ordner, '.nojekyll')));
});
