/* Testzustände für Import/Export: Datensätze aus tests/daten, ergänzt um
 * Planeinträge aller Arten und unbekannte Zusatzfelder. */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORDNER = join(dirname(fileURLToPath(import.meta.url)), '..', 'daten');

/** Rohdaten eines Testdatensatzes (frische Kopie). */
export function datensatz(name) {
  return JSON.parse(readFileSync(join(ORDNER, `${name}.json`), 'utf8'));
}

/** Datensatztext wie auf der Platte. */
export function datensatzText(name) {
  return readFileSync(join(ORDNER, `${name}.json`), 'utf8');
}

/**
 * Datensatz „klein“ mit einem kleinen, strukturell gültigen Plan
 * (Regelplan, Aufsicht, Vertretungen aller Arten, Aufsichtsvertretung)
 * und unbekannten Zusatzfeldern auf mehreren Ebenen.
 */
export function kleinMitPlan() {
  const d = datensatz('klein');
  const [k1, k2] = d.klassen;
  const haupt = (k, i) => d.zuordnungen.find((z) => z.klasse === k.id && z.fach === k.stundentafel[i].fach && z.rolle === 'haupt');
  const z1 = haupt(k1, 0);
  const z2 = haupt(k1, 1);
  const andere = d.lehrkraefte.find((l) => l.id !== z1.lehrkraft).id;
  d.plan.regelplan = [
    { klasse: k1.id, fach: z1.fach, lehrkraefte: [z1.lehrkraft, andere], raum: k1.heimatraum, tag: 'Mo', stunde: 1, status: 'regulaer' },
    { klasse: k1.id, fach: z2.fach, lehrkraefte: [z2.lehrkraft], raum: k1.heimatraum, tag: 'Mo', stunde: 2, status: 'regulaer', notiz: 'unbekanntes Feld' },
  ];
  d.plan.aufsichten = [{ tag: 'Mo', vorStunde: 1, lehrkraft: z1.lehrkraft }];
  d.plan.vertretungen = [
    { datum: '2026-11-16', klasse: k1.id, stunde: 1, status: 'vertreten', lehrkraefte: [andere], raum: k1.heimatraum, grund: 'zweitbesetzungRueckt' },
    { datum: '2026-11-17', klasse: k1.id, stunde: 2, status: 'doppeltBetreut', lehrkraefte: [andere], raum: k1.heimatraum, mitKlasse: k2.id },
    { datum: '2026-11-17', klasse: k2.id, stunde: 3, status: 'aufgeteilt', verteilung: [{ zielKlasse: k1.id, anzahl: 6, gruppe: 'A' }] },
    { datum: '2026-11-18', klasse: k2.id, stunde: 6, status: 'entfaellt', grund: 'Lehrkraft krank' },
  ];
  d.plan.aufsichtsVertretungen = [
    { datum: '2026-11-16', vorStunde: 1, fuer: z1.lehrkraft, lehrkraft: andere, status: 'vertreten' },
    { datum: '2026-11-17', vorStunde: 3, fuer: z1.lehrkraft, lehrkraft: null, status: 'unbesetzt' },
  ];
  // Unbekannte Zusatzfelder (müssen erhalten bleiben)
  d.erweiterung = { quelle: 'Test', liste: [1, 2, { a: true }] };
  d.lehrkraefte[0].telefon = 'intern 123';
  d.klassen[0].stundentafel[0].bemerkung = 'Lesezeit';
  d.einstellungen.experiment = 7;
  d.plan.notizen = ['Zusatz'];
  return d;
}
