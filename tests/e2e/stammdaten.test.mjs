/* Ende-zu-Ende: Reiter „Stammdaten“ und „Zuordnung“ (M3) – Bearbeiten mit
 * sofortiger Prüfung, Hinzufügen, Löschen mit Verweisliste, Tastatur,
 * Rückgängig/Wiederholen. */
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
  await seite.click('#reiter-daten');
  await seite.setInputFiles('#daten-datei', join(DATEN, 'klein.json'));
  await seite.locator('#daten-meldungen .meldung', { hasText: 'Importiert' }).waitFor();
  await seite.click('#reiter-stammdaten');
});

const daten = () => seite.evaluate(() => window.Stundenplan.App.zustand.daten);
const zelle = (tabelle, zeile, spalte) => seite.locator(`#${tabelle} [data-zeile="${zeile}"][data-spalte="${spalte}"]`);
async function eingeben(locator, wert) {
  await locator.fill(wert);
  await locator.press('Tab');
}

test('Lehrkraft bearbeiten, rückgängig machen und wiederholen', async () => {
  const id = (await daten()).lehrkraefte[0].id;
  await eingeben(zelle('tabelle-lehrkraefte', id, 'name'), 'Anna Neu');
  assert.equal((await daten()).lehrkraefte[0].name, 'Anna Neu');
  assert.match(await seite.getAttribute('#knopf-rueckgaengig', 'title'), /Rückgängig: Lehrkraft .*Name geändert/);
  await seite.click('#knopf-rueckgaengig');
  assert.notEqual((await daten()).lehrkraefte[0].name, 'Anna Neu');
  assert.equal(await zelle('tabelle-lehrkraefte', id, 'name').inputValue(), (await daten()).lehrkraefte[0].name, 'Tabelle zeigt den alten Stand');
  await seite.click('#knopf-wiederholen');
  assert.equal((await daten()).lehrkraefte[0].name, 'Anna Neu');
  // Tastenkürzel außerhalb von Eingabefeldern
  await seite.click('#panel-stammdaten h2');
  await seite.keyboard.press('Control+z');
  assert.notEqual((await daten()).lehrkraefte[0].name, 'Anna Neu');
  await seite.keyboard.press('Control+y');
  assert.equal((await daten()).lehrkraefte[0].name, 'Anna Neu');
  assert.deepEqual(fehler, []);
});

test('mindestens 50 Schritte rückgängig', async () => {
  const id = (await daten()).lehrkraefte[0].id;
  const feld = zelle('tabelle-lehrkraefte', id, 'aufsichtenProWoche');
  for (let i = 0; i < 55; i++) await eingeben(feld, String(i % 10 === 9 ? 0 : (i % 10) + 1));
  let schritte = 0;
  while (await seite.isEnabled('#knopf-rueckgaengig') && schritte < 200) { await seite.click('#knopf-rueckgaengig'); schritte++; }
  assert.ok(schritte >= 56, `nur ${schritte} Schritte`); // 55 Eingaben + Import
});

test('sofortige Prüfung: Zahlenbereich, Pflichtfeld, doppeltes Kürzel, Querprüfung', async () => {
  const [a, b] = (await daten()).lehrkraefte;
  const soll = zelle('tabelle-lehrkraefte', a.id, 'sollStunden');
  await eingeben(soll, 'viel');
  assert.equal(await soll.getAttribute('aria-invalid'), 'true');
  assert.match(await seite.textContent('#stamm-bereich-lehrkraefte .meldungen'), /Bitte eine Zahl eingeben \(0–40\)/);
  assert.equal((await daten()).lehrkraefte[0].sollStunden, a.sollStunden);

  await eingeben(zelle('tabelle-lehrkraefte', a.id, 'name'), '   ');
  assert.match(await seite.textContent('#stamm-bereich-lehrkraefte .meldungen'), /Name ist ein Pflichtfeld/);

  await eingeben(zelle('tabelle-lehrkraefte', b.id, 'kuerzel'), a.kuerzel.toLowerCase());
  assert.match(await seite.textContent('#stamm-bereich-lehrkraefte .meldungen'), /Kürzel .* ist bereits in lehrkraefte\[0\] vergeben/);

  await eingeben(zelle('tabelle-lehrkraefte', a.id, 'minStunden'), '40');
  assert.match(await seite.textContent('#stamm-bereich-lehrkraefte .meldungen'), /lehrkraefte\[0\]\.minStunden.*über Sollstunden/);
  assert.equal((await daten()).lehrkraefte[0].minStunden, a.minStunden);

  // Esc verwirft die Eingabe
  const feld = zelle('tabelle-lehrkraefte', a.id, 'maxStunden');
  await feld.fill('99');
  await feld.press('Escape');
  assert.equal(await zelle('tabelle-lehrkraefte', a.id, 'maxStunden').inputValue(), String(a.maxStunden));
});

test('Sperrzeiten als Kurzschreibweise', async () => {
  const a = (await daten()).lehrkraefte[0];
  await eingeben(zelle('tabelle-lehrkraefte', a.id, 'gesperrt'), 'fr 5-6; Mo 1, 3');
  assert.deepEqual((await daten()).lehrkraefte[0].gesperrt, [{ tag: 'Fr', stunden: [5, 6] }, { tag: 'Mo', stunden: [1, 3] }]);
  await eingeben(zelle('tabelle-lehrkraefte', a.id, 'gesperrt'), 'Fr 9');
  assert.match(await seite.textContent('#stamm-bereich-lehrkraefte .meldungen'), /Stunde 9 gibt es im Zeitraster nicht/);
});

test('Tastatur: Enter übernimmt und springt in dieselbe Spalte der nächsten Zeile', async () => {
  const [a, b] = (await daten()).lehrkraefte;
  const feld = zelle('tabelle-lehrkraefte', a.id, 'sollStunden');
  await feld.fill(String(a.sollStunden - 1));
  await feld.press('Enter');
  assert.equal((await daten()).lehrkraefte[0].sollStunden, a.sollStunden - 1);
  assert.deepEqual(await seite.evaluate(() => [document.activeElement.dataset.zeile, document.activeElement.dataset.spalte]), [b.id, 'sollStunden']);
  await seite.keyboard.press('ArrowUp');
  assert.equal(await seite.evaluate(() => document.activeElement.dataset.zeile), a.id);
});

test('Hinzufügen und Löschen; Löschen blockiert bei Verweisen (mit Liste)', async () => {
  await seite.click('#stamm-bereich-lehrkraefte [data-aktion="neu"]');
  let d = await daten();
  assert.equal(d.lehrkraefte.length, 6);
  const neu = d.lehrkraefte[5];
  assert.equal(await seite.evaluate(() => document.activeElement.dataset.spalte), 'name', 'Fokus im neuen Namen');
  await seite.click(`#tabelle-lehrkraefte tr[data-schluessel="${neu.id}"] [data-aktion="loeschen"]`);
  assert.equal((await daten()).lehrkraefte.length, 5);

  const benutzt = d.lehrkraefte[0];
  await seite.click(`#tabelle-lehrkraefte tr[data-schluessel="${benutzt.id}"] [data-aktion="loeschen"]`);
  const text = await seite.textContent('#stamm-bereich-lehrkraefte .meldungen');
  assert.match(text, /kann nicht gelöscht werden – \d+ Verweis\(e\)/);
  assert.match(text, /Klasse \w+: klassenlehrkraft|Zuordnung/);
  assert.equal((await daten()).lehrkraefte.length, 5);
});

test('Räume: Fachraum mit Typ, Nachbarräume symmetrisch', async () => {
  await seite.click('#stamm-raeume');
  const [r1, r2, r3] = (await daten()).raeume;
  await zelle('tabelle-raeume', r3.id, 'typ').selectOption('fachraum');
  assert.equal((await daten()).raeume[2].fachraumtyp, 'fachraum');
  await eingeben(zelle('tabelle-raeume', r3.id, 'fachraumtyp'), 'nawi');
  assert.equal((await daten()).raeume[2].fachraumtyp, 'nawi');
  await eingeben(zelle('tabelle-raeume', r1.id, 'nahe'), `${r3.name}`);
  const raeume = (await daten()).raeume;
  assert.deepEqual(raeume[0].nahe, [r3.id]);
  assert.ok(raeume[2].nahe.includes(r1.id), 'Gegenseite eingetragen');
  assert.ok(!raeume[1].nahe.includes(r1.id), 'alte Nachbarschaft entfernt');
  assert.equal(r2.nahe.includes(r1.id), true);
});

test('Klassen: Klassenlehrkraft und Heimatraum per Auswahl', async () => {
  await seite.click('#stamm-klassen');
  const d = await daten();
  const k = d.klassen[0];
  await zelle('tabelle-klassen', k.id, 'klassenlehrkraft').selectOption(d.lehrkraefte[4].id);
  assert.equal((await daten()).klassen[0].klassenlehrkraft, d.lehrkraefte[4].id);
  await zelle('tabelle-klassen', k.id, 'heimatraum').selectOption('');
  assert.equal((await daten()).klassen[0].heimatraum, null);
});

test('Zeitraster: Stunde anhängen, Pause setzen, letzte Stunde entfernen, Tag in Gebrauch', async () => {
  await seite.click('#stamm-zeitraster');
  await seite.click('#stamm-bereich-zeitraster [data-aktion="neu"]');
  let z = (await daten()).zeitraster;
  assert.equal(z.stunden.length, 7);
  assert.equal(z.stunden[6].von, '13:30');
  await zelle('tabelle-zeitraster', '7', 'pause').check();
  await eingeben(zelle('tabelle-zeitraster', '7', 'aufsichten'), '4');
  z = (await daten()).zeitraster;
  assert.deepEqual(z.pausen.find((p) => p.vorStunde === 7), { vorStunde: 7, name: 'Pause', aufsichten: 4 });
  await eingeben(zelle('tabelle-zeitraster', '3', 'bis'), '9:50');
  assert.match(await seite.textContent('#stamm-bereich-zeitraster .tabellen-block .meldungen'), /Ende muss nach dem Beginn liegen|beginnt vor dem Ende/);
  await seite.click('#tabelle-zeitraster tr[data-schluessel="3"] [data-aktion="loeschen"]');
  assert.match(await seite.textContent('#stamm-bereich-zeitraster .tabellen-block .meldungen'), /Nur die letzte Stunde/);
  await seite.click('#tabelle-zeitraster tr[data-schluessel="7"] [data-aktion="loeschen"]');
  z = (await daten()).zeitraster;
  assert.equal(z.stunden.length, 6);
  assert.ok(!z.pausen.some((p) => p.vorStunde === 7));
  // Mittwoch wird von einer Abwesenheit nicht blockiert, aber ein Regelplan nutzt ihn
  await seite.evaluate(() => window.Stundenplan.App.aendere('Testplan', (d) => {
    const k = d.klassen[0];
    const z = d.zuordnungen.find((x) => x.klasse === k.id && x.rolle === 'haupt');
    d.plan.regelplan.push({ klasse: k.id, fach: z.fach, lehrkraefte: [z.lehrkraft], raum: k.heimatraum, tag: 'Mi', stunde: 1, status: 'regulaer' });
  }));
  await seite.click('#stamm-tage input[data-tag="Mi"]'); // wird abgelehnt und zurückgesetzt
  assert.match(await seite.textContent('#stamm-tage-meldung'), /Mi kann nicht entfernt werden/);
  assert.ok((await daten()).zeitraster.tage.includes('Mi'));
  assert.equal(await seite.isChecked('#stamm-tage input[data-tag="Mi"]'), true);
});

test('Zuordnung: Stunden, Haupt- und Zweitlehrkraft, Soll/Ist, Warnungen', async () => {
  await seite.click('#reiter-zuordnung');
  const d = await daten();
  const k = d.klassen[0];
  const de = d.faecher.find((f) => f.kuerzel === 'DE');
  const ku = d.faecher.find((f) => f.kuerzel === 'KU');
  const feld = (fach, art) => seite.locator(`#zuordnung-matrix [data-zeile="${k.id}"][data-spalte="${fach.id}|${art}"]`);
  // Zweitlehrkraft setzen
  const zweit = d.lehrkraefte.find((l) => l.id !== d.zuordnungen.find((z) => z.klasse === k.id && z.fach === de.id).lehrkraft);
  await eingeben(feld(de, 'zweit'), zweit.kuerzel.toLowerCase());
  assert.ok((await daten()).zuordnungen.some((z) => z.klasse === k.id && z.fach === de.id && z.rolle === 'zweit' && z.lehrkraft === zweit.id));
  assert.match(await seite.textContent(`#zuordnung-soll-ist tr[data-lehrkraft="${zweit.id}"]`), /\d/);
  // Unbekanntes Kürzel
  await eingeben(feld(de, 'haupt'), 'QQQ');
  assert.match(await seite.textContent('#zuordnung-meldung'), /Kürzel „QQQ“ gibt es nicht/);
  // Nicht qualifizierte Hauptlehrkraft → Warnmarke H8
  const ohneKu = d.lehrkraefte.find((l) => !l.qualifikationen.some((q) => q.fach === ku.id));
  await eingeben(feld(ku, 'haupt'), ohneKu.kuerzel);
  assert.match(await seite.textContent(`#zuordnung-matrix td:has([data-spalte="${ku.id}|haupt"][data-zeile="${k.id}"])`), /⚠ H8/);
  // Stunden entfernen entfernt Fach und Zuordnungen
  await eingeben(feld(ku, 'std'), '');
  const n = await daten();
  assert.ok(!n.klassen[0].stundentafel.some((e) => e.fach === ku.id));
  assert.ok(!n.zuordnungen.some((z) => z.klasse === k.id && z.fach === ku.id));
  // Lehrkraft ohne Stunden setzen → Hinweis
  await eingeben(feld(ku, 'haupt'), ohneKu.kuerzel);
  assert.match(await seite.textContent('#zuordnung-meldung'), /Bitte zuerst Wochenstunden eintragen/);
  // Stunden wieder eintragen, Doppelstunde
  await eingeben(feld(ku, 'std'), '2');
  await seite.locator(`#zuordnung-matrix [data-zeile="${k.id}"][data-spalte="${ku.id}|doppelt"]`).check();
  assert.deepEqual((await daten()).klassen[0].stundentafel.find((e) => e.fach === ku.id), { fach: ku.id, stunden: 2, doppelt: true, tagesende: false });
  // Überschreitung der Höchstgrenze wird gewarnt
  const l = d.lehrkraefte[0];
  await seite.evaluate((id) => window.Stundenplan.App.aendere('Test', (x) => { const lk = x.lehrkraefte.find((y) => y.id === id); lk.sollStunden = 1; lk.minStunden = 0; lk.maxStunden = 1; }), l.id);
  assert.match(await seite.textContent(`#zuordnung-soll-ist tr[data-lehrkraft="${l.id}"]`), /⚠ \d+ über der Höchstgrenze \(H7\)/);
  assert.deepEqual(fehler, []);
});

test('Tab nach dem Hinzufügen einer Zeile springt Feld für Feld weiter und speichert', async () => {
  await seite.click('#stamm-bereich-lehrkraefte [data-aktion="neu"]');
  const neu = (await daten()).lehrkraefte[5];
  const fokus = () => seite.evaluate(() => [document.activeElement.dataset.zeile, document.activeElement.dataset.spalte]);
  assert.deepEqual(await fokus(), [neu.id, 'name']);
  await seite.keyboard.type('Max Muster');
  await seite.keyboard.press('Tab');
  assert.deepEqual(await fokus(), [neu.id, 'kuerzel']);
  await seite.keyboard.press('Control+a');
  await seite.keyboard.type('MUS');
  await seite.keyboard.press('Tab');
  assert.deepEqual(await fokus(), [neu.id, 'qualifikationen'], 'Verweis auf die Qualifikationsmatrix');
  await seite.keyboard.press('Tab');
  assert.deepEqual(await fokus(), [neu.id, 'sollStunden']);
  await seite.keyboard.press('Shift+Tab');
  assert.deepEqual(await fokus(), [neu.id, 'qualifikationen'], 'auch rückwärts');
  const l = (await daten()).lehrkraefte[5];
  assert.deepEqual([l.name, l.kuerzel], ['Max Muster', 'MUS']);
  // Beschriftungen folgen dem neuen Namen
  assert.equal(await seite.getAttribute(`#tabelle-lehrkraefte [data-zeile="${neu.id}"][data-spalte="kuerzel"]`, 'aria-label'), 'Kürzel – Max Muster');
});

test('Tab in der Zuordnungsmatrix behält den Fokus nach dem Speichern', async () => {
  await seite.click('#reiter-zuordnung');
  const d = await daten();
  const k = d.klassen[0];
  const fach = k.stundentafel[0].fach;
  await seite.locator(`#zuordnung-matrix [data-zeile="${k.id}"][data-spalte="${fach}|std"]`).fill('4');
  await seite.keyboard.press('Tab');
  assert.deepEqual(await seite.evaluate(() => [document.activeElement.dataset.zeile, document.activeElement.dataset.spalte]), [k.id, `${fach}|haupt`]);
  assert.equal((await daten()).klassen[0].stundentafel[0].stunden, 4);
});

test('Farben in Stammdaten wählen und zurücksetzen', async () => {
  await seite.click('#stamm-faecher');
  const f = (await daten()).faecher[0];
  const feld = seite.locator(`#tabelle-faecher [data-zeile="${f.id}"][data-spalte="farbe"]`);
  await feld.evaluate((e) => { e.value = '#ffd27f'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal((await daten()).faecher[0].farbe, '#ffd27f');
  await seite.click(`#tabelle-faecher tr[data-schluessel="${f.id}"] .farbe-zelle button`);
  assert.equal((await daten()).faecher[0].farbe, undefined);
});

test('Benötigter Raumtyp ist eine Auswahl mit Turnhalle, Schwimmhalle und Fachraumtypen', async () => {
  await seite.click('#stamm-faecher');
  const d = await daten();
  const sp = d.faecher.find((f) => f.kuerzel === 'SP');
  const de = d.faecher.find((f) => f.kuerzel === 'DE');
  const auswahl = seite.locator(`#tabelle-faecher [data-zeile="${sp.id}"][data-spalte="raumtyp"]`);
  assert.equal(await auswahl.evaluate((e) => e.tagName), 'SELECT');
  assert.equal(await auswahl.inputValue(), 'turnhalle');
  const optionen = await auswahl.locator('option').allTextContents();
  assert.ok(optionen.includes('Turnhalle'), optionen.join(' | '));
  assert.ok(optionen.some((o) => /^Schwimmhalle – ⚠ kein solcher Raum/.test(o)), 'Schwimmhalle wählbar, aber gekennzeichnet');
  assert.ok(optionen.includes('Fachraum: musik'));
  // Deutsch auf Turnhalle stellen und wieder zurück auf Klassenraum
  await seite.locator(`#tabelle-faecher [data-zeile="${de.id}"][data-spalte="raumtyp"]`).selectOption('turnhalle');
  assert.equal((await daten()).faecher.find((f) => f.id === de.id).raumtyp, 'turnhalle');
  await seite.locator(`#tabelle-faecher [data-zeile="${de.id}"][data-spalte="raumtyp"]`).selectOption('');
  assert.equal((await daten()).faecher.find((f) => f.id === de.id).raumtyp, null);
  // Großgeschriebener Wert aus einer Datei wird als „Turnhalle“ erkannt
  await seite.evaluate((id) => window.Stundenplan.App.aendere('Test', (x) => { x.faecher.find((f) => f.id === id).raumtyp = 'Turnhalle'; }), sp.id);
  assert.equal(await auswahl.inputValue(), 'turnhalle');
  assert.deepEqual(fehler, []);
});

test('Zuordnung: Option „Tagesende“ (E) neben „Doppelstunde“ (D)', async () => {
  await seite.click('#reiter-zuordnung');
  const d = await daten();
  const k = d.klassen[0];
  const fach = k.stundentafel[0].fach;
  const kasten = seite.locator(`#zuordnung-matrix [data-zeile="${k.id}"][data-spalte="${fach}|tagesende"]`);
  assert.equal(await kasten.isChecked(), false);
  await kasten.check();
  assert.equal((await daten()).klassen[0].stundentafel[0].tagesende, true);
  assert.match(await seite.getAttribute('#knopf-rueckgaengig', 'title'), /Tagesende geändert/);
  await kasten.uncheck();
  assert.equal((await daten()).klassen[0].stundentafel[0].tagesende, false);
  // ohne Wochenstunden nicht wählbar
  const frei = d.faecher.find((f) => !k.stundentafel.some((e) => e.fach === f.id));
  if (frei) assert.equal(await seite.locator(`#zuordnung-matrix [data-zeile="${k.id}"][data-spalte="${frei.id}|tagesende"]`).isDisabled(), true);
});

test('Qualifikationsmatrix: Stufengruppen je Zelle, Zeile und Spalte', async () => {
  const d = await daten();
  const a = d.lehrkraefte[0];
  const de = d.faecher.find((f) => f.kuerzel === 'DE');
  const ku = d.faecher.find((f) => f.kuerzel === 'KU');
  // Zusammenfassung in der Lehrkräfte-Tabelle, Klick springt zur Matrix
  const verweis = zelle('tabelle-lehrkraefte', a.id, 'qualifikationen');
  assert.match(await verweis.textContent(), /\(P\)/);
  await verweis.click();
  assert.equal(await seite.getAttribute('#stamm-qualifikationen', 'aria-pressed'), 'true');
  assert.ok(await seite.isVisible('#quali-matrix'));
  assert.equal(await seite.evaluate(() => document.activeElement.dataset.lk), a.id, 'Fokus in der Zeile der Lehrkraft');
  // Grundschule: nur Primarstufe sichtbar
  const sichtbar = await seite.$$eval('#quali-gruppen input', (l) => l.map((i) => [i.dataset.gruppe, i.checked]));
  assert.deepEqual(sichtbar, [['P', true], ['SI', false], ['SII', false]]);
  const knopf = (lk, fach, g) => seite.locator(`#quali-matrix .quali-knopf[data-lk="${lk}"][data-fach="${fach}"][data-gruppe="${g}"]`);
  // Einzelne Zelle umschalten
  const ohneKu = d.lehrkraefte.find((l) => !l.qualifikationen.some((q) => q.fach === ku.id));
  assert.equal(await knopf(ohneKu.id, ku.id, 'P').getAttribute('aria-pressed'), 'false');
  await knopf(ohneKu.id, ku.id, 'P').click();
  assert.equal(await knopf(ohneKu.id, ku.id, 'P').getAttribute('aria-pressed'), 'true');
  assert.deepEqual((await daten()).lehrkraefte.find((l) => l.id === ohneKu.id).qualifikationen.filter((q) => q.fach === ku.id), [{ fach: ku.id, stufenVon: 1, stufenBis: 4 }]);
  assert.equal(await seite.evaluate(() => document.activeElement.dataset.fach), ku.id, 'Fokus bleibt auf dem Schalter');
  await seite.keyboard.press('Space');
  assert.equal(await knopf(ohneKu.id, ku.id, 'P').getAttribute('aria-pressed'), 'false', 'Tastatur schaltet zurück');
  // Weitere Stufengruppe einblenden und setzen: P + SI → 1–10
  await seite.locator('#quali-gruppen input[data-gruppe="SI"]').check();
  await knopf(a.id, de.id, 'SI').click();
  const deA = (await daten()).lehrkraefte[0].qualifikationen.filter((q) => q.fach === de.id);
  assert.deepEqual(deA.map((q) => [q.stufenVon, q.stufenBis]), [[1, 10]]);
  // Teilweise abgedeckte Gruppe (3–4) erscheint gemischt, Klick setzt die ganze Gruppe
  await seite.evaluate(([id, f]) => window.Stundenplan.App.aendere('Test', (x) => {
    const l = x.lehrkraefte.find((y) => y.id === id); l.qualifikationen = l.qualifikationen.filter((q) => q.fach !== f).concat({ fach: f, stufenVon: 3, stufenBis: 4 });
  }), [ohneKu.id, ku.id]);
  assert.equal(await knopf(ohneKu.id, ku.id, 'P').getAttribute('aria-pressed'), 'mixed');
  assert.match(await knopf(ohneKu.id, ku.id, 'P').getAttribute('title'), /nur Stufen 3–4/);
  await knopf(ohneKu.id, ku.id, 'P').click();
  assert.equal(await knopf(ohneKu.id, ku.id, 'P').getAttribute('aria-pressed'), 'true');
  // Zeile: alle Fächer P für eine Lehrkraft (zweiter Klick entfernt)
  const zeileP = seite.locator(`#quali-matrix [data-zeile-lk="${ohneKu.id}"][data-gruppe="P"]`);
  await zeileP.click();
  let l = (await daten()).lehrkraefte.find((x) => x.id === ohneKu.id);
  assert.ok(d.faecher.every((f) => l.qualifikationen.some((q) => q.fach === f.id && q.stufenVon <= 1 && q.stufenBis >= 4)));
  assert.equal(await zeileP.getAttribute('aria-pressed'), 'true');
  await zeileP.click();
  l = (await daten()).lehrkraefte.find((x) => x.id === ohneKu.id);
  assert.ok(!l.qualifikationen.some((q) => q.stufenVon <= 4), 'Primarstufe überall entfernt');
  // Spalte: KU P für alle Lehrkräfte
  await seite.locator(`#quali-matrix [data-spalte-fach="${ku.id}"][data-gruppe="P"]`).click();
  assert.ok((await daten()).lehrkraefte.every((x) => x.qualifikationen.some((q) => q.fach === ku.id && q.stufenVon === 1 && q.stufenBis === 4)));
  // Rückgängig
  await seite.keyboard.press('Control+z');
  assert.ok(!(await daten()).lehrkraefte.every((x) => x.qualifikationen.some((q) => q.fach === ku.id)));
  assert.deepEqual(fehler, []);
});

test('Qualifikationsmatrix markiert Hauptlehrkräfte ohne Qualifikation (H8)', async () => {
  const d = await daten();
  const zu = d.zuordnungen.find((z) => z.rolle === 'haupt' && z.lehrkraft);
  await seite.click('#stamm-qualifikationen');
  const zelleH8 = seite.locator(`#quali-matrix td:has(.quali-knopf[data-lk="${zu.lehrkraft}"][data-fach="${zu.fach}"])`);
  assert.equal(await zelleH8.locator('.marke').count(), 0);
  await seite.locator(`#quali-matrix .quali-knopf[data-lk="${zu.lehrkraft}"][data-fach="${zu.fach}"][data-gruppe="P"]`).click();
  assert.match(await zelleH8.textContent(), /⚠ H8/);
  assert.match(await zelleH8.locator('.marke').getAttribute('title'), /Hauptlehrkraft/);
  await seite.locator(`#quali-matrix .quali-knopf[data-lk="${zu.lehrkraft}"][data-fach="${zu.fach}"][data-gruppe="P"]`).click();
  assert.equal(await zelleH8.locator('.marke').count(), 0);
  assert.deepEqual(fehler, []);
});
