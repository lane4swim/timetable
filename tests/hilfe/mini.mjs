/* Kleine, von Hand nachgerechnete Testschule für Regel- und Kostentests.
 *
 * Zeitraster: Mo, Di; Stunden 1–4 (alle vormittags); Doppelstunden ab 1 und 3;
 * Pausen vor der 1. und vor der 3. Stunde mit je 1 Aufsicht.
 * Klassen: 1a (20 SuS, KL l-a, Raum r-a), 1b (22 SuS, KL l-b, Raum r-b), beide Stufe 1.
 * Lehrkräfte: l-a (DE, MA), l-b (MA, SP; Di 4 gesperrt), l-c (MU), l-d (DE, Springer).
 */
export function miniSchule() {
  return {
    schemaVersion: 1,
    schule: { name: 'Mini', schuljahr: '2026/27' },
    zeitraster: {
      tage: ['Mo', 'Di'],
      stunden: [
        { nr: 1, von: '08:00', bis: '08:45' },
        { nr: 2, von: '08:50', bis: '09:35' },
        { nr: 3, von: '09:55', bis: '10:40' },
        { nr: 4, von: '10:45', bis: '11:30' },
      ],
      doppelstundenStart: [1, 3],
      pausen: [
        { vorStunde: 1, name: 'Frühaufsicht', aufsichten: 1 },
        { vorStunde: 3, name: '1. Pause', aufsichten: 1 },
      ],
    },
    faecher: [
      { id: 'f-de', name: 'Deutsch', kuerzel: 'DE', raumtyp: null, blockbar: true, hauptfach: true },
      { id: 'f-ma', name: 'Mathematik', kuerzel: 'MA', raumtyp: null, blockbar: true, hauptfach: true },
      { id: 'f-sp', name: 'Sport', kuerzel: 'SP', raumtyp: 'turnhalle', blockbar: true, hauptfach: false },
      { id: 'f-mu', name: 'Musik', kuerzel: 'MU', raumtyp: 'musik', blockbar: false, hauptfach: false },
    ],
    lehrkraefte: [
      lk('l-a', 'A', [['f-de'], ['f-ma']], 6, 4, 8, 2),
      lk('l-b', 'B', [['f-ma'], ['f-sp']], 6, 4, 8, 1, [{ tag: 'Di', stunden: [4] }]),
      lk('l-c', 'C', [['f-mu']], 4, 2, 5, 0),
      lk('l-d', 'D', [['f-de']], 10, 0, 10, 2),
    ],
    raeume: [
      { id: 'r-a', name: 'A', typ: 'klassenraum', kapazitaet: 28, nahe: ['r-b'], gesperrt: [], abwesenheiten: [] },
      { id: 'r-b', name: 'B', typ: 'klassenraum', kapazitaet: 28, nahe: ['r-a'], gesperrt: [], abwesenheiten: [] },
      { id: 'r-th', name: 'Halle', typ: 'turnhalle', kapazitaet: 60, nahe: [], gesperrt: [], abwesenheiten: [] },
      { id: 'r-mu', name: 'Musik', typ: 'fachraum', fachraumtyp: 'musik', kapazitaet: 30, nahe: [], gesperrt: [], abwesenheiten: [] },
      { id: 'r-klein', name: 'Klein', typ: 'klassenraum', kapazitaet: 10, nahe: [], gesperrt: [], abwesenheiten: [] },
    ],
    klassen: [
      { id: 'k-1a', name: '1a', stufe: 1, schueler: 20, klassenlehrkraft: 'l-a', heimatraum: 'r-a',
        stundentafel: [{ fach: 'f-de', stunden: 2, doppelt: false }, { fach: 'f-ma', stunden: 2, doppelt: true }, { fach: 'f-sp', stunden: 1, doppelt: false }] },
      { id: 'k-1b', name: '1b', stufe: 1, schueler: 22, klassenlehrkraft: 'l-b', heimatraum: 'r-b',
        stundentafel: [{ fach: 'f-de', stunden: 2, doppelt: false }, { fach: 'f-mu', stunden: 1, doppelt: false }, { fach: 'f-sp', stunden: 1, doppelt: false }] },
    ],
    zuordnungen: [
      { klasse: 'k-1a', fach: 'f-de', lehrkraft: 'l-a', rolle: 'haupt' },
      { klasse: 'k-1a', fach: 'f-ma', lehrkraft: 'l-a', rolle: 'haupt' },
      { klasse: 'k-1a', fach: 'f-sp', lehrkraft: 'l-b', rolle: 'haupt' },
      { klasse: 'k-1b', fach: 'f-de', lehrkraft: 'l-a', rolle: 'haupt' },
      { klasse: 'k-1b', fach: 'f-mu', lehrkraft: 'l-c', rolle: 'haupt' },
      { klasse: 'k-1b', fach: 'f-sp', lehrkraft: 'l-b', rolle: 'haupt' },
    ],
    einstellungen: {
      gewichte: { W1: 10, W2: 5, W3: 8, W4: 3, W5: 4, W6: 2, W7: 2, W8: 6, W9: 4, W10: 3, W11: 5, W12: 3 },
      maxDoppelbetreuungProTag: 1, maxDoppelbetreuungStundenAmStueck: 2, gewichtAufteilung: 3,
      zweitbesetzungErlaubt: true, maxLehrkraefteProKlasseUndSlot: 2, vertretungsreserveProzent: 10,
      zeitbudgetSekunden: 30, zufallsStartwert: 42,
    },
    plan: { regelplan: gueltigerPlan(), aufsichten: gueltigeAufsichten(), vertretungen: [], aufsichtsVertretungen: [] },
  };
}

function lk(id, kuerzel, faecher, soll, min, max, aufsichten, gesperrt = []) {
  return {
    id, name: 'Lehrkraft ' + kuerzel, kuerzel,
    qualifikationen: faecher.map(([fach]) => ({ fach, stufenVon: 1, stufenBis: 4 })),
    sollStunden: soll, minStunden: min, maxStunden: max, aufsichtenProWoche: aufsichten,
    gesperrt, abwesenheiten: [],
  };
}

/** Kurzschreibweise für eine Unterrichtsstunde. */
export function st(klasse, fach, lehrkraefte, raum, tag, stunde, status = 'regulaer', extra = {}) {
  return { klasse, fach, lehrkraefte, raum, tag, stunde, status, ...extra };
}

/**
 * Gültiger Regelplan (Indizes in Klammern):
 *   1a: Mo1 MA A (0), Mo2 MA A (1), Mo3 SP B Halle (2), Di1 DE A (3), Di2 DE A (4)
 *   1b: Mo1 SP B Halle (5), Mo2 MU C Musik (6), Di3 DE A (7), Di4 DE A (8)
 */
export function gueltigerPlan() {
  return [
    st('k-1a', 'f-ma', ['l-a'], 'r-a', 'Mo', 1),
    st('k-1a', 'f-ma', ['l-a'], 'r-a', 'Mo', 2),
    st('k-1a', 'f-sp', ['l-b'], 'r-th', 'Mo', 3),
    st('k-1a', 'f-de', ['l-a'], 'r-a', 'Di', 1),
    st('k-1a', 'f-de', ['l-a'], 'r-a', 'Di', 2),
    st('k-1b', 'f-sp', ['l-b'], 'r-th', 'Mo', 1),
    st('k-1b', 'f-mu', ['l-c'], 'r-mu', 'Mo', 2),
    st('k-1b', 'f-de', ['l-a'], 'r-b', 'Di', 3),
    st('k-1b', 'f-de', ['l-a'], 'r-b', 'Di', 4),
  ];
}

/** Aufsichten: Mo vor 1 A (0), Mo vor 3 B (1), Di vor 1 A (2); Di vor 3 bleibt unbesetzt. */
export function gueltigeAufsichten() {
  return [
    { tag: 'Mo', vorStunde: 1, lehrkraft: 'l-a' },
    { tag: 'Mo', vorStunde: 3, lehrkraft: 'l-b' },
    { tag: 'Di', vorStunde: 1, lehrkraft: 'l-a' },
  ];
}
