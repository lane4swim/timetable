/* ==========================================================================
 * Modul Modell
 * Konstanten, Standardwerte und Fabriken für den Anwendungszustand.
 * Der Zustand entspricht dem JSON-Austauschformat (Spezifikation §8).
 * ========================================================================== */
const Modell = (() => {
  'use strict';

  /** Aktuelle Version des JSON-Schemas. */
  const SCHEMA_VERSION = 1;

  /** Statuswerte einer Unterrichtsstunde im JSON (ohne Umlaute, §8). */
  const STATUS = Object.freeze({
    REGULAER: 'regulaer',
    VERTRETEN: 'vertreten',
    DOPPELT_BETREUT: 'doppeltBetreut',
    AUFGETEILT: 'aufgeteilt',
    ENTFAELLT: 'entfaellt',
    AUFSICHT: 'aufsicht',
  });

  /** Raumtypen (§2). Fachräume tragen zusätzlich einen `fachraumtyp`. */
  const RAUMTYPEN = Object.freeze(['klassenraum', 'fachraum', 'turnhalle', 'schwimmhalle']);

  /** Raumtypen, die ein Fach direkt (ohne Fachraumtyp) verlangen kann. */
  const SONDERRAUMTYPEN = Object.freeze(['turnhalle', 'schwimmhalle']);

  /** Wochentage, die das Zeitraster enthalten darf (§2: Mo–Fr). */
  const TAGE = Object.freeze(['Mo', 'Di', 'Mi', 'Do', 'Fr']);

  /** Rollen einer Zuordnung (§2). */
  const ROLLEN = Object.freeze(['haupt', 'zweit']);

  /** Voreingestellte Gewichte der weichen Regeln W1–W13 (§4). */
  const STANDARD_GEWICHTE = Object.freeze({
    W1: 10, W2: 5, W3: 8, W4: 3, W5: 4, W6: 2, W7: 2, W8: 6, W9: 4, W10: 3, W11: 5, W12: 3, W13: 4,
  });

  /** Standardeinstellungen (§8 „einstellungen“ und Annahmen des Implementierungsplans). */
  function standardEinstellungen() {
    return {
      gewichte: { ...STANDARD_GEWICHTE },
      maxDoppelbetreuungProTag: 1,
      maxDoppelbetreuungStundenAmStueck: 2,
      gewichtAufteilung: 3,
      zweitbesetzungErlaubt: true,
      maxLehrkraefteProKlasseUndSlot: 2,
      vertretungsreserveProzent: 10,
      zeitbudgetSekunden: 30,
      zufallsStartwert: 42,
    };
  }

  /**
   * Standardpausen: vor der 1. Stunde (Frühaufsicht) und danach vor jeder
   * zweiten Stunde (3., 5., 7., …), je mit `aufsichten` erforderlichen Aufsichten.
   * @param {number} stundenProTag 1–10
   * @param {number|number[]} aufsichten Anzahl je Pause (Zahl oder Liste je Pause)
   */
  function standardPausen(stundenProTag, aufsichten = 2) {
    const pausen = [];
    let nr = 0;
    for (let vor = 1; vor <= stundenProTag; vor += 2) {
      const anzahl = Array.isArray(aufsichten) ? (aufsichten[nr] ?? aufsichten[aufsichten.length - 1]) : aufsichten;
      pausen.push({
        vorStunde: vor,
        name: vor === 1 ? 'Frühaufsicht' : (nr + '. Pause'),
        aufsichten: anzahl,
      });
      nr++;
    }
    return pausen;
  }

  /**
   * Standard-Zeitraster: Mo–Fr, Stunden zu 45 Minuten ab 08:00.
   * Nach jeder zweiten Stunde eine 20-minütige Pause, sonst 5 Minuten Wechsel.
   */
  function standardZeitraster(stundenProTag = 6) {
    const stunden = [];
    let minuten = 8 * 60;
    const fmt = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    for (let nr = 1; nr <= stundenProTag; nr++) {
      if (nr > 1) minuten += (nr % 2 === 1) ? 20 : 5;
      stunden.push({ nr, von: fmt(minuten), bis: fmt(minuten + 45) });
      minuten += 45;
    }
    const doppelstundenStart = [];
    for (let nr = 1; nr < stundenProTag; nr += 2) doppelstundenStart.push(nr);
    return {
      tage: ['Mo', 'Di', 'Mi', 'Do', 'Fr'],
      stunden,
      doppelstundenStart,
      pausen: standardPausen(stundenProTag, 2),
    };
  }

  /** Leerer, gültiger Anwendungszustand. */
  function leererZustand() {
    return {
      schemaVersion: SCHEMA_VERSION,
      schule: { name: '', schuljahr: '' },
      zeitraster: standardZeitraster(6),
      faecher: [],
      lehrkraefte: [],
      raeume: [],
      klassen: [],
      zuordnungen: [],
      einstellungen: standardEinstellungen(),
      plan: { regelplan: [], aufsichten: [], vertretungen: [], aufsichtsVertretungen: [] },
    };
  }

  /** true, wenn keine Stammdaten und kein Plan vorhanden sind (dann ist Überschreiben unkritisch). */
  function istLeer(zustand) {
    const p = zustand.plan || {};
    return ['faecher', 'lehrkraefte', 'raeume', 'klassen', 'zuordnungen'].every((k) => !(zustand[k] || []).length)
      && ['regelplan', 'aufsichten', 'vertretungen', 'aufsichtsVertretungen'].every((k) => !(p[k] || []).length);
  }

  /**
   * Vergleichsschlüssel eines Raumtyps: ohne Groß-/Kleinschreibung und ohne
   * Leerzeichen am Rand („Turnhalle“ = „turnhalle“); leer → null.
   */
  function raumtypSchluessel(text) {
    if (typeof text !== 'string') return null;
    const t = text.trim().toLowerCase();
    return t || null;
  }

  /** Raumtyp, den ein Raum für Fächer bereitstellt (null: Klassenraum). */
  function raumtypDesRaums(raum) {
    if (!raum) return null;
    return raum.typ === 'fachraum' ? raumtypSchluessel(raum.fachraumtyp) : raum.typ === 'klassenraum' ? null : raum.typ;
  }

  /** Vertretungsreserve einer Lehrkraft in Stunden (aufgerundet, Annahme 11). */
  function vertretungsreserve(sollStunden, prozent) {
    const stunden = Math.ceil((sollStunden * prozent) / 100 - 1e-9);
    return stunden > 0 ? stunden : 0; // nie -0 oder negativ
  }

  return {
    SCHEMA_VERSION, STATUS, RAUMTYPEN, SONDERRAUMTYPEN, TAGE, ROLLEN, STANDARD_GEWICHTE,
    standardEinstellungen, standardPausen, standardZeitraster, leererZustand, istLeer, vertretungsreserve,
    raumtypSchluessel, raumtypDesRaums,
  };
})();
