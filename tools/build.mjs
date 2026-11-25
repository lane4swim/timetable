#!/usr/bin/env node
/* ==========================================================================
 * Build: fügt die Module aus src/ zu einer einzigen Datei stundenplan.html
 * zusammen. Keine Abhängigkeiten außer Node ≥ 20.
 *
 *   node tools/build.mjs            schreibt stundenplan.html
 *   node tools/build.mjs --pruefen  prüft nur, ob stundenplan.html aktuell ist
 *                                   (Exit-Code 1, wenn nicht – für CI)
 * ========================================================================== */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ZIEL = join(WURZEL, 'stundenplan.html');

/** Liest alle .js-Dateien eines Ordners in Namensreihenfolge (Präfix 00-, 10-, …). */
function leseModule(ordner) {
  const pfad = join(WURZEL, ordner);
  return readdirSync(pfad)
    .filter((n) => n.endsWith('.js'))
    .sort()
    .map((n) => ({ name: `${ordner}/${n}`, text: readFileSync(join(pfad, n), 'utf8') }));
}

/** Verbindet Module mit Kopfzeile je Datei, damit die Herkunft im Ergebnis sichtbar bleibt. */
function verbinde(module) {
  return module.map((m) => `/* ---- ${m.name} ---- */\n${m.text.trimEnd()}\n`).join('\n');
}

/** Quelltext des Kerns (wird auch von den Node-Tests geladen). */
export function kernQuelle() {
  return verbinde(leseModule('src/kern'));
}

/** Prüft, dass eingebetteter Text das umgebende Element nicht vorzeitig schließt. */
function pruefeEinbettung(text, tag, wo) {
  if (new RegExp(`</${tag}`, 'i').test(text)) {
    throw new Error(`${wo}: enthält „</${tag}“ und würde die HTML-Datei zerstören`);
  }
}

/** Erzeugt den vollständigen HTML-Text. */
export function baue() {
  const vorlage = readFileSync(join(WURZEL, 'src/index.template.html'), 'utf8');
  const teile = {
    STIL: readFileSync(join(WURZEL, 'src/styles.css'), 'utf8').trimEnd(),
    KERN: kernQuelle().trimEnd(),
    WORKER: verbinde(leseModule('src/worker')).trimEnd(),
    UI: verbinde(leseModule('src/ui')).trimEnd(),
  };
  pruefeEinbettung(teile.STIL, 'style', 'styles.css');
  for (const k of ['KERN', 'WORKER', 'UI']) pruefeEinbettung(teile[k], 'script', k);

  let html = vorlage;
  for (const [name, inhalt] of Object.entries(teile)) {
    const marke = `/*@@${name}@@*/`;
    if (!html.includes(marke)) throw new Error(`Vorlage: Marke ${marke} fehlt`);
    html = html.split(marke).join(inhalt); // split/join statt replace: keine $-Ersetzungsmuster
  }
  return html;
}

// Aufruf als Programm
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = baue();
  if (process.argv.includes('--pruefen')) {
    const aktuell = existsSync(ZIEL) && readFileSync(ZIEL, 'utf8') === html;
    if (!aktuell) {
      console.error('stundenplan.html ist nicht aktuell – bitte „npm run build“ ausführen.');
      process.exit(1);
    }
    console.log('stundenplan.html ist aktuell.');
  } else {
    writeFileSync(ZIEL, html);
    console.log(`stundenplan.html geschrieben (${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB).`);
  }
}
