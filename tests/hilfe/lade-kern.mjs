/* Lädt den Kern-Quelltext (wie er in stundenplan.html eingebettet wird) und
 * liefert das Sammelobjekt `Kern`. So testen die Node-Tests exakt den Code,
 * der auch im Browser läuft. Ausführung per Function im selben Realm, damit
 * Arrays/Objekte die normalen Prototypen haben (deepStrictEqual), aber in
 * eigenem Gültigkeitsbereich ohne Zugriff auf Modul-Variablen der Tests. */
import { kernQuelle } from '../../tools/build.mjs';

export function ladeKern() {
  // eslint-disable-next-line no-new-func
  return new Function(`'use strict';\n${kernQuelle()}\nreturn Kern;`)();
}
