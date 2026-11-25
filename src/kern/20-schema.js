/* ==========================================================================
 * Modul Schema
 * Deklarative Beschreibung des JSON-Formats (Spezifikation §8) und darauf
 * aufbauend:
 *   - normalisiere(): fehlende optionale Felder mit Standardwerten ergänzen
 *   - validiere():    Typen, Pflichtfelder, Bereiche, Referenzen, Eindeutigkeit
 *                     und fachliche Querprüfungen; Fehler mit Pfadangabe
 *   - ordne():        kanonische Feldreihenfolge (bekannte Felder in
 *                     Schemareihenfolge, unbekannte Felder unverändert dahinter)
 *   - migriere():     ältere schemaVersion stufenweise hochziehen
 * Unbekannte Zusatzfelder werden nie entfernt oder bemängelt.
 * ========================================================================== */
const Schema = (() => {
  'use strict';

  /* ------------------------- Bausteine (Typen) --------------------------- */
  // Jeder Baustein ist ein einfaches Objekt { art, ...optionen }.
  // Gemeinsame Optionen: pflicht (Feld muss vorhanden sein), nullbar (null erlaubt),
  // standard (Wert oder Funktion(elternobjekt) für fehlende Felder), name (für Meldungen).
  const T = {
    text: (o = {}) => ({ art: 'text', ...o }),
    zahl: (o = {}) => ({ art: 'zahl', ...o }),
    ganz: (o = {}) => ({ art: 'zahl', ganz: true, ...o }),
    bool: (o = {}) => ({ art: 'bool', ...o }),
    wahl: (werte, o = {}) => ({ art: 'wahl', werte, ...o }),
    liste: (element, o = {}) => ({ art: 'liste', element, ...o }),
    objekt: (felder, o = {}) => ({ art: 'objekt', felder, ...o }),
    ref: (ziel, o = {}) => ({ art: 'ref', ziel, ...o }),
    datum: (o = {}) => ({ art: 'datum', ...o }),
    uhrzeit: (o = {}) => ({ art: 'uhrzeit', ...o }),
    tag: (o = {}) => ({ art: 'tag', ...o }),
    stunde: (o = {}) => ({ art: 'stunde', ...o }),
    pause: (o = {}) => ({ art: 'pause', ...o }),
  };
  const P = { pflicht: true };

  /** Lesbare Namen der referenzierbaren Sammlungen. */
  const SAMMLUNGEN = { faecher: 'Fach', lehrkraefte: 'Lehrkraft', raeume: 'Raum', klassen: 'Klasse' };

  /* ---------------------------- Schema ----------------------------------- */

  const SPERRE = T.objekt({
    tag: T.tag(P),
    stunden: T.liste(T.stunde(), { ...P, min: 1, eindeutig: true }),
  });
  const ABWESENHEIT = T.objekt({
    von: T.datum(P),
    bis: T.datum(P),
    grund: T.text({ standard: '' }),
  });

  const FACH = T.objekt({
    id: T.text({ ...P, nichtLeer: true }),
    name: T.text({ ...P, nichtLeer: true }),
    kuerzel: T.text({ ...P, nichtLeer: true, max: 12 }),
    raumtyp: T.text({ nullbar: true, nichtLeer: true, standard: null }),
    blockbar: T.bool({ standard: true }),
    hauptfach: T.bool({ standard: false }),
  });

  const LEHRKRAFT = T.objekt({
    id: T.text({ ...P, nichtLeer: true }),
    name: T.text({ ...P, nichtLeer: true }),
    kuerzel: T.text({ ...P, nichtLeer: true, max: 12 }),
    qualifikationen: T.liste(T.objekt({
      fach: T.ref('faecher', P),
      stufenVon: T.ganz({ ...P, min: 1, max: 13 }),
      stufenBis: T.ganz({ ...P, min: 1, max: 13 }),
    }), { standard: () => [] }),
    sollStunden: T.zahl({ ...P, min: 0, max: 40 }),
    minStunden: T.zahl({ min: 0, max: 40, standard: (l) => (typeof l.sollStunden === 'number' ? l.sollStunden : 0) }),
    maxStunden: T.zahl({ min: 0, max: 40, standard: (l) => (typeof l.sollStunden === 'number' ? l.sollStunden : 0) }),
    teilzeitfaktor: T.zahl({ min: 0, max: 1 }),
    aufsichtenProWoche: T.ganz({ min: 0, max: 50, standard: 0 }),
    gesperrt: T.liste(SPERRE, { standard: () => [] }),
    abwesenheiten: T.liste(ABWESENHEIT, { standard: () => [] }),
  });

  const RAUM = T.objekt({
    id: T.text({ ...P, nichtLeer: true }),
    name: T.text({ ...P, nichtLeer: true }),
    typ: T.wahl(['klassenraum', 'fachraum', 'turnhalle', 'schwimmhalle'], P),
    fachraumtyp: T.text({ nichtLeer: true }),
    kapazitaet: T.ganz({ ...P, min: 1, max: 500 }),
    nahe: T.liste(T.ref('raeume'), { standard: () => [], eindeutig: true }),
    gesperrt: T.liste(SPERRE, { standard: () => [] }),
    abwesenheiten: T.liste(ABWESENHEIT, { standard: () => [] }),
  });

  const KLASSE = T.objekt({
    id: T.text({ ...P, nichtLeer: true }),
    name: T.text({ ...P, nichtLeer: true }),
    stufe: T.ganz({ ...P, min: 1, max: 13 }),
    schueler: T.ganz({ ...P, min: 1, max: 60 }),
    klassenlehrkraft: T.ref('lehrkraefte', { nullbar: true, standard: null }),
    heimatraum: T.ref('raeume', { nullbar: true, standard: null }),
    stundentafel: T.liste(T.objekt({
      fach: T.ref('faecher', P),
      stunden: T.ganz({ ...P, min: 1, max: 20 }),
      doppelt: T.bool({ standard: false }),
    }), { standard: () => [] }),
  });

  const ZUORDNUNG = T.objekt({
    klasse: T.ref('klassen', P),
    fach: T.ref('faecher', P),
    lehrkraft: T.ref('lehrkraefte', P),
    rolle: T.wahl(['haupt', 'zweit'], P),
    zweck: T.text(),
  });

  const ZEITRASTER = T.objekt({
    tage: T.liste(T.wahl(['Mo', 'Di', 'Mi', 'Do', 'Fr']), { ...P, min: 1, max: 5, eindeutig: true }),
    stunden: T.liste(T.objekt({
      nr: T.ganz({ ...P, min: 1, max: 10 }),
      von: T.uhrzeit(P),
      bis: T.uhrzeit(P),
    }), { ...P, min: 1, max: 10 }),
    doppelstundenStart: T.liste(T.stunde(), { standard: () => [], eindeutig: true }),
    pausen: T.liste(T.objekt({
      vorStunde: T.stunde(P),
      name: T.text({ standard: '' }),
      aufsichten: T.ganz({ min: 0, max: 50, standard: 0 }),
    }), { standard: () => [] }),
  });

  const EINSTELLUNGEN = T.objekt({
    gewichte: T.objekt(Object.fromEntries(Object.entries(Modell.STANDARD_GEWICHTE)
      .map(([k, v]) => [k, T.zahl({ min: 0, max: 1000, standard: v })])), { standard: () => ({}) }),
    maxDoppelbetreuungProTag: T.ganz({ min: 0, max: 10, standard: 1 }),
    maxDoppelbetreuungStundenAmStueck: T.ganz({ min: 1, max: 10, standard: 2 }),
    gewichtAufteilung: T.zahl({ min: 1, minExklusiv: true, max: 100, standard: 3 }),
    zweitbesetzungErlaubt: T.bool({ standard: true }),
    maxLehrkraefteProKlasseUndSlot: T.ganz({ min: 1, max: 4, standard: 2 }),
    vertretungsreserveProzent: T.zahl({ min: 0, max: 50, standard: 10 }),
    zeitbudgetSekunden: T.zahl({ min: 1, max: 600, standard: 30 }),
    zufallsStartwert: T.ganz({ min: 0, max: 4294967295, standard: 42 }),
  }, { standard: () => ({}) });

  const LEHRKRAEFTE_LISTE = T.liste(T.ref('lehrkraefte'), { standard: () => [], maxEinstellung: true });
  const STATUS = ['regulaer', 'vertreten', 'doppeltBetreut', 'aufgeteilt', 'entfaellt', 'aufsicht'];

  const STUNDE = T.objekt({
    klasse: T.ref('klassen', P),
    fach: T.ref('faecher', { nullbar: true, standard: null }),
    lehrkraefte: LEHRKRAEFTE_LISTE,
    raum: T.ref('raeume', { nullbar: true, standard: null }),
    tag: T.tag(P),
    stunde: T.stunde(P),
    status: T.wahl(STATUS, P),
  });

  const VERTRETUNG = T.objekt({
    datum: T.datum(P),
    klasse: T.ref('klassen', P),
    fach: T.ref('faecher', { nullbar: true }),
    stunde: T.stunde(P),
    status: T.wahl(STATUS, P),
    lehrkraefte: LEHRKRAEFTE_LISTE,
    raum: T.ref('raeume', { nullbar: true, standard: null }),
    mitKlasse: T.ref('klassen'),
    verteilung: T.liste(T.objekt({
      zielKlasse: T.ref('klassen', P),
      anzahl: T.ganz({ ...P, min: 1, max: 60 }),
      gruppe: T.text(),
    })),
    grund: T.text(),
  });

  const AUFSICHT = T.objekt({
    tag: T.tag(P),
    vorStunde: T.pause(P),
    lehrkraft: T.ref('lehrkraefte', P),
  });

  const AUFSICHTSVERTRETUNG = T.objekt({
    datum: T.datum(P),
    vorStunde: T.pause(P),
    fuer: T.ref('lehrkraefte', P),
    lehrkraft: T.ref('lehrkraefte', { nullbar: true, standard: null }),
    status: T.wahl(['vertreten', 'unbesetzt'], P),
  });

  const PLAN = T.objekt({
    regelplan: T.liste(STUNDE, { standard: () => [] }),
    aufsichten: T.liste(AUFSICHT, { standard: () => [] }),
    vertretungen: T.liste(VERTRETUNG, { standard: () => [] }),
    aufsichtsVertretungen: T.liste(AUFSICHTSVERTRETUNG, { standard: () => [] }),
  }, { standard: () => ({}) });

  /** Gesamtzustand (vollständiger Export). */
  const ZUSTAND = T.objekt({
    schemaVersion: T.ganz({ ...P, min: 1 }),
    exportedAt: T.text(),
    teil: T.wahl(['stammdaten', 'plan']),
    schule: T.objekt({ name: T.text({ standard: '' }), schuljahr: T.text({ standard: '' }) }, { standard: () => ({}) }),
    zeitraster: { ...ZEITRASTER, pflicht: true },
    faecher: T.liste(FACH, { standard: () => [] }),
    lehrkraefte: T.liste(LEHRKRAFT, { standard: () => [] }),
    raeume: T.liste(RAUM, { standard: () => [] }),
    klassen: T.liste(KLASSE, { standard: () => [] }),
    zuordnungen: T.liste(ZUORDNUNG, { standard: () => [] }),
    einstellungen: EINSTELLUNGEN,
    plan: PLAN,
  });

  /** Bereiche, die beim Teil-Export „stammdaten“ bzw. „plan“ enthalten sind. */
  const TEILE = {
    stammdaten: ['schule', 'zeitraster', 'faecher', 'lehrkraefte', 'raeume', 'klassen', 'zuordnungen', 'einstellungen'],
    plan: ['plan'],
  };

  /* ------------------------- Hilfsfunktionen ----------------------------- */

  const istObjekt = (w) => w !== null && typeof w === 'object' && !Array.isArray(w);
  const pfadFeld = (pfad, name) => (pfad ? pfad + '.' + name : name);
  const pfadIndex = (pfad, i) => pfad + '[' + i + ']';

  /** Kurze, lesbare Darstellung eines Werts für Fehlermeldungen. */
  function zeige(wert) {
    if (typeof wert === 'string') return '„' + (wert.length > 40 ? wert.slice(0, 40) + '…' : wert) + '“';
    if (Array.isArray(wert)) return 'Liste';
    if (istObjekt(wert)) return 'Objekt';
    return String(wert);
  }
  function typname(wert) {
    if (wert === null) return 'null';
    if (Array.isArray(wert)) return 'Liste';
    return { string: 'Text', number: 'Zahl', boolean: 'Wahrheitswert', object: 'Objekt' }[typeof wert] || typeof wert;
  }

  const MAX_FEHLER = 500;

  /** Sammelt Fehler und Warnungen samt Prüfkontext. */
  function neuerKontext(daten) {
    const kx = { fehler: [], warnungen: [], uebersprungen: 0 };
    kx.ids = {};
    for (const s of Object.keys(SAMMLUNGEN)) {
      kx.ids[s] = new Set((Array.isArray(daten[s]) ? daten[s] : []).filter((e) => istObjekt(e) && typeof e.id === 'string').map((e) => e.id));
    }
    const zr = istObjekt(daten.zeitraster) ? daten.zeitraster : {};
    kx.tage = new Set(Array.isArray(zr.tage) ? zr.tage.filter((t) => Modell.TAGE.includes(t)) : []);
    kx.stunden = new Set(Array.isArray(zr.stunden) ? zr.stunden.filter(istObjekt).map((s) => s.nr).filter(Number.isInteger) : []);
    kx.pausen = new Set(Array.isArray(zr.pausen) ? zr.pausen.filter(istObjekt).map((p) => p.vorStunde).filter(Number.isInteger) : []);
    const e = istObjekt(daten.einstellungen) ? daten.einstellungen : {};
    kx.maxLehrkraefte = Number.isInteger(e.maxLehrkraefteProKlasseUndSlot) ? e.maxLehrkraefteProKlasseUndSlot : 2;
    return kx;
  }
  function fehler(kx, pfad, meldung) {
    if (kx.fehler.length >= MAX_FEHLER) { kx.uebersprungen++; return; }
    kx.fehler.push({ pfad, meldung });
  }
  function warnung(kx, pfad, meldung) { kx.warnungen.push({ pfad, meldung }); }

  /* --------------------------- Strukturprüfung --------------------------- */

  function pruefeWert(wert, s, pfad, kx) {
    if (wert === null) {
      if (!s.nullbar) fehler(kx, pfad, 'darf nicht null sein');
      return;
    }
    switch (s.art) {
      case 'objekt': {
        if (!istObjekt(wert)) return fehler(kx, pfad, `muss ein Objekt sein, ist ${typname(wert)}`);
        for (const [name, fs] of Object.entries(s.felder)) {
          const p = pfadFeld(pfad, name);
          if (wert[name] === undefined) {
            if (fs.pflicht) fehler(kx, p, 'Pflichtfeld fehlt');
            continue;
          }
          pruefeWert(wert[name], fs, p, kx);
        }
        return;
      }
      case 'liste': {
        if (!Array.isArray(wert)) return fehler(kx, pfad, `muss eine Liste sein, ist ${typname(wert)}`);
        if (s.min !== undefined && wert.length < s.min) fehler(kx, pfad, `muss mindestens ${s.min} Eintrag/Einträge haben`);
        const max = s.maxEinstellung ? kx.maxLehrkraefte : s.max;
        if (max !== undefined && wert.length > max) {
          fehler(kx, pfad, s.maxEinstellung
            ? `höchstens ${max} Lehrkräfte je Klasse und Stunde erlaubt (maxLehrkraefteProKlasseUndSlot), eingetragen sind ${wert.length}`
            : `darf höchstens ${max} Einträge haben`);
        }
        wert.forEach((el, i) => pruefeWert(el, s.element, pfadIndex(pfad, i), kx));
        if (s.eindeutig) {
          const gesehen = new Map();
          wert.forEach((el, i) => {
            if (typeof el !== 'string' && typeof el !== 'number') return;
            if (gesehen.has(el)) {
              fehler(kx, pfadIndex(pfad, i), `${zeige(el)} kommt mehrfach vor (zuerst bei Index ${gesehen.get(el)})`);
            } else gesehen.set(el, i);
          });
        }
        return;
      }
      case 'text':
        if (typeof wert !== 'string') return fehler(kx, pfad, `muss Text sein, ist ${typname(wert)}`);
        if (s.nichtLeer && !wert.trim()) return fehler(kx, pfad, 'darf nicht leer sein');
        if (s.max !== undefined && wert.length > s.max) fehler(kx, pfad, `darf höchstens ${s.max} Zeichen lang sein`);
        return;
      case 'zahl':
        if (typeof wert !== 'number' || !Number.isFinite(wert)) return fehler(kx, pfad, `muss eine Zahl sein, ist ${typname(wert)} ${zeige(wert)}`);
        if (s.ganz && !Number.isInteger(wert)) return fehler(kx, pfad, `muss eine ganze Zahl sein, ist ${wert}`);
        if (s.min !== undefined && (s.minExklusiv ? wert <= s.min : wert < s.min)) {
          return fehler(kx, pfad, `muss ${s.minExklusiv ? 'größer als' : 'mindestens'} ${s.min} sein, ist ${wert}`);
        }
        if (s.max !== undefined && wert > s.max) fehler(kx, pfad, `darf höchstens ${s.max} sein, ist ${wert}`);
        return;
      case 'bool':
        if (typeof wert !== 'boolean') fehler(kx, pfad, `muss true oder false sein, ist ${typname(wert)}`);
        return;
      case 'wahl':
        if (!s.werte.includes(wert)) fehler(kx, pfad, `unzulässiger Wert ${zeige(wert)}; erlaubt: ${s.werte.join(', ')}`);
        return;
      case 'ref':
        if (typeof wert !== 'string') return fehler(kx, pfad, `muss eine ID (Text) sein, ist ${typname(wert)}`);
        if (!kx.ids[s.ziel].has(wert)) fehler(kx, pfad, `unbekannte Referenz ${zeige(wert)} (${SAMMLUNGEN[s.ziel]} existiert nicht)`);
        return;
      case 'datum':
        if (!Hilfen.istIsoDatum(wert)) fehler(kx, pfad, `muss ein Datum im Format JJJJ-MM-TT sein, ist ${zeige(wert)}`);
        return;
      case 'uhrzeit':
        if (typeof wert !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(wert)) fehler(kx, pfad, `muss eine Uhrzeit im Format HH:MM sein, ist ${zeige(wert)}`);
        return;
      case 'tag':
        if (!kx.tage.has(wert)) fehler(kx, pfad, `unbekannter Tag ${zeige(wert)}; das Zeitraster enthält: ${[...kx.tage].join(', ') || '–'}`);
        return;
      case 'stunde':
        if (!Number.isInteger(wert) || !kx.stunden.has(wert)) fehler(kx, pfad, `Stunde ${zeige(wert)} gibt es im Zeitraster nicht`);
        return;
      case 'pause':
        if (!Number.isInteger(wert) || !kx.pausen.has(wert)) fehler(kx, pfad, `vor Stunde ${zeige(wert)} ist keine Pause festgelegt`);
        return;
      default:
        throw new Error('Unbekannte Schema-Art: ' + s.art);
    }
  }

  /* --------------------------- Querprüfungen ----------------------------- */

  const liste = (w) => (Array.isArray(w) ? w : []);
  const eintraege = (w) => liste(w).map((e, i) => [e, i]).filter(([e]) => istObjekt(e));

  /** Eindeutigkeit eines Felds innerhalb einer Liste (optional ohne Groß-/Kleinschreibung). */
  function eindeutig(kx, daten, sammlung, feld, bezeichnung, ohneGross = false) {
    const gesehen = new Map();
    for (const [e, i] of eintraege(daten[sammlung])) {
      if (typeof e[feld] !== 'string') continue;
      const schluessel = ohneGross ? e[feld].toLocaleLowerCase('de') : e[feld];
      if (gesehen.has(schluessel)) {
        fehler(kx, `${sammlung}[${i}].${feld}`, `${bezeichnung} ${zeige(e[feld])} ist bereits in ${sammlung}[${gesehen.get(schluessel)}] vergeben`);
      } else gesehen.set(schluessel, i);
    }
  }

  function minutenVon(text) {
    const m = /^(\d{2}):(\d{2})$/.exec(text || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function pruefeDatumImRaster(kx, pfad, datum) {
    if (!Hilfen.istIsoDatum(datum)) return;
    const tag = Hilfen.wochentag(datum);
    if (!kx.tage.has(tag)) fehler(kx, pfad, `${datum} ist ein ${tag}; dieser Tag liegt nicht im Zeitraster`);
  }

  function querpruefungen(d, kx) {
    // Eindeutige IDs je Sammlung, eindeutige Kürzel und Namen
    for (const s of Object.keys(SAMMLUNGEN)) eindeutig(kx, d, s, 'id', 'ID');
    eindeutig(kx, d, 'faecher', 'kuerzel', 'Kürzel', true);
    eindeutig(kx, d, 'lehrkraefte', 'kuerzel', 'Kürzel', true);
    eindeutig(kx, d, 'raeume', 'name', 'Name', true);
    eindeutig(kx, d, 'klassen', 'name', 'Name', true);

    // Zeitraster
    const zr = istObjekt(d.zeitraster) ? d.zeitraster : {};
    const tage = liste(zr.tage);
    const reihenfolge = tage.map((t) => Modell.TAGE.indexOf(t)).filter((i) => i >= 0);
    if (reihenfolge.some((v, i) => i > 0 && v <= reihenfolge[i - 1])) fehler(kx, 'zeitraster.tage', 'Tage müssen in der Reihenfolge Mo–Fr stehen');
    let vorherBis = null;
    for (const [s, i] of eintraege(zr.stunden)) {
      const p = `zeitraster.stunden[${i}]`;
      if (Number.isInteger(s.nr) && s.nr !== i + 1) fehler(kx, p + '.nr', `erwartet ${i + 1} (Stunden fortlaufend ab 1 nummerieren), ist ${s.nr}`);
      const von = minutenVon(s.von);
      const bis = minutenVon(s.bis);
      if (von !== null && bis !== null && bis <= von) fehler(kx, p + '.bis', 'Ende muss nach dem Beginn liegen');
      if (von !== null && vorherBis !== null && von < vorherBis) fehler(kx, p + '.von', 'Stunde beginnt vor dem Ende der vorherigen Stunde');
      if (bis !== null) vorherBis = bis;
    }
    for (const [s, i] of liste(zr.doppelstundenStart).map((s, i) => [s, i])) {
      if (kx.stunden.has(s) && !kx.stunden.has(s + 1)) fehler(kx, `zeitraster.doppelstundenStart[${i}]`, `Doppelstunde ab Stunde ${s} braucht eine Stunde ${s + 1}`);
    }
    const pausenVor = new Map();
    for (const [p, i] of eintraege(zr.pausen)) {
      if (pausenVor.has(p.vorStunde)) fehler(kx, `zeitraster.pausen[${i}].vorStunde`, `vor Stunde ${p.vorStunde} ist bereits eine Pause festgelegt (pausen[${pausenVor.get(p.vorStunde)}])`);
      else pausenVor.set(p.vorStunde, i);
    }

    // Fächer: benötigter Raumtyp
    const fachraumtypen = new Set(eintraege(d.raeume).filter(([r]) => r.typ === 'fachraum' && typeof r.fachraumtyp === 'string').map(([r]) => r.fachraumtyp));
    const sonderraeume = new Set(eintraege(d.raeume).map(([r]) => r.typ).filter((t) => Modell.SONDERRAUMTYPEN.includes(t)));
    for (const [f, i] of eintraege(d.faecher)) {
      if (typeof f.raumtyp !== 'string') continue;
      if (f.raumtyp === 'klassenraum' || f.raumtyp === 'fachraum') {
        fehler(kx, `faecher[${i}].raumtyp`, `${zeige(f.raumtyp)} ist kein benötigter Raumtyp; erlaubt sind turnhalle, schwimmhalle oder ein Fachraumtyp (z. B. „nawi“)`);
      } else if (!fachraumtypen.has(f.raumtyp) && !sonderraeume.has(f.raumtyp)) {
        warnung(kx, `faecher[${i}].raumtyp`, `kein Raum vom Typ ${zeige(f.raumtyp)} vorhanden – das Fach kann nicht geplant werden`);
      }
    }

    // Lehrkräfte
    for (const [l, i] of eintraege(d.lehrkraefte)) {
      const p = `lehrkraefte[${i}]`;
      const zahl = (w) => typeof w === 'number';
      if (zahl(l.minStunden) && zahl(l.sollStunden) && l.minStunden > l.sollStunden) fehler(kx, p + '.minStunden', `Mindeststunden (${l.minStunden}) über Sollstunden (${l.sollStunden})`);
      if (zahl(l.maxStunden) && zahl(l.sollStunden) && l.maxStunden < l.sollStunden) fehler(kx, p + '.maxStunden', `Höchststunden (${l.maxStunden}) unter Sollstunden (${l.sollStunden})`);
      for (const [q, j] of eintraege(l.qualifikationen)) {
        if (Number.isInteger(q.stufenVon) && Number.isInteger(q.stufenBis) && q.stufenVon > q.stufenBis) fehler(kx, `${p}.qualifikationen[${j}].stufenBis`, 'muss mindestens stufenVon sein');
      }
      pruefeAbwesenheiten(kx, p, l.abwesenheiten);
    }

    // Räume
    for (const [r, i] of eintraege(d.raeume)) {
      const p = `raeume[${i}]`;
      if (r.typ === 'fachraum' && r.fachraumtyp === undefined) fehler(kx, p + '.fachraumtyp', 'Pflichtfeld bei Fachräumen fehlt');
      if (r.typ !== 'fachraum' && r.fachraumtyp !== undefined) warnung(kx, p + '.fachraumtyp', 'wird nur bei Fachräumen beachtet');
      liste(r.nahe).forEach((n, j) => { if (n === r.id) fehler(kx, `${p}.nahe[${j}]`, 'ein Raum kann nicht neben sich selbst liegen'); });
      pruefeAbwesenheiten(kx, p, r.abwesenheiten);
    }

    // Klassen
    const klassen = new Map(eintraege(d.klassen).map(([k]) => [k.id, k]));
    const raeume = new Map(eintraege(d.raeume).map(([r]) => [r.id, r]));
    const tafel = (klasseId) => new Set(eintraege(klassen.get(klasseId)?.stundentafel).map(([e]) => e.fach));
    for (const [k, i] of eintraege(d.klassen)) {
      const p = `klassen[${i}]`;
      const gesehen = new Map();
      for (const [e, j] of eintraege(k.stundentafel)) {
        if (gesehen.has(e.fach)) fehler(kx, `${p}.stundentafel[${j}].fach`, `Fach ${zeige(e.fach)} steht bereits in stundentafel[${gesehen.get(e.fach)}]`);
        else gesehen.set(e.fach, j);
      }
      const raum = raeume.get(k.heimatraum);
      if (raum && Number.isInteger(k.schueler) && Number.isInteger(raum.kapazitaet) && k.schueler > raum.kapazitaet) {
        warnung(kx, p + '.heimatraum', `Heimatraum fasst ${raum.kapazitaet}, Klasse hat ${k.schueler} Schüler:innen (H6)`);
      }
      const summe = eintraege(k.stundentafel).reduce((s, [e]) => s + (Number.isInteger(e.stunden) ? e.stunden : 0), 0);
      const slots = kx.tage.size * kx.stunden.size;
      if (slots && summe > slots) warnung(kx, p + '.stundentafel', `${summe} Wochenstunden passen nicht in ${slots} Zeitslots`);
    }

    // Zuordnungen
    const jeKlasseFach = new Map();
    for (const [z, i] of eintraege(d.zuordnungen)) {
      const p = `zuordnungen[${i}]`;
      if (klassen.has(z.klasse) && kx.ids.faecher.has(z.fach) && !tafel(z.klasse).has(z.fach)) {
        fehler(kx, p + '.fach', `Fach ${zeige(z.fach)} steht nicht in der Stundentafel der Klasse ${zeige(z.klasse)}`);
      }
      const schluessel = z.klasse + '\u0000' + z.fach;
      if (!jeKlasseFach.has(schluessel)) jeKlasseFach.set(schluessel, []);
      const bisher = jeKlasseFach.get(schluessel);
      const doppelt = bisher.find((x) => x.z.lehrkraft === z.lehrkraft);
      if (doppelt) {
        fehler(kx, p + '.lehrkraft', `Lehrkraft ist für diese Klasse und dieses Fach bereits als „${doppelt.z.rolle}“ eingetragen (zuordnungen[${doppelt.i}])`);
      } else if (z.rolle === 'haupt' && bisher.some((x) => x.z.rolle === 'haupt')) {
        fehler(kx, p + '.rolle', `für Klasse und Fach ist bereits eine Hauptlehrkraft eingetragen (zuordnungen[${bisher.find((x) => x.z.rolle === 'haupt').i}])`);
      } else if (bisher.length + 1 > kx.maxLehrkraefte) {
        fehler(kx, p, `mehr als ${kx.maxLehrkraefte} Lehrkräfte für dieselbe Klasse und dasselbe Fach`);
      }
      bisher.push({ z, i });
    }

    // Plan
    const plan = istObjekt(d.plan) ? d.plan : {};
    for (const [s, i] of eintraege(plan.regelplan)) {
      const p = `plan.regelplan[${i}]`;
      pruefeStundeneintrag(kx, p, s, tafel);
    }
    const slotBelegt = new Map();
    for (const [s, i] of eintraege(plan.regelplan)) {
      const schluessel = [s.klasse, s.tag, s.stunde].join('\u0000');
      if (slotBelegt.has(schluessel)) fehler(kx, `plan.regelplan[${i}]`, `Klasse hat in diesem Zeitslot bereits eine Stunde (plan.regelplan[${slotBelegt.get(schluessel)}])`);
      else slotBelegt.set(schluessel, i);
    }
    for (const [v, i] of eintraege(plan.vertretungen)) {
      const p = `plan.vertretungen[${i}]`;
      pruefeDatumImRaster(kx, p + '.datum', v.datum);
      pruefeStundeneintrag(kx, p, v, tafel);
      if (v.status === 'doppeltBetreut' && v.mitKlasse === undefined) fehler(kx, p + '.mitKlasse', 'bei Doppelbetreuung erforderlich');
      if (v.mitKlasse !== undefined && v.mitKlasse === v.klasse) fehler(kx, p + '.mitKlasse', 'muss eine andere Klasse sein');
      if (v.status === 'aufgeteilt' && !liste(v.verteilung).length) fehler(kx, p + '.verteilung', 'bei Aufteilung erforderlich');
      for (const [z, j] of eintraege(v.verteilung)) {
        if (z.zielKlasse === v.klasse) fehler(kx, `${p}.verteilung[${j}].zielKlasse`, 'eine Klasse kann nicht auf sich selbst aufgeteilt werden');
      }
      const k = klassen.get(v.klasse);
      const summe = eintraege(v.verteilung).reduce((s, [z]) => s + (Number.isInteger(z.anzahl) ? z.anzahl : 0), 0);
      if (k && Number.isInteger(k.schueler) && summe > k.schueler) fehler(kx, p + '.verteilung', `verteilt ${summe} Schüler:innen, die Klasse hat ${k.schueler}`);
    }
    const aufsichtGesehen = new Map();
    for (const [a, i] of eintraege(plan.aufsichten)) {
      const schluessel = [a.tag, a.vorStunde, a.lehrkraft].join('\u0000');
      if (aufsichtGesehen.has(schluessel)) fehler(kx, `plan.aufsichten[${i}]`, `doppelt eingetragen (plan.aufsichten[${aufsichtGesehen.get(schluessel)}])`);
      else aufsichtGesehen.set(schluessel, i);
    }
    for (const [a, i] of eintraege(plan.aufsichtsVertretungen)) {
      const p = `plan.aufsichtsVertretungen[${i}]`;
      pruefeDatumImRaster(kx, p + '.datum', a.datum);
      if (a.status === 'vertreten' && (a.lehrkraft === null || a.lehrkraft === undefined)) fehler(kx, p + '.lehrkraft', 'bei Status „vertreten“ erforderlich');
      if (a.status === 'unbesetzt' && typeof a.lehrkraft === 'string') fehler(kx, p + '.lehrkraft', 'muss bei Status „unbesetzt“ null sein');
      if (typeof a.lehrkraft === 'string' && a.lehrkraft === a.fuer) fehler(kx, p + '.lehrkraft', 'eine Lehrkraft kann sich nicht selbst vertreten');
    }
  }

  function pruefeAbwesenheiten(kx, pfad, abwesenheiten) {
    for (const [a, j] of eintraege(abwesenheiten)) {
      if (Hilfen.istIsoDatum(a.von) && Hilfen.istIsoDatum(a.bis) && a.bis < a.von) fehler(kx, `${pfad}.abwesenheiten[${j}].bis`, 'Ende liegt vor dem Beginn');
    }
  }

  /** Gemeinsame Prüfungen für Regelplan- und Vertretungseinträge. */
  function pruefeStundeneintrag(kx, p, s, tafel) {
    const ohneLehrkraft = ['entfaellt', 'aufgeteilt'];
    if (typeof s.status === 'string' && !ohneLehrkraft.includes(s.status) && Array.isArray(s.lehrkraefte) && !s.lehrkraefte.length) {
      fehler(kx, p + '.lehrkraefte', `bei Status „${s.status}“ ist mindestens eine Lehrkraft erforderlich`);
    }
    if (Array.isArray(s.lehrkraefte)) {
      const gesehen = new Map();
      s.lehrkraefte.forEach((l, j) => {
        if (gesehen.has(l)) fehler(kx, `${p}.lehrkraefte[${j}]`, `Lehrkraft ${zeige(l)} ist zugleich Haupt- und Zweitlehrkraft derselben Stunde`);
        else gesehen.set(l, j);
      });
    }
    if (typeof s.fach === 'string' && kx.ids.klassen.has(s.klasse) && kx.ids.faecher.has(s.fach) && !tafel(s.klasse).has(s.fach)) {
      fehler(kx, p + '.fach', `Fach ${zeige(s.fach)} steht nicht in der Stundentafel der Klasse`);
    }
  }

  /* ------------------------------ Öffentlich ----------------------------- */

  /**
   * Prüft einen (normalisierten) Zustand vollständig.
   * @returns {{fehler: {pfad:string, meldung:string}[], warnungen: {pfad:string, meldung:string}[]}}
   */
  function validiere(daten) {
    if (!istObjekt(daten)) return { fehler: [{ pfad: '', meldung: `Die Datei muss ein JSON-Objekt enthalten, enthält aber ${typname(daten)}` }], warnungen: [] };
    const kx = neuerKontext(daten);
    pruefeWert(daten, ZUSTAND, '', kx);
    querpruefungen(daten, kx);
    if (kx.uebersprungen) kx.fehler.push({ pfad: '', meldung: `… und ${kx.uebersprungen} weitere Fehler` });
    return { fehler: kx.fehler, warnungen: kx.warnungen };
  }

  /** Ergänzt fehlende optionale Felder mit Standardwerten (verändert `wert`). */
  function normalisiere(wert, s = ZUSTAND) {
    if (s.art === 'objekt' && istObjekt(wert)) {
      for (const [name, fs] of Object.entries(s.felder)) {
        if (wert[name] === undefined && 'standard' in fs) {
          wert[name] = typeof fs.standard === 'function' ? fs.standard(wert) : Hilfen.tiefeKopie(fs.standard);
        }
        if (wert[name] !== undefined) normalisiere(wert[name], fs);
      }
    } else if (s.art === 'liste' && Array.isArray(wert)) {
      for (const el of wert) normalisiere(el, s.element);
    }
    return wert;
  }

  /** Kopie mit kanonischer Feldreihenfolge: bekannte Felder nach Schema, unbekannte dahinter. */
  function ordne(wert, s = ZUSTAND) {
    if (s && s.art === 'objekt' && istObjekt(wert)) {
      const ergebnis = {};
      for (const [name, fs] of Object.entries(s.felder)) if (wert[name] !== undefined) ergebnis[name] = ordne(wert[name], fs);
      for (const [name, w] of Object.entries(wert)) if (!(name in s.felder) && w !== undefined) ergebnis[name] = Hilfen.tiefeKopie(w);
      return ergebnis;
    }
    if (s && s.art === 'liste' && Array.isArray(wert)) return wert.map((el) => ordne(el, s.element));
    return Hilfen.tiefeKopie(wert);
  }

  /**
   * Migrationen: MIGRATIONEN[v] zieht Daten von Version v auf v + 1.
   * Version 1 ist die erste veröffentlichte Version; neue Einträge hier ergänzen.
   */
  const MIGRATIONEN = Object.freeze({});

  /**
   * Bringt Daten auf die aktuelle Schemaversion.
   * @returns {{daten?: object, fehler: {pfad:string, meldung:string}[], migriertVon?: number}}
   */
  function migriere(daten, migrationen = MIGRATIONEN) {
    const v = daten.schemaVersion;
    if (v === undefined) return { fehler: [{ pfad: 'schemaVersion', meldung: 'Pflichtfeld fehlt – ist das eine Datei dieses Programms?' }] };
    if (!Number.isInteger(v) || v < 0) return { fehler: [{ pfad: 'schemaVersion', meldung: `muss eine ganze Zahl sein, ist ${zeige(v)}` }] };
    if (v > Modell.SCHEMA_VERSION) {
      return { fehler: [{ pfad: 'schemaVersion', meldung: `Version ${v} ist neuer als dieses Programm (unterstützt bis Version ${Modell.SCHEMA_VERSION}). Bitte eine aktuelle Programmversion verwenden.` }] };
    }
    let d = daten;
    for (let stufe = v; stufe < Modell.SCHEMA_VERSION; stufe++) {
      const fn = migrationen[stufe];
      if (typeof fn !== 'function') return { fehler: [{ pfad: 'schemaVersion', meldung: `Version ${stufe} wird nicht mehr unterstützt (keine Migration auf ${stufe + 1})` }] };
      try {
        d = fn(d);
        d.schemaVersion = stufe + 1;
      } catch (e) {
        return { fehler: [{ pfad: 'schemaVersion', meldung: `Migration von Version ${stufe} fehlgeschlagen: ${e.message}` }] };
      }
    }
    return { daten: d, fehler: [], migriertVon: v < Modell.SCHEMA_VERSION ? v : undefined };
  }

  return { T, ZUSTAND, TEILE, SAMMLUNGEN, MIGRATIONEN, validiere, normalisiere, ordne, migriere };
})();
