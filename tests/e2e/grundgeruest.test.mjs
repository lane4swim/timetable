/* Ende-zu-Ende-Test: stundenplan.html per file:// in Chromium öffnen
 * (wie beim Doppelklick) und das Grundgerüst prüfen. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ZIEL } from '../../tools/build.mjs';

// Playwright ist in der Umgebung vorinstalliert und wird bewusst nicht als Abhängigkeit geführt.
const { chromium } = createRequire(import.meta.url)('playwright');

let browser;
let seite;
const konsolenfehler = [];
const netzanfragen = [];

before(async () => {
  browser = await chromium.launch();
  seite = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  seite.on('console', (m) => { if (m.type() === 'error') konsolenfehler.push(m.text()); });
  seite.on('pageerror', (e) => konsolenfehler.push(String(e)));
  seite.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith('file:') && !url.startsWith('blob:') && !url.startsWith('data:')) netzanfragen.push(url);
  });
  await seite.goto(pathToFileURL(ZIEL).href);
});

after(async () => { await browser?.close(); });

test('Seite lädt mit deutschem Titel, ohne Fehler und ohne Netzwerkzugriffe', async () => {
  assert.equal(await seite.title(), 'Stundenplanplanung');
  assert.equal(await seite.getAttribute('html', 'lang'), 'de');
  await seite.waitForTimeout(200);
  assert.deepEqual(konsolenfehler, []);
  assert.deepEqual(netzanfragen, []);
});

test('Rechenkern (Blob-Worker) startet und antwortet', async () => {
  const status = seite.locator('#status-rechenkern');
  await status.filter({ hasText: 'Rechenkern bereit' }).waitFor({ timeout: 5000 });
  assert.equal(await status.getAttribute('data-art'), 'ok');
});

test('sieben Reiter in der Reihenfolge der Spezifikation, erster aktiv', async () => {
  const titel = await seite.locator('[role=tab]').allTextContents();
  assert.deepEqual(titel, ['Stammdaten', 'Zuordnung', 'Planung', 'Plan', 'Ausfall', 'Bericht', 'Daten']);
  assert.equal(await seite.getAttribute('#reiter-stammdaten', 'aria-selected'), 'true');
  assert.ok(await seite.isVisible('#panel-stammdaten'));
  assert.ok(await seite.isHidden('#panel-daten'));
});

test('Reiter per Maus und Tastatur (Pfeile, Pos1, Ende) bedienbar', async () => {
  await seite.click('#reiter-plan');
  assert.equal(await seite.getAttribute('#reiter-plan', 'aria-selected'), 'true');
  assert.ok(await seite.isVisible('#panel-plan'));

  await seite.keyboard.press('ArrowRight');
  assert.equal(await seite.evaluate(() => document.activeElement.id), 'reiter-ausfall');
  assert.ok(await seite.isVisible('#panel-ausfall'));

  await seite.keyboard.press('End');
  assert.equal(await seite.evaluate(() => document.activeElement.id), 'reiter-daten');
  await seite.keyboard.press('ArrowRight'); // springt zum Anfang
  assert.equal(await seite.evaluate(() => document.activeElement.id), 'reiter-stammdaten');
  await seite.keyboard.press('ArrowLeft');
  assert.equal(await seite.evaluate(() => document.activeElement.id), 'reiter-daten');
  await seite.keyboard.press('Home');
  assert.equal(await seite.evaluate(() => document.activeElement.id), 'reiter-stammdaten');
  // Nur der aktive Reiter liegt in der Tab-Reihenfolge
  const tabindizes = await seite.locator('[role=tab]').evaluateAll((k) => k.map((x) => x.tabIndex));
  assert.deepEqual(tabindizes, [0, -1, -1, -1, -1, -1, -1]);
});

test('Kern ist im Hauptthread verfügbar', async () => {
  const r = await seite.evaluate(() => ({
    version: window.Stundenplan.Kern.version,
    tag: window.Stundenplan.Kern.Hilfen.wochentag('2026-11-16'),
    pausen: window.Stundenplan.Kern.Modell.leererZustand().zeitraster.pausen.map((p) => p.vorStunde),
  }));
  assert.deepEqual(r, { version: '0.1.0', tag: 'Mo', pausen: [1, 3, 5] });
});
