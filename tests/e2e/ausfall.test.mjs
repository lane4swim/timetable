/* Ende-zu-Ende: Reiter „Ausfall“ (M6) – Abwesenheit erfassen, Vorschläge
 * prüfen, übernehmen, ändern, verwerfen; Tagesvertretungsplan mit Konflikten
 * und Ausfallbericht; Rückgängig; Druck. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ZIEL } from '../../tools/build.mjs';
import { ladeKern } from '../hilfe/lade-kern.mjs';
import { datensatz } from '../hilfe/beispiele.mjs';
import { miniSchule } from '../hilfe/mini.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const K = ladeKern();
const ueberhang = datensatz('ueberhang');
{ const r = K.Planer.plane(ueberhang); ueberhang.plan.regelplan = r.plan.regelplan; ueberhang.plan.aufsichten = r.plan.aufsichten; }

let browser;
let seite;
let fehler = [];
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
async function oeffne(zustand) {
  await seite?.close();
  seite = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  fehler = [];
  seite.on('pageerror', (e) => fehler.push(String(e)));
  seite.on('console', (m) => { if (m.type() === 'error') fehler.push(m.text()); });
  await seite.goto(pathToFileURL(ZIEL).href);
  await seite.evaluate((z) => window.Stundenplan.App.setzeDaten(z, { beschreibung: 'Testdaten' }), zustand);
  await seite.click('#reiter-ausfall');
}
const daten = () => seite.evaluate(() => window.Stundenplan.App.zustand.daten);
async function erfasse(art, id, von, bis = von) {
  await seite.selectOption('#abw-art', art);
  await seite.selectOption('#abw-wer', id);
  await seite.fill('#abw-von', von);
  await seite.fill('#abw-bis', bis);
  await seite.fill('#abw-grund', 'krank');
  await seite.click('#abw-erfassen');
}

test('Abwesenheit erfassen → Vorschläge in der Reihenfolge der Kette, Übernehmen, Tagesplan', async () => {
  await oeffne(miniSchule());
  await erfasse('lehrkraft', 'l-a', '2026-11-16');
  assert.match(await seite.textContent('#abw-meldung'), /Abwesenheit A vom 2026-11-16 bis 2026-11-16 erfasst/);
  assert.deepEqual((await daten()).lehrkraefte[0].abwesenheiten, [{ von: '2026-11-16', bis: '2026-11-16', grund: 'krank' }]);
  assert.equal(await seite.locator('#abw-liste tbody tr').count(), 1);
  const zeilen = seite.locator('#vs-tabelle tbody tr');
  assert.equal(await zelle(zeilen, 0), 'Pausenaufsicht', 'Frühaufsicht zuerst');
  assert.match(await seite.textContent('#vs-tabelle'), /Stufe 3: Vertretung durch Lehrkraft der Klasse/);
  assert.match(await seite.textContent('#vs-status'), /3 Vorschläge für 2026-11-16 bis 2026-11-16/);
  // Datum des Tagesplans folgt dem Zeitraum
  assert.match(await seite.textContent('#tag-vertretungen caption'), /Vertretungen am Mo, 2026-11-16 \(0\)/);
  assert.match(await seite.textContent('#tag-pruefung'), /3 betroffene Stunde\(n\)\/Aufsicht\(en\) sind noch nicht vertreten/);
  // Ersten Stunden-Vorschlag übernehmen
  await seite.locator('#vs-tabelle tbody tr', { hasText: '1a' }).first().locator('[data-aktion="uebernehmen"]').click();
  assert.equal((await daten()).plan.vertretungen.length, 1);
  assert.equal(await seite.locator('#vs-tabelle tbody tr').count(), 2, 'übernommener Vorschlag verschwindet');
  assert.equal(await seite.locator('#tag-vertretungen tbody tr').count(), 1);
  assert.match(await seite.getAttribute('#knopf-rueckgaengig', 'title'), /Vertretung übernommen/);
  // Rest übernehmen → Tagesplan ohne Verstöße
  await seite.click('#vs-alle');
  assert.match(await seite.textContent('#vs-status'), /2 Vorschläge übernommen.*nichts \(mehr\) zu vertreten/);
  assert.match(await seite.textContent('#tag-pruefung'), /✓ Tagesplan ohne Verstöße/);
  assert.equal(await seite.locator('#tag-aufsichten tbody tr').count(), 1);
  // Regelplan unverändert
  assert.deepEqual((await daten()).plan.regelplan, miniSchule().plan.regelplan);
  assert.deepEqual(fehler, []);
});

async function zelle(zeilen, i) { return (await zeilen.nth(i).locator('th').textContent()).trim(); }

test('Andere Lösung wählen und Verwerfen', async () => {
  await oeffne(miniSchule());
  await erfasse('lehrkraft', 'l-a', '2026-11-16');
  const zeile = seite.locator('#vs-tabelle tbody tr', { hasText: '1a' }).nth(1); // 1a Mo 2
  await zeile.locator('summary').click();
  const auswahl = zeile.locator('select.vs-auswahl');
  const optionen = await auswahl.locator('option').allTextContents();
  assert.ok(optionen.length >= 2);
  assert.match(optionen[0], /^★ Stufe 3/);
  const index = optionen.findIndex((o) => /Stufe [4-7]/.test(o));
  await auswahl.selectOption(String(index));
  assert.match(await zeile.textContent(), new RegExp(optionen[index].match(/Stufe \d/)[0]));
  await zeile.locator('[data-aktion="uebernehmen"]').click();
  const v = (await daten()).plan.vertretungen.find((x) => x.klasse === 'k-1a' && x.stunde === 2);
  assert.ok(v);
  assert.notDeepEqual(v.lehrkraefte, ['l-b'], 'nicht die Standardlösung');
  // Verwerfen blendet aus, bis neu berechnet wird
  const vorher = await seite.locator('#vs-tabelle tbody tr').count();
  await seite.locator('#vs-tabelle tbody tr').first().locator('[data-aktion="verwerfen"]').click();
  assert.equal(await seite.locator('#vs-tabelle tbody tr').count(), vorher - 1);
  assert.match(await seite.textContent('#vs-status'), /verworfene Vorschläge ausgeblendet|Vorschlag/);
  await seite.click('#vs-berechnen');
  assert.equal(await seite.locator('#vs-tabelle tbody tr').count(), vorher);
});

test('Ausfall in der Tagesmitte: Nachrücken, Ausfallbericht mit Grund, Rückgängig', async () => {
  const z = miniSchule();
  z.lehrkraefte[3].abwesenheiten = [{ von: '2026-11-16', bis: '2026-11-16', grund: '' }];
  Object.assign(z.lehrkraefte[1], { sollStunden: 2, minStunden: 0, maxStunden: 2 });
  await oeffne(z);
  await erfasse('lehrkraft', 'l-a', '2026-11-16');
  assert.match(await seite.textContent('#vs-tabelle'), /Stufe 7: Entfall, Nachrücken oder Aufsicht/);
  await seite.click('#vs-alle');
  assert.match(await seite.textContent('#tag-ausfall'), /3\. Stunde 1a MA: entfällt – Folgende Stunden nachgerückt/);
  assert.match(await seite.textContent('#tag-pruefung'), /✓ Tagesplan ohne Verstöße/);
  await seite.click('#knopf-rueckgaengig');
  assert.equal((await daten()).plan.vertretungen.length, 0);
});

test('Raumausfall: Ersatzraum; Vertretung im Tagesplan entfernen', async () => {
  await oeffne(miniSchule());
  await erfasse('raum', 'r-a', '2026-11-16');
  assert.match(await seite.textContent('#vs-tabelle'), /Stufe 1: Ersatzraum/);
  await seite.click('#vs-alle');
  assert.equal(await seite.locator('#tag-vertretungen tbody tr').count(), 2);
  assert.match(await seite.textContent('#tag-vertretungen'), /Raumausfall – Ersatzraum/);
  await seite.locator('#tag-vertretungen tbody tr').first().locator('button').click();
  assert.equal((await daten()).plan.vertretungen.length, 1);
  assert.match(await seite.textContent('#tag-pruefung'), /noch nicht vertreten|Konflikt/);
});

test('Datensatz Überhang: Zweitbesetzungen rücken auf, kein Ausfall; Druck des Tagesplans', async () => {
  await oeffne(ueberhang);
  const lehrkraft = ueberhang.zuordnungen.find((x) => x.rolle === 'haupt').lehrkraft;
  await erfasse('lehrkraft', lehrkraft, '2026-11-16', '2026-11-18');
  await seite.click('#vs-alle');
  assert.match(await seite.textContent('#tag-pruefung'), /✓ Tagesplan ohne Verstöße/);
  const d = await daten();
  assert.ok(d.plan.vertretungen.length > 0);
  assert.ok(d.plan.vertretungen.every((v) => v.status !== 'entfaellt'), 'kein Ausfall bei Überhang');
  assert.ok(d.plan.vertretungen.some((v) => v.grund === 'zweitbesetzungRueckt'));
  await seite.evaluate(() => { window.print = () => {}; });
  await seite.click('#tag-drucken');
  assert.match(await seite.textContent('#druckbereich h2'), /Vertretungsplan Mo, 2026-11-16/);
  assert.equal(await seite.locator('#druckbereich button').count(), 0);
  assert.deepEqual(fehler, []);
});

test('ungültige Eingaben werden abgewiesen', async () => {
  await oeffne(miniSchule());
  await erfasse('lehrkraft', 'l-a', '2026-11-18', '2026-11-16');
  assert.match(await seite.textContent('#abw-meldung'), /Ende liegt vor dem Beginn/);
  assert.equal((await daten()).lehrkraefte[0].abwesenheiten.length, 0);
});
