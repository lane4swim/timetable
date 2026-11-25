/* Ende-zu-Ende: Reiter „Planung“ – Plan im Web Worker erstellen, Fortschritt,
 * Abbruch mit Übernahme der besten Lösung, Optionen und Gewichte. */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { ZIEL } from '../../tools/build.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const DATEN = join(dirname(fileURLToPath(import.meta.url)), '..', 'daten');

let browser;
let seite;
let fehler = [];
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
beforeEach(async () => {
  await seite?.close();
  seite = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  fehler = [];
  seite.on('pageerror', (e) => fehler.push(String(e)));
  seite.on('console', (m) => { if (m.type() === 'error') fehler.push(m.text()); });
  await seite.goto(pathToFileURL(ZIEL).href);
});

async function lade(name) {
  await seite.click('#reiter-daten');
  await seite.setInputFiles('#daten-datei', join(DATEN, name + '.json'));
  await seite.locator('#daten-meldungen .meldung', { hasText: 'Importiert' }).waitFor();
  await seite.click('#reiter-planung');
}
const feld = (name) => seite.locator(`#daten-uebersicht dd[data-feld="${name}"]`).textContent();

test('Plan erstellen: Ergebnis mit Kostenvektor, Plan übernommen und gültig', async () => {
  await lade('klein');
  await seite.click('#plan-erstellen');
  await seite.locator('#planung-ergebnis .meldung-ok', { hasText: 'Plan erstellt und übernommen' }).waitFor({ timeout: 30000 });
  const text = await seite.textContent('#planung-ergebnis');
  assert.match(text, /Keine Verstöße gegen harte Regeln/);
  assert.match(text, /Ausfall nachweislich minimal \(0 Stunde/);
  assert.equal(await seite.locator('#planung-vektor tbody tr').count(), 7);
  assert.equal(await seite.textContent('#planung-vektor tr[data-ziel="K1"] td.zahl'), '0');
  assert.equal(await seite.getAttribute('#planung-balken', 'value'), '1');
  assert.match(await seite.textContent('#planung-status'), /^Fertig nach \d+\.\d s\.$/);
  await seite.click('#reiter-daten');
  assert.ok(Number(await feld('Stunden im Regelplan')) >= 90);
  assert.match(await feld('Regelplan'), /✓ gültig/);
  assert.match(await seite.textContent('#status-speicher'), /Ungespeicherte Änderungen/);
  assert.deepEqual(fehler, []);
});

test('Unterdeckung: Ausfall und Hinweise werden angezeigt', async () => {
  await lade('unterdeckung');
  await seite.click('#plan-erstellen');
  await seite.locator('#planung-ergebnis .meldung-ok').waitFor({ timeout: 30000 });
  assert.match(await seite.textContent('#planung-ergebnis'), /Ausfall nachweislich minimal/);
  assert.match(await seite.textContent('#planung-ausfall'), /MA: \d+ Stunde\(n\) – keine qualifizierte Lehrkraft/);
  assert.match(await seite.textContent('#planung-hinweise'), /Aufsichtssoll/);
});

test('Abbruch übernimmt die beste bisherige Lösung, Oberfläche bleibt bedienbar', async () => {
  await lade('gross');
  // Viel Budget, damit der Lauf sicher noch läuft
  await seite.fill('#opt-zeitbudgetSekunden', '120');
  await seite.dispatchEvent('#opt-zeitbudgetSekunden', 'change');
  await seite.click('#plan-erstellen');
  await seite.locator('#planung-status', { hasText: 'Nachoptimierung' }).waitFor({ timeout: 30000 });
  // Oberfläche reagiert während der Planung
  await seite.click('#reiter-daten');
  await seite.click('#reiter-planung');
  assert.equal(await seite.isEnabled('#plan-abbrechen'), true);
  await seite.click('#plan-abbrechen');
  await seite.locator('#planung-ergebnis .meldung', { hasText: 'abgebrochen' }).waitFor({ timeout: 15000 });
  assert.match(await seite.textContent('#planung-ergebnis'), /Keine Verstöße gegen harte Regeln/);
  assert.equal(await seite.isEnabled('#plan-erstellen'), true);
});

test('Neu erstellen fragt vor dem Ersetzen nach', async () => {
  await lade('klein');
  await seite.click('#plan-erstellen');
  await seite.locator('#planung-ergebnis .meldung-ok').waitFor({ timeout: 30000 });
  await seite.click('#plan-erstellen');
  await seite.locator('dialog[open]', { hasText: 'Regelplan neu erstellen?' }).waitFor();
  await seite.click('dialog[open] button[data-wert="abbrechen"]');
  assert.equal(await seite.isEnabled('#plan-erstellen'), true);
});

test('Optionen: gültige Werte landen in den Einstellungen, ungültige werden markiert', async () => {
  await lade('klein');
  await seite.fill('#opt-zufallsStartwert', '7');
  await seite.dispatchEvent('#opt-zufallsStartwert', 'change');
  await seite.click('.gewichte summary'); // Gewichte aufklappen
  await seite.fill('#opt-gewichte-W1', '-3');
  await seite.dispatchEvent('#opt-gewichte-W1', 'change');
  await seite.uncheck('#opt-zweitbesetzungErlaubt');
  const e = await seite.evaluate(() => window.Stundenplan.App.zustand.daten.einstellungen);
  assert.equal(e.zufallsStartwert, 7);
  assert.equal(e.gewichte.W1, 10, 'ungültiger Wert wird nicht übernommen');
  assert.equal(e.zweitbesetzungErlaubt, false);
  assert.equal(await seite.getAttribute('#opt-gewichte-W1', 'aria-invalid'), 'true');
  assert.match(await seite.textContent('#panel-planung'), /⚠ Bitte eine ganze Zahl von 0 bis 1000 eingeben/);
});

test('ohne Klassen: Hinweis statt Planung', async () => {
  await seite.click('#reiter-planung');
  await seite.click('#plan-erstellen');
  assert.match(await seite.textContent('#planung-ergebnis'), /Keine Klassen vorhanden/);
});
