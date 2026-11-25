/* Prüft die ausgelieferte Datei stundenplan.html: aktuell, eigenständig,
 * ohne externe Ressourcen (Spezifikation §1, §9 Datenschutz). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { baue, ZIEL } from '../tools/build.mjs';

const html = readFileSync(ZIEL, 'utf8');

test('stundenplan.html ist aktuell (Build ausgeführt)', () => {
  assert.equal(html, baue(), 'Bitte „npm run build“ ausführen und das Ergebnis einchecken');
});

test('keine externen Ressourcen und keine Netzwerk-APIs', () => {
  assert.doesNotMatch(html, /<(script|link|img|iframe)[^>]+(src|href)\s*=\s*["']?(https?:)?\/\//i);
  assert.doesNotMatch(html, /@import|url\(\s*["']?https?:/i);
  for (const api of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'localStorage', 'document.cookie', 'importScripts']) {
    assert.ok(!html.includes(api), `verbotene API im Code: ${api}`);
  }
});

test('Content-Security-Policy verbietet Netzwerkzugriffe', () => {
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(csp, 'CSP fehlt');
  assert.match(csp[1], /default-src 'none'/);
  assert.match(csp[1], /connect-src 'none'/);
  assert.match(csp[1], /worker-src blob:/);
});

test('Gliederung: Kern, Worker-Quelle und Oberfläche als getrennte Blöcke', () => {
  assert.match(html, /<script id="kern">/);
  assert.match(html, /<script id="worker-quelle" type="text\/plain">/);
  assert.match(html, /<script id="ui">/);
  assert.match(html, /<html lang="de">/);
  assert.ok(!html.includes('/*@@'), 'nicht ersetzte Marke');
});
