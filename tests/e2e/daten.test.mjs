/* Ende-zu-Ende: Reiter „Daten“ – Import per Dateiauswahl und Drag-and-drop,
 * Export als Download, Rückfrage vor dem Überschreiben, Fehleranzeige mit
 * Pfad, Zurücksetzen, Warnung bei ungespeicherten Änderungen. */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ZIEL } from '../../tools/build.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const DATEN = join(dirname(fileURLToPath(import.meta.url)), '..', 'daten');
const ARBEIT = mkdtempSync(join(tmpdir(), 'stundenplan-e2e-'));

let browser;
let seite;
let fehler = [];

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
beforeEach(async () => {
  await seite?.close();
  seite = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  fehler = [];
  seite.on('pageerror', (e) => fehler.push(String(e)));
  seite.on('console', (m) => { if (m.type() === 'error') fehler.push(m.text()); });
  await seite.goto(pathToFileURL(ZIEL).href);
  await seite.click('#reiter-daten');
});

const feld = (name) => seite.locator(`#daten-uebersicht dd[data-feld="${name}"]`).textContent();
const meldung = () => seite.locator('#daten-meldungen .meldung');

async function importiere(datei) {
  await seite.setInputFiles('#daten-datei', datei);
}
function schreibe(name, inhalt) {
  const pfad = join(ARBEIT, name);
  writeFileSync(pfad, typeof inhalt === 'string' ? inhalt : JSON.stringify(inhalt));
  return pfad;
}

test('Import per Dateiauswahl in leeren Zustand: ohne Rückfrage, Übersicht aktualisiert', async () => {
  await importiere(join(DATEN, 'klein.json'));
  await meldung().filter({ hasText: 'Importiert: klein.json' }).waitFor();
  assert.equal(await feld('Lehrkräfte'), '5');
  assert.equal(await feld('Klassen'), '4');
  assert.match(await seite.textContent('#daten-speicherstand'), /Zuletzt exportiert: .*2026.*Keine ungespeicherten Änderungen/);
  assert.equal(await seite.locator('dialog').count(), 0);
  assert.deepEqual(fehler, []);
});

test('Abnahme 1 über die Oberfläche: Import → Export ergibt denselben Inhalt (ohne exportedAt)', async () => {
  const original = readFileSync(join(DATEN, 'gross.json'), 'utf8');
  await importiere(join(DATEN, 'gross.json'));
  await meldung().filter({ hasText: 'Importiert' }).waitFor();
  const [download] = await Promise.all([seite.waitForEvent('download'), seite.click('#export-gesamt')]);
  assert.match(download.suggestedFilename(), /^stundenplan-\d{4}-\d{2}-\d{2}\.json$/);
  const exportiert = JSON.parse(readFileSync(await download.path(), 'utf8'));
  const erwartet = JSON.parse(original);
  delete exportiert.exportedAt;
  delete erwartet.exportedAt;
  assert.deepEqual(exportiert, erwartet);
  assert.match(await seite.textContent('#daten-speicherstand'), /Keine ungespeicherten Änderungen/);
});

test('Teil-Exporte haben eigene Dateinamen und Inhalte', async () => {
  await importiere(join(DATEN, 'klein.json'));
  await meldung().filter({ hasText: 'Importiert' }).waitFor();
  const [s] = await Promise.all([seite.waitForEvent('download'), seite.click('#export-stammdaten')]);
  assert.match(s.suggestedFilename(), /^stundenplan-stammdaten-/);
  const stammdaten = JSON.parse(readFileSync(await s.path(), 'utf8'));
  assert.equal(stammdaten.teil, 'stammdaten');
  assert.equal(stammdaten.plan, undefined);
  const [p] = await Promise.all([seite.waitForEvent('download'), seite.click('#export-plan')]);
  assert.match(p.suggestedFilename(), /^stundenplan-plan-/);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(await p.path(), 'utf8'))), ['schemaVersion', 'exportedAt', 'teil', 'plan']);
});

test('Abnahme 7: fehlerhafte Datei wird mit Pfad abgewiesen, Zustand bleibt unverändert', async () => {
  await importiere(join(DATEN, 'klein.json'));
  await meldung().filter({ hasText: 'Importiert' }).waitFor();
  const kaputt = JSON.parse(readFileSync(join(DATEN, 'ueberhang.json'), 'utf8'));
  kaputt.lehrkraefte[3].qualifikationen[0].fach = 'f-xy';
  delete kaputt.klassen[0].name;
  await importiere(schreibe('kaputt.json', kaputt));
  const m = meldung().filter({ hasText: 'Import abgelehnt: kaputt.json' });
  await m.waitFor();
  assert.equal(await m.getAttribute('role'), 'alert');
  const text = await m.textContent();
  assert.match(text, /2 Fehler/);
  assert.match(text, /lehrkraefte\[3\]\.qualifikationen\[0\]\.fach: unbekannte Referenz „f-xy“/);
  assert.match(text, /klassen\[0\]\.name: Pflichtfeld fehlt/);
  assert.match(text, /keine Daten verändert/);
  assert.equal(await feld('Lehrkräfte'), '5', 'Zustand unverändert');
  assert.equal(await seite.locator('dialog').count(), 0, 'keine Rückfrage bei fehlerhafter Datei');
});

test('unbekannte Version und kein JSON werden abgelehnt', async () => {
  await importiere(schreibe('neu.json', { schemaVersion: 7, zeitraster: {} }));
  await meldung().filter({ hasText: 'neuer als dieses Programm' }).waitFor();
  await importiere(schreibe('kein.json', 'das ist kein JSON'));
  await meldung().filter({ hasText: 'keine gültige JSON-Datei' }).waitFor();
  assert.equal(await feld('Lehrkräfte'), '0');
});

test('Rückfrage vor dem Überschreiben: Abbrechen, Exportieren, Ersetzen', async () => {
  await importiere(join(DATEN, 'klein.json'));
  await meldung().filter({ hasText: 'Importiert' }).waitFor();

  // Abbrechen
  await importiere(join(DATEN, 'gross.json'));
  const dialog = seite.locator('dialog[open]');
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /ersetzt alle vorhandenen Daten/);
  assert.equal(await seite.evaluate(() => document.activeElement.dataset.wert), 'abbrechen', 'Fokus auf dem sicheren Knopf');
  await dialog.locator('button[data-wert="abbrechen"]').click();
  await meldung().filter({ hasText: 'Import abgebrochen' }).waitFor();
  assert.equal(await feld('Klassen'), '4');

  // Erst exportieren, dann ersetzen
  await importiere(join(DATEN, 'gross.json'));
  await dialog.waitFor();
  const [download] = await Promise.all([seite.waitForEvent('download'), dialog.locator('button[data-wert="export"]').click()]);
  assert.equal(JSON.parse(readFileSync(await download.path(), 'utf8')).klassen.length, 4);
  await dialog.waitFor(); // Rückfrage erscheint erneut
  await dialog.locator('button[data-wert="ersetzen"]').click();
  await meldung().filter({ hasText: 'Importiert: gross.json' }).waitFor();
  assert.equal(await feld('Klassen'), '30');
});

test('Esc schließt die Rückfrage ohne Änderung', async () => {
  await importiere(join(DATEN, 'klein.json'));
  await meldung().filter({ hasText: 'Importiert' }).waitFor();
  await importiere(join(DATEN, 'gross.json'));
  await seite.locator('dialog[open]').waitFor();
  await seite.keyboard.press('Escape');
  await meldung().filter({ hasText: 'Import abgebrochen' }).waitFor();
  assert.equal(await feld('Klassen'), '4');
});

test('Drag-and-drop einer Datei auf die Seite importiert sie (auch aus anderem Reiter)', async () => {
  await seite.click('#reiter-plan');
  const inhalt = readFileSync(join(DATEN, 'ueberhang.json'), 'utf8');
  await seite.evaluate((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'gezogen.json', { type: 'application/json' }));
    for (const typ of ['dragenter', 'dragover', 'drop']) {
      document.getElementById('app').dispatchEvent(new DragEvent(typ, { dataTransfer: dt, bubbles: true, cancelable: true }));
    }
  }, inhalt);
  await meldung().filter({ hasText: 'Importiert: gezogen.json' }).waitFor();
  assert.equal(await seite.getAttribute('#reiter-daten', 'aria-selected'), 'true');
  assert.equal(await feld('Lehrkräfte'), '10');
  assert.equal(await seite.evaluate(() => document.body.classList.contains('ablage-aktiv')), false);
});

test('Stammdaten-Import, zu dem der Plan nicht passt: Angebot „Plan verwerfen“', async () => {
  // Zustand mit Plan herstellen (Plan-Bearbeitung folgt erst in M5)
  const mitPlan = JSON.parse(readFileSync(join(DATEN, 'klein.json'), 'utf8'));
  const k = mitPlan.klassen[0];
  const z = mitPlan.zuordnungen.find((x) => x.klasse === k.id && x.rolle === 'haupt');
  mitPlan.plan.regelplan = [{ klasse: k.id, fach: z.fach, lehrkraefte: [z.lehrkraft], raum: k.heimatraum, tag: 'Mo', stunde: 1, status: 'regulaer' }];
  await importiere(schreibe('mitplan.json', mitPlan));
  await meldung().filter({ hasText: 'Importiert' }).waitFor();
  assert.equal(await feld('Stunden im Regelplan'), '1');
  // Prüfung des Regelplans in der Übersicht: gültig, Kostenvektor angezeigt
  assert.match(await feld('Regelplan'), /✓ gültig/);
  assert.match(await feld('Kostenvektor'), /^K1 \d+ · K1A \d+ · K2 0 · K3 0 · K4 0 · K5 \d+ · K6 [\d.]+$/);

  const fremd = JSON.parse(readFileSync(join(DATEN, 'gross.json'), 'utf8'));
  fremd.teil = 'stammdaten';
  delete fremd.plan;
  await importiere(schreibe('fremd-stammdaten.json', fremd));
  await meldung().filter({ hasText: 'Import abgelehnt' }).waitFor();
  await seite.click('#import-plan-verwerfen');
  await seite.locator('dialog[open]').waitFor();
  assert.match(await seite.textContent('dialog[open]'), /verwirft den vorhandenen Plan/);
  await seite.click('dialog[open] button[data-wert="ersetzen"]');
  await meldung().filter({ hasText: 'Importiert: fremd-stammdaten.json' }).waitFor();
  assert.equal(await feld('Klassen'), '30');
  assert.equal(await feld('Stunden im Regelplan'), '0');
  // Nach einem Teil-Import gilt der Gesamtstand als ungespeichert
  assert.match(await seite.textContent('#daten-speicherstand'), /Ungespeicherte Änderungen/);
});

test('Zurücksetzen mit Rückfrage', async () => {
  await importiere(join(DATEN, 'klein.json'));
  await meldung().filter({ hasText: 'Importiert' }).waitFor();
  await seite.click('#daten-zuruecksetzen');
  await seite.click('dialog[open] button[data-wert="ersetzen"]');
  await meldung().filter({ hasText: 'Daten zurückgesetzt' }).waitFor();
  assert.equal(await feld('Lehrkräfte'), '0');
  assert.match(await seite.textContent('#daten-speicherstand'), /Noch nicht exportiert/);
});

test('ungespeicherte Änderungen: Anzeige und Warnung beim Schließen (beforeunload)', async () => {
  await importiere(join(DATEN, 'klein.json'));
  await meldung().filter({ hasText: 'Importiert' }).waitFor();
  await seite.evaluate(() => window.Stundenplan.App.markiereGeaendert());
  assert.match(await seite.textContent('#status-speicher'), /Ungespeicherte Änderungen/);
  assert.match(await seite.textContent('#daten-speicherstand'), /Ungespeicherte Änderungen/);

  // Der Browser zeigt die Rückfrage, wenn der beforeunload-Handler das Ereignis abbricht.
  // (Headless-Browser zeigen den Dialog selbst nicht zuverlässig; daher wird der Handler geprüft.)
  const wuerdeWarnen = () => seite.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  assert.equal(await wuerdeWarnen(), true, 'Warnung beim Schließen erwartet');

  // Nach vollständigem Export keine Warnung mehr
  await Promise.all([seite.waitForEvent('download'), seite.click('#export-gesamt')]);
  assert.equal(await seite.textContent('#status-speicher'), '');
  assert.equal(await wuerdeWarnen(), false);
  // Ein Teil-Export sichert nicht alles
  await seite.evaluate(() => window.Stundenplan.App.markiereGeaendert());
  await Promise.all([seite.waitForEvent('download'), seite.click('#export-plan')]);
  assert.equal(await wuerdeWarnen(), true);
});

test('Regelplan mit Verstoß wird als ungültig markiert (Symbol und Regelnummer, nicht nur Farbe)', async () => {
  const d = JSON.parse(readFileSync(join(DATEN, 'klein.json'), 'utf8'));
  const [k1, k2] = d.klassen;
  const z1 = d.zuordnungen.find((x) => x.klasse === k1.id && x.rolle === 'haupt');
  const z2 = d.zuordnungen.find((x) => x.klasse === k2.id && x.rolle === 'haupt');
  // dieselbe Lehrkraft zur selben Zeit in zwei Klassen (H1)
  d.plan.regelplan = [
    { klasse: k1.id, fach: z1.fach, lehrkraefte: [z1.lehrkraft], raum: k1.heimatraum, tag: 'Mo', stunde: 1, status: 'regulaer' },
    { klasse: k2.id, fach: z2.fach, lehrkraefte: [z1.lehrkraft], raum: k2.heimatraum, tag: 'Mo', stunde: 1, status: 'vertreten' },
  ];
  await importiere(schreibe('ungueltig.json', d));
  await meldung().filter({ hasText: 'Importiert' }).waitFor();
  const text = await feld('Regelplan');
  assert.match(text, /⚠ ungültig/);
  assert.match(text, /H1 ×1/);
});
