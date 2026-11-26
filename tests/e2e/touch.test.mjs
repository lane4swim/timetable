/* Ende-zu-Ende: Plan-Ansicht auf dem Touchscreen (Rückmeldung: Drag-and-drop
 * funktionierte in Safari auf dem Touchscreen nicht). Geprüft in Chromium mit
 * Touch-Emulation: Antippen + Ziel antippen, Gedrückt halten + ziehen, kurzes
 * Wischen scrollt (kein Verschieben), Lehrkraft-Chip als Zweitbesetzung. */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ZIEL } from '../../tools/build.mjs';
import { ladeKern } from '../hilfe/lade-kern.mjs';
import { datensatz } from '../hilfe/beispiele.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const K = ladeKern();
const z = datensatz('ueberhang');
{ const r = K.Planer.plane(z); z.plan.regelplan = r.plan.regelplan; z.plan.aufsichten = r.plan.aufsichten; }

let browser;
let kontext;
let seite;
let cdp;
const fehler = [];
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
beforeEach(async () => {
  await kontext?.close();
  kontext = await browser.newContext({ hasTouch: true, viewport: { width: 1280, height: 1000 } });
  seite = await kontext.newPage();
  seite.on('pageerror', (e) => fehler.push(String(e)));
  await seite.goto(pathToFileURL(ZIEL).href);
  await seite.evaluate((x) => window.Stundenplan.App.setzeDaten(x, { beschreibung: 'Testdaten' }), z);
  await seite.locator('#reiter-plan').tap();
  cdp = await kontext.newCDPSession(seite);
});

const daten = () => seite.evaluate(() => window.Stundenplan.App.zustand.daten);
const zelle = (tag, stunde) => seite.locator(`#plan-raster-rahmen td[data-tag="${tag}"][data-stunde="${stunde}"]`);
const index = async (tag, stunde) => Number(await zelle(tag, stunde).locator('.karte').first().getAttribute('data-index'));
/** Punkt links oben in einer Karte (nicht auf dem ×-Knopf). */
async function punktIn(locator, dx = 10, dy = 8) {
  const b = await locator.boundingBox();
  return { x: b.x + dx, y: b.y + dy };
}
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
async function beruehre(typ, punkte) {
  await cdp.send('Input.dispatchTouchEvent', { type: typ, touchPoints: punkte.map((p) => ({ x: p.x, y: p.y })) });
}

test('Antippen, dann Ziel antippen: Stunde wird verschoben (Tausch in der Klasse)', async () => {
  const a = await index('Mo', 1);
  const b = await index('Mo', 3);
  const p = await punktIn(zelle('Mo', 1).locator('.karte').first());
  await seite.touchscreen.tap(p.x, p.y);
  assert.match(await seite.textContent('#plan-ansage'), /Stunde aufgenommen – jetzt das Ziel antippen/);
  assert.equal(await seite.locator('.karte.aufgenommen').count(), 1, 'aufgenommene Karte ist markiert');
  const q = await punktIn(zelle('Mo', 3));
  await seite.touchscreen.tap(q.x, q.y);
  const plan = (await daten()).plan.regelplan;
  assert.deepEqual([plan[a].stunde, plan[b].stunde], [3, 1]);
  assert.match(await seite.textContent('#plan-ansage'), /Mo 1\. → Mo 3\./);
  assert.deepEqual(fehler, []);
});

test('nochmals antippen bricht ab', async () => {
  const p = await punktIn(zelle('Di', 2).locator('.karte').first());
  await seite.touchscreen.tap(p.x, p.y);
  await seite.touchscreen.tap(p.x, p.y);
  assert.match(await seite.textContent('#plan-ansage'), /Abgebrochen/);
  assert.equal(await seite.locator('.karte.aufgenommen').count(), 0);
  assert.equal((await daten()).plan.regelplan.length, z.plan.regelplan.length);
});

test('Gedrückt halten und ziehen verschiebt die Stunde; Vorschau folgt dem Finger', async () => {
  const a = await index('Mi', 1);
  const start = await punktIn(zelle('Mi', 1).locator('.karte').first());
  const ziel = await punktIn(zelle('Mi', 4), 30, 20);
  await beruehre('touchStart', [start]);
  await warte(450);
  assert.equal(await seite.locator('.geist').count(), 1, 'Vorschau erscheint nach dem Halten');
  for (let i = 1; i <= 8; i++) {
    await beruehre('touchMove', [{ x: start.x + ((ziel.x - start.x) * i) / 8, y: start.y + ((ziel.y - start.y) * i) / 8 }]);
    await warte(15);
  }
  assert.equal(await zelle('Mi', 4).getAttribute('class').then((c) => c.includes('ziel')), true, 'Zielzelle hervorgehoben');
  await beruehre('touchEnd', []);
  await warte(50);
  const plan = (await daten()).plan.regelplan;
  assert.deepEqual([plan[a].tag, plan[a].stunde], ['Mi', 4]);
  assert.equal(await seite.locator('.geist').count(), 0, 'Vorschau entfernt');
  assert.equal(await seite.locator('td.ziel').count(), 0);
});

test('kurzes Wischen ohne Halten verschiebt nichts (Seite darf scrollen)', async () => {
  const vorher = JSON.stringify((await daten()).plan.regelplan);
  const start = await punktIn(zelle('Do', 1).locator('.karte').first());
  await beruehre('touchStart', [start]);
  for (let i = 1; i <= 5; i++) { await beruehre('touchMove', [{ x: start.x, y: start.y + i * 30 }]); await warte(10); }
  await beruehre('touchEnd', []);
  await warte(450);
  assert.equal(await seite.locator('.geist').count(), 0);
  assert.equal(JSON.stringify((await daten()).plan.regelplan), vorher);
});

test('Lehrkraft aus „Freie Kontingente“ antippen, dann Stunde antippen → Zweitbesetzung', async () => {
  const d = await daten();
  const k = d.klassen[0];
  const s = d.plan.regelplan.find((x) => x.klasse === k.id && x.lehrkraefte.length === 1);
  if (!s || !(await seite.locator('#plan-frei .chip').count())) return; // nichts frei → Fall nicht prüfbar
  const chip = seite.locator('#plan-frei .chip').first();
  const lehrkraft = await chip.getAttribute('data-lehrkraft');
  await chip.tap();
  assert.match(await seite.textContent('#plan-ansage'), /aufgenommen – Zielzelle antippen/);
  const p = await punktIn(zelle(s.tag, s.stunde).locator('.karte').first());
  await seite.touchscreen.tap(p.x, p.y);
  const neu = (await daten()).plan.regelplan.find((x) => x.klasse === k.id && x.tag === s.tag && x.stunde === s.stunde);
  assert.deepEqual(neu.lehrkraefte, [s.lehrkraefte[0], lehrkraft]);
});

test('Aufsicht per Halten und Ziehen in eine andere Pause', async () => {
  await seite.locator('#ansicht-aufsicht').tap();
  const p = (await daten()).zeitraster.pausen;
  const chip = seite.locator(`#plan-raster-rahmen td[data-tag="Mo"][data-pause="${p[0].vorStunde}"] .chip`).first();
  const i = Number(await chip.getAttribute('data-aufsicht'));
  // Zielpause, in der diese Lehrkraft noch keine Aufsicht hat
  const alle = (await daten()).plan.aufsichten;
  const l = alle[i].lehrkraft;
  const [zielTag, zielPause] = ['Fr', 'Do', 'Mi', 'Di'].flatMap((t) => p.map((x) => [t, x.vorStunde]))
    .find(([t, v]) => !alle.some((x) => x.lehrkraft === l && x.tag === t && x.vorStunde === v));
  const start = await punktIn(chip, 8, 6);
  const ziel = await punktIn(seite.locator(`#plan-raster-rahmen td[data-tag="${zielTag}"][data-pause="${zielPause}"]`), 40, 10);
  await beruehre('touchStart', [start]);
  await warte(450);
  for (let n = 1; n <= 6; n++) { await beruehre('touchMove', [{ x: start.x + ((ziel.x - start.x) * n) / 6, y: start.y + ((ziel.y - start.y) * n) / 6 }]); await warte(15); }
  await beruehre('touchEnd', []);
  await warte(50);
  const a = (await daten()).plan.aufsichten[i];
  assert.deepEqual([a.tag, a.vorStunde], [zielTag, zielPause], await seite.textContent('#plan-ansage'));
});
