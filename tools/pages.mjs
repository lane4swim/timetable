#!/usr/bin/env node
/* ==========================================================================
 * Bereitet die Veröffentlichung auf GitHub Pages vor.
 *
 *   node tools/pages.mjs [zielordner]     (Standard: _site)
 *
 * Ergebnis im Zielordner:
 *   index.html         die Anwendung (identisch mit stundenplan.html)
 *   stundenplan.html   dieselbe Datei unter ihrem Namen (zum Herunterladen)
 *   .nojekyll          GitHub Pages liefert die Dateien unverändert aus
 *
 * Bricht ab, wenn stundenplan.html nicht zum Quelltext passt – veröffentlicht
 * wird immer genau die geprüfte, eingecheckte Datei.
 * ========================================================================== */
import { mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baue, ZIEL, WURZEL } from './build.mjs';

export function bereitePagesVor(ordner = join(WURZEL, '_site')) {
  const html = readFileSync(ZIEL, 'utf8');
  if (html !== baue()) {
    throw new Error('stundenplan.html ist nicht aktuell – bitte „npm run build“ ausführen und einchecken.');
  }
  rmSync(ordner, { recursive: true, force: true });
  mkdirSync(ordner, { recursive: true });
  copyFileSync(ZIEL, join(ordner, 'index.html'));
  copyFileSync(ZIEL, join(ordner, 'stundenplan.html'));
  writeFileSync(join(ordner, '.nojekyll'), '');
  return { ordner, groesseKiB: Buffer.byteLength(html) / 1024 };
}

// Aufruf als Programm
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const ziel = process.argv[2] ? resolve(process.argv[2]) : undefined;
    const { ordner, groesseKiB } = bereitePagesVor(ziel);
    console.log(`GitHub-Pages-Inhalt in ${ordner} bereit (index.html, ${groesseKiB.toFixed(1)} KiB).`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
