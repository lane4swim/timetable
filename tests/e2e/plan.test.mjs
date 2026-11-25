/* Ende-zu-Ende: Reiter „Plan“ (M5) – Raster je Klasse/Lehrkraft/Raum/Aufsicht,
 * Drag-and-drop und Tastatur, Konfliktanzeige mit Regelnummer, Zweitbesetzung,
 * Aufsichten, Rückgängig, Druckansicht, Reaktionszeit. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { ZIEL } from '../../tools/build.mjs';
import { ladeKern } from '../hilfe/lade-kern.mjs';
import { datensatz } from '../hilfe/beispiele.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const K = ladeKern();
const ARBEIT = dirname(fileURLToPath(import.meta.url));

// Geplante Datensätze einmal in Node erzeugen (schneller als im Browser) und als Zustand laden
const geplant = {};
for (const name of ['ueberhang', 'gross']) {
  const z = datensatz(name);
  const r = K.Planer.plane(z);
  z.plan.regelplan = r.plan.regelplan;
  z.plan.aufsichten = r.plan.aufsichten;
  geplant[name] = z;
}

let browser;
let seite;
let fehler = [];
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function oeffne(name) {
  await seite?.close();
  seite = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  fehler = [];
  seite.on('pageerror', (e) => fehler.push(String(e)));
  seite.on('console', (m) => { if (m.type() === 'error') fehler.push(m.text()); });
  await seite.goto(pathToFileURL(ZIEL).href);
  await seite.evaluate((z) => window.Stundenplan.App.setzeDaten(z, { beschreibung: 'Testdaten' }), geplant[name]);
  await seite.click('#reiter-plan');
}
const daten = () => seite.evaluate(() => window.Stundenplan.App.zustand.daten);
const zelle = (tag, stunde) => seite.locator(`#plan-raster-rahmen td[data-tag="${tag}"][data-stunde="${stunde}"]`);
const pausenZelle = (tag, vor) => seite.locator(`#plan-raster-rahmen td[data-tag="${tag}"][data-pause="${vor}"]`);
const indexIn = async (tag, stunde) => Number(await zelle(tag, stunde).locator('.karte').first().getAttribute('data-index'));

test('Klassenansicht: Raster mit Pausenzeilen, Karten und gültigem Plan', async () => {
  await oeffne('ueberhang');
  const d = await daten();
  const k = d.klassen[0];
  const stunden = d.plan.regelplan.filter((s) => s.klasse === k.id).length;
  assert.equal(await seite.locator('#plan-raster-rahmen .karte').count(), stunden);
  assert.equal(await seite.locator('#plan-raster-rahmen .pausenzeile').count(), d.zeitraster.pausen.length);
  assert.match(await seite.textContent('#plan-konflikte h3'), /Keine Verstöße/);
  assert.ok(await seite.locator('#plan-raster-rahmen .karte .zweit').count() > 0, 'Zweitbesetzungen mit „+“');
  assert.match(await seite.locator('#plan-raster-rahmen .karte .zweit').first().textContent(), /^\+/);
  assert.deepEqual(fehler, []);
});

test('Drag-and-drop: Tausch innerhalb der Klasse, rückgängig machen', async () => {
  await oeffne('ueberhang');
  const a = await indexIn('Mo', 1);
  const b = await indexIn('Mo', 3);
  await zelle('Mo', 1).locator('.karte').first().dragTo(zelle('Mo', 3));
  let plan = (await daten()).plan.regelplan;
  assert.deepEqual([plan[a].stunde, plan[b].stunde], [3, 1]);
  assert.match(await seite.textContent('#plan-ansage'), /Mo 1\. → Mo 3\. \(getauscht mit/);
  // Der Tausch kann Konflikte erzeugen (Lehrkräfte anderweitig belegt) – sie werden angezeigt, nicht verhindert
  await seite.click('#knopf-rueckgaengig');
  plan = (await daten()).plan.regelplan;
  assert.deepEqual([plan[a].stunde, plan[b].stunde], [1, 3]);
});

test('Konflikt durch Verschieben: rot, ⚠ mit Regelnummer, Liste, Navigation', async () => {
  await oeffne('ueberhang');
  // Die 2. Stunde hinter das Tagesende ziehen: es entsteht eine Leerstunde (H12)
  const d = await daten();
  const k = d.klassen[0];
  const mo = d.plan.regelplan.filter((s) => s.klasse === k.id && s.tag === 'Mo').map((s) => s.stunde);
  const frei = Math.max(...mo) + 1;
  assert.ok(frei <= d.zeitraster.stunden.length, 'Testvoraussetzung: Montag endet vor der letzten Stunde');
  await zelle('Mo', 2).locator('.karte').first().dragTo(zelle('Mo', frei));
  const marke = seite.locator('#plan-raster-rahmen .karte.konflikt .konflikt-marke').first();
  assert.match(await marke.textContent(), /⚠ .*H12/);
  assert.match(await seite.textContent('#plan-konflikte h3'), /⚠ Konflikte \(\d+\)/);
  assert.match(await seite.textContent('#plan-ansage'), /Der Plan hat jetzt (einen Verstoß|\d+ Verstöße)/);
  // Daten-Reiter markiert den Plan als ungültig
  await seite.click('#reiter-daten');
  assert.match(await seite.textContent('#daten-uebersicht dd[data-feld="Regelplan"]'), /⚠ ungültig.*H12/);
  await seite.click('#reiter-plan');
  await seite.click('#plan-konflikte .konfliktliste button');
  assert.equal(await seite.getAttribute('#ansicht-klasse', 'aria-pressed'), 'true');
  assert.equal(await seite.evaluate(() => document.activeElement.dataset.tag), 'Mo');
});

test('Tastatur: aufnehmen, mit Pfeilen bewegen, ablegen; Esc bricht ab', async () => {
  await oeffne('ueberhang');
  const a = await indexIn('Di', 1);
  await zelle('Di', 1).focus();
  await seite.keyboard.press('Enter');
  assert.match(await seite.textContent('#plan-ansage'), /Stunde aufgenommen/);
  await seite.keyboard.press('Escape');
  assert.match(await seite.textContent('#plan-ansage'), /Abgebrochen/);
  await seite.keyboard.press('Enter');
  await seite.keyboard.press('ArrowDown'); // Di 2
  await seite.keyboard.press('Enter');
  const plan = (await daten()).plan.regelplan;
  assert.deepEqual([plan[a].tag, plan[a].stunde], ['Di', 2]);
  assert.equal(await seite.evaluate(() => [document.activeElement.dataset.tag, document.activeElement.dataset.stunde].join(' ')), 'Di 2');
});

test('Zweitbesetzung aus „Freie Kontingente“ per Drag-and-drop, Anzeige (2.), Entfernen mit Entf', async () => {
  await oeffne('ueberhang');
  // eine Stunde ohne Zweitbesetzung suchen
  const d = await daten();
  const k = d.klassen[0];
  const s = d.plan.regelplan.find((x) => x.klasse === k.id && x.lehrkraefte.length === 1);
  if (!s) return; // alle Stunden schon doppelt besetzt
  // Zweitbesetzung in dieser Stunde ermöglichen: freies Kontingent einer Lehrkraft schaffen
  const chips = seite.locator('#plan-frei .chip');
  if (!(await chips.count())) {
    await seite.evaluate(() => window.Stundenplan.App.aendere('Test: mehr Kontingent', (x) => { const l = x.lehrkraefte[0]; l.sollStunden = 40; l.maxStunden = 40; }));
  }
  const chip = seite.locator('#plan-frei .chip').first();
  const lehrkraft = await chip.getAttribute('data-lehrkraft');
  await chip.dragTo(zelle(s.tag, s.stunde));
  const neu = (await daten()).plan.regelplan.find((x) => x.klasse === k.id && x.tag === s.tag && x.stunde === s.stunde);
  assert.deepEqual(neu.lehrkraefte, [s.lehrkraefte[0], lehrkraft]);
  // Lehrkraftansicht der Zweitlehrkraft zeigt „(2.)“
  await seite.click('#ansicht-lehrkraft');
  await seite.selectOption('#plan-auswahl', lehrkraft);
  assert.match(await zelle(s.tag, s.stunde).textContent(), /\(2\.\)/);
  // Entfernen per Tastatur in der Klassenansicht
  await seite.click('#ansicht-klasse');
  await seite.selectOption('#plan-auswahl', k.id);
  await zelle(s.tag, s.stunde).focus();
  await seite.keyboard.press('Delete');
  const zurueck = (await daten()).plan.regelplan.find((x) => x.klasse === k.id && x.tag === s.tag && x.stunde === s.stunde);
  assert.deepEqual(zurueck.lehrkraefte, [s.lehrkraefte[0]]);
});

test('Aufsichtsansicht: verschieben, hinzufügen per Tastatur, entfernen, Bedarfsanzeige', async () => {
  await oeffne('ueberhang');
  await seite.click('#ansicht-aufsicht');
  assert.equal(await seite.isHidden('#plan-auswahl'), true);
  let d = await daten();
  const p = d.zeitraster.pausen;
  const chip = pausenZelle('Mo', p[0].vorStunde).locator('.chip').first();
  const index = Number(await chip.getAttribute('data-aufsicht'));
  await chip.dragTo(pausenZelle('Mi', p[1].vorStunde));
  d = await daten();
  assert.deepEqual([d.plan.aufsichten[index].tag, d.plan.aufsichten[index].vorStunde], ['Mi', p[1].vorStunde]);
  assert.match(await pausenZelle('Mo', p[0].vorStunde).locator('.bedarf').textContent(), /⚠ \d+\/\d+/);
  // Entfernen per ×
  const vorher = d.plan.aufsichten.length;
  await pausenZelle('Mi', p[1].vorStunde).locator('.chip .mini').first().click();
  assert.equal((await daten()).plan.aufsichten.length, vorher - 1);
  // Hinzufügen per Tastatur aus „Aufsichtssoll offen“
  const quelle = seite.locator('#plan-aufsicht-offen .chip').first();
  const l = await quelle.getAttribute('data-lehrkraft');
  await quelle.click();
  assert.match(await seite.textContent('#plan-ansage'), /aufgenommen/);
  await pausenZelle('Mo', p[0].vorStunde).focus();
  await seite.keyboard.press('Enter');
  d = await daten();
  assert.ok(d.plan.aufsichten.some((a) => a.lehrkraft === l && a.tag === 'Mo' && a.vorStunde === p[0].vorStunde));
  assert.deepEqual(fehler, []);
});

test('Raumansicht und Lehrkraftansicht zeigen die passenden Stunden', async () => {
  await oeffne('ueberhang');
  const d = await daten();
  const l = d.lehrkraefte[0];
  await seite.click('#ansicht-lehrkraft');
  await seite.selectOption('#plan-auswahl', l.id);
  assert.equal(await seite.locator('#plan-raster-rahmen .karte').count(), d.plan.regelplan.filter((s) => s.lehrkraefte.includes(l.id)).length);
  const r = d.raeume.find((x) => x.typ === 'turnhalle');
  await seite.click('#ansicht-raum');
  await seite.selectOption('#plan-auswahl', r.id);
  assert.equal(await seite.locator('#plan-raster-rahmen .karte').count(), d.plan.regelplan.filter((s) => s.raum === r.id).length);
});

test('Druckansicht: je Klasse und für alle Klassen, nur der Druckbereich wird gedruckt', async () => {
  await oeffne('ueberhang');
  const d = await daten();
  assert.equal(await seite.evaluate(() => window.Stundenplan.PlanReiter.druckvorbereitung(false)), 1);
  assert.equal(await seite.evaluate(() => window.Stundenplan.PlanReiter.druckvorbereitung(true)), d.klassen.length);
  assert.equal(await seite.locator('#druckbereich .druckseite').count(), d.klassen.length);
  assert.equal(await seite.locator('#druckbereich [draggable]').count(), 0, 'keine Bedienelemente im Druck');
  await seite.emulateMedia({ media: 'print' });
  assert.equal(await seite.isVisible('#druckbereich'), true);
  assert.equal(await seite.isVisible('#app'), false);
  assert.match(await seite.textContent('#druckbereich h2'), /Stundenplan Klasse/);
  await seite.emulateMedia({ media: 'screen' });
  assert.equal(await seite.isVisible('#druckbereich'), false);
  await seite.click('#ansicht-lehrkraft');
  assert.equal(await seite.evaluate(() => window.Stundenplan.PlanReiter.druckvorbereitung(true)), d.lehrkraefte.length);
});

test('Reaktionszeit: Verschieben im großen Plan (30 Klassen) unter 100 ms', async () => {
  await oeffne('gross');
  const zeiten = await seite.evaluate(() => {
    const { App, PlanReiter } = window.Stundenplan;
    const ergebnis = [];
    for (let n = 0; n < 5; n++) {
      const d = App.zustand.daten;
      const k = d.klassen[n];
      const a = d.plan.regelplan.findIndex((s) => s.klasse === k.id && s.tag === 'Mo' && s.stunde === 1);
      const t0 = performance.now();
      PlanReiter.fuehreAus({ art: 'stunde', index: a, tag: 'Mo', stunde: 2 });
      ergebnis.push(performance.now() - t0);
    }
    return ergebnis.sort((x, y) => x - y);
  });
  assert.ok(zeiten[2] < 100, `Median ${zeiten[2].toFixed(1)} ms`);
});
