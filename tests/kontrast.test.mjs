/* Barrierefreiheit (§9): Kontrast der verwendeten Farbpaare nach WCAG AA
 * (Text mindestens 4,5 : 1). Farben aus den Variablen in styles.css. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles.css'), 'utf8');
const variablen = Object.fromEntries([...css.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const farbe = (x) => (x.startsWith('#') ? x : variablen[x]);

function leuchtdichte(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function kontrast(a, b) {
  const [x, y] = [leuchtdichte(farbe(a)), leuchtdichte(farbe(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// [Vordergrund, Hintergrund, Verwendung]
const PAARE = [
  ['text', 'flaeche', 'Fließtext'], ['text', 'hintergrund', 'Text auf Seitenhintergrund'],
  ['text-leise', 'flaeche', 'Hinweise'], ['text-leise', 'hintergrund', 'Hinweise auf Hintergrund'],
  ['akzent', 'flaeche', 'Links, Reiter'], ['akzent-text', 'akzent', 'Primärknopf'],
  ['fehler', 'flaeche', 'Fehlertext'], ['fehler', '#fdecea', 'Konfliktmarke auf roter Karte'],
  ['warnung', 'flaeche', 'Warnung'], ['ok', 'flaeche', 'Erfolg'],
  ['text', '#eaf1fb', 'Karte im Plan'], ['text-leise', '#eaf1fb', 'Lehrkraft/Raum auf Karte'],
  ['text', '#fff4e0', 'Vertretene Stunde'], ['text-leise', '#f0f2f5', 'Pausenzeile'],
  ['#333333', '#e6e6e6', 'aufgeteilte Stunde'], ['text-leise', '#eeeeee', 'Gäste-Hinweis'],
  ['akzent', '#e5eefc', 'Ablageziel'],
];

for (const [vorne, hinten, wozu] of PAARE) {
  test(`Kontrast ≥ 4,5 : 1 – ${wozu}`, () => {
    assert.ok(farbe(vorne) && farbe(hinten), `Farbe fehlt: ${vorne}/${hinten}`);
    const k = kontrast(vorne, hinten);
    assert.ok(k >= 4.5, `${vorne} auf ${hinten}: ${k.toFixed(2)} : 1`);
  });
}

test('Fokus ist immer sichtbar', () => {
  assert.match(css, /:focus-visible\s*\{\s*outline:\s*3px solid/);
  // Fokusrahmen (Abstand 2 px) muss sich vom Untergrund abheben: ≥ 3 : 1 (WCAG 2.2, 1.4.11)
  for (const hinten of ['flaeche', 'hintergrund', '#eaf1fb', '#f0f2f5']) {
    assert.ok(kontrast('fokus', hinten) >= 3, `Fokus auf ${hinten}: ${kontrast('fokus', hinten).toFixed(2)} : 1`);
  }
});
