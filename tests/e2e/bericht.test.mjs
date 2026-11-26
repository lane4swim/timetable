/* Ende-zu-Ende: Reiter „Bericht“ (M7) und Barrierefreiheit über alle Reiter
 * (zugängliche Namen, kein waagerechtes Scrollen bei 1280 px, Tastaturfokus). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ZIEL } from '../../tools/build.mjs';
import { ladeKern } from '../hilfe/lade-kern.mjs';
import { datensatz } from '../hilfe/beispiele.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const K = ladeKern();
const MO = '2026-11-16';

// Vollständiger Stand: Regelplan, Abwesenheit, übernommene Vertretungen
const z = datensatz('klein');
{
  const r = K.Planer.plane(z);
  z.plan.regelplan = r.plan.regelplan;
  z.plan.aufsichten = r.plan.aufsichten;
  z.lehrkraefte[1].abwesenheiten = [{ von: MO, bis: '2026-11-17', grund: 'krank' }];
  for (const v of K.Vertretung.vorschlaege(z, MO, '2026-11-20')) K.Vertretung.uebernehmen(z, v);
}

let browser;
let seite;
const fehler = [];
before(async () => {
  browser = await chromium.launch();
  seite = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  seite.on('pageerror', (e) => fehler.push(String(e)));
  seite.on('console', (m) => { if (m.type() === 'error') fehler.push(m.text()); });
  await seite.goto(pathToFileURL(ZIEL).href);
  await seite.evaluate((x) => window.Stundenplan.App.setzeDaten(x, { beschreibung: 'Testdaten' }), z);
});
after(async () => { await browser?.close(); });

test('Bericht: Überblick, Ausfall, Vertretungsquote, Auslastung, weiche Regeln', async () => {
  await seite.click('#reiter-bericht');
  await seite.fill('#bericht-von', MO);
  await seite.dispatchEvent('#bericht-von', 'change');
  await seite.fill('#bericht-bis', '2026-11-20');
  await seite.dispatchEvent('#bericht-bis', 'change');
  const b = K.Bericht.erstelle(z, MO, '2026-11-20');
  const feld = (name) => seite.textContent(`#bericht-ueberblick dd[data-feld="${name}"]`);
  assert.match(await feld('Regelplan'), /✓ gültig/);
  assert.equal(await feld('Vertretungsfälle'), String(b.vertretung.faelle));
  assert.match(await feld('Vertretungsquote'), new RegExp(`${Math.round(b.vertretung.quote * 1000) / 10} %`));
  assert.equal(await feld('Ausfallstunden im Zeitraum'), String(b.vertretung.ausfallStunden));
  assert.equal(await seite.locator('#bericht-auslastung tbody tr').count(), z.lehrkraefte.length);
  assert.equal(await seite.locator('#bericht-weich tbody tr').count(), 13);
  assert.equal(await seite.locator('#bericht-ausfall-zeitraum tbody tr').count(), Math.max(1, b.vertretung.ausfall.length));
  // Druck
  await seite.evaluate(() => { window.print = () => {}; });
  await seite.click('#bericht-drucken');
  assert.match(await seite.textContent('#druckbereich h2'), /^Bericht/);
  assert.deepEqual(fehler, []);
});

test('Barrierefreiheit: alle Bedienelemente haben einen Namen, keine waagerechte Rollleiste bei 1280 px', async () => {
  for (const reiter of ['stammdaten', 'zuordnung', 'planung', 'plan', 'ausfall', 'bericht', 'daten']) {
    await seite.click('#reiter-' + reiter);
    if (reiter === 'stammdaten') {
      for (const b of ['lehrkraefte', 'faecher', 'raeume', 'klassen', 'zeitraster', 'schule']) {
        await seite.click('#stamm-' + b);
        assert.deepEqual(await ohneNamen(), [], `Stammdaten/${b}`);
      }
    }
    if (reiter === 'plan') {
      for (const a of ['klasse', 'lehrkraft', 'raum', 'aufsicht']) { await seite.click('#ansicht-' + a); assert.deepEqual(await ohneNamen(), [], `Plan/${a}`); }
    }
    assert.deepEqual(await ohneNamen(), [], reiter);
    const breite = await seite.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(breite <= 1280, `${reiter}: Seite ist ${breite} px breit`);
  }
  assert.deepEqual(fehler, []);
});

test('Tastatur: Fokus ist sichtbar und alle Reiter sind ohne Maus erreichbar', async () => {
  await seite.click('#reiter-daten');
  await seite.keyboard.press('Home');
  assert.equal(await seite.evaluate(() => document.activeElement.id), 'reiter-stammdaten');
  const rahmen = await seite.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.equal(rahmen, 'solid');
  for (let i = 0; i < 6; i++) await seite.keyboard.press('ArrowRight');
  assert.equal(await seite.evaluate(() => document.activeElement.id), 'reiter-daten');
  await seite.keyboard.press('Tab');
  assert.equal(await seite.evaluate(() => document.activeElement.id), 'panel-daten', 'Tab führt in den Inhalt des Reiters');
});

/** Sichtbare Bedienelemente ohne zugänglichen Namen. */
function ohneNamen() {
  return seite.evaluate(() => {
    const sichtbar = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) && getComputedStyle(e).visibility !== 'hidden';
    const name = (e) => {
      if (e.getAttribute('aria-label')?.trim()) return true;
      const ids = e.getAttribute('aria-labelledby');
      if (ids && ids.split(/\s+/).some((id) => document.getElementById(id)?.textContent.trim())) return true;
      if (e.labels && [...e.labels].some((l) => l.textContent.trim())) return true;
      if ((e.tagName === 'BUTTON' || e.tagName === 'SUMMARY') && e.textContent.trim()) return true;
      if (e.title?.trim()) return true;
      return false;
    };
    return [...document.querySelectorAll('#app input, #app select, #app textarea, #app button, header button')]
      .filter((e) => sichtbar(e) && e.type !== 'hidden' && !name(e))
      .slice(0, 5).map((e) => e.outerHTML.slice(0, 120));
  });
}
