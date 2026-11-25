/* ==========================================================================
 * Modul Hilfen
 * Allgemeine, zustandslose Hilfsfunktionen für Kern, Worker und Oberfläche:
 * deterministischer Zufall, ID-Vergabe, Kopieren, Datumsrechnung.
 * Läuft ohne DOM (Hauptthread, Web Worker, Node).
 * ========================================================================== */
const Hilfen = (() => {
  'use strict';

  /**
   * Deterministischer Zufallsgenerator (mulberry32).
   * Gleicher Startwert ⇒ gleiche Folge, auf allen Plattformen.
   * @param {number} startwert ganze Zahl
   */
  function erzeugeZufall(startwert) {
    let a = (Number(startwert) >>> 0) || 0x9e3779b9;
    /** Gleichverteilt in [0, 1). */
    function naechste() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    /** Ganze Zahl in [von, bis] (beide eingeschlossen). */
    function ganzzahl(von, bis) {
      return von + Math.floor(naechste() * (bis - von + 1));
    }
    /** Zufälliges Element eines nicht leeren Arrays. */
    function auswahl(liste) {
      return liste[Math.floor(naechste() * liste.length)];
    }
    /** Mischt eine Kopie des Arrays (Fisher-Yates). */
    function gemischt(liste) {
      const k = liste.slice();
      for (let i = k.length - 1; i > 0; i--) {
        const j = Math.floor(naechste() * (i + 1));
        [k[i], k[j]] = [k[j], k[i]];
      }
      return k;
    }
    /** Interner Zustand, um einen Lauf exakt fortsetzen zu können. */
    function zustand() { return a; }
    return { naechste, ganzzahl, auswahl, gemischt, zustand };
  }

  /**
   * Vergibt eine neue, stabile ID mit Präfix (z. B. „l-“), die in `vorhandene`
   * noch nicht vorkommt. Aus einem lesbaren Stamm (Kürzel) wird zuerst
   * `präfix-stamm` versucht, sonst wird ein Zähler angehängt.
   * @param {string} praefix z. B. "l", "k", "r", "f"
   * @param {Set<string>|string[]} vorhandene bereits vergebene IDs
   * @param {string} [stamm] lesbarer Teil, z. B. Kürzel
   */
  function neueId(praefix, vorhandene, stamm) {
    const belegt = vorhandene instanceof Set ? vorhandene : new Set(vorhandene || []);
    const basis = praefix + '-' + (normalisiereStamm(stamm) || 'x');
    if (stamm && !belegt.has(basis)) return basis;
    for (let n = 1; ; n++) {
      const kandidat = basis + n;
      if (!belegt.has(kandidat)) return kandidat;
    }
  }

  /** Macht aus einem Kürzel einen ID-tauglichen Stamm (ohne Umlaute, klein). */
  function normalisiereStamm(text) {
    if (!text) return '';
    return String(text)
      .toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 16);
  }

  /** Tiefe Kopie reiner JSON-Daten. */
  function tiefeKopie(wert) {
    return wert === undefined ? undefined : JSON.parse(JSON.stringify(wert));
  }

  /* ---------------------------- Datum ---------------------------------- */

  /** Wochentagskürzel in der Reihenfolge von Date.getUTCDay() (0 = Sonntag). */
  const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

  /** Prüft „JJJJ-MM-TT“ auf Form und Gültigkeit (kein 31.02.). */
  function istIsoDatum(text) {
    if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const d = new Date(text + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
  }

  /** Datum (ISO) → Wochentagskürzel („Mo“ … „So“). Rechnet in UTC, ohne Zeitzonenfehler. */
  function wochentag(isoDatum) {
    if (!istIsoDatum(isoDatum)) throw new Error('Ungültiges Datum: ' + isoDatum);
    return WOCHENTAGE[new Date(isoDatum + 'T00:00:00Z').getUTCDay()];
  }

  /** ISO-Datum um n Tage verschieben. */
  function plusTage(isoDatum, n) {
    const d = new Date(isoDatum + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Alle Daten im Zeitraum [von, bis], deren Wochentag in `tage` liegt
   * (z. B. ["Mo","Di","Mi","Do","Fr"]). Grundlage der datumsgenauen Vertretung.
   */
  function unterrichtstage(von, bis, tage) {
    if (!istIsoDatum(von) || !istIsoDatum(bis)) throw new Error('Ungültiger Zeitraum');
    const erlaubt = new Set(tage);
    const ergebnis = [];
    for (let d = von; d <= bis; d = plusTage(d, 1)) {
      if (erlaubt.has(wochentag(d))) ergebnis.push(d);
    }
    return ergebnis;
  }

  /** Montag der Kalenderwoche eines Datums (ISO). */
  function wochenbeginn(isoDatum) {
    const tag = new Date(isoDatum + 'T00:00:00Z').getUTCDay();
    return plusTage(isoDatum, -((tag + 6) % 7));
  }

  /** Lokales Datum als „JJJJ-MM-TT“ (für Dateinamen). */
  function heuteIso(jetzt = new Date()) {
    const z = (n) => String(n).padStart(2, '0');
    return jetzt.getFullYear() + '-' + z(jetzt.getMonth() + 1) + '-' + z(jetzt.getDate());
  }

  /** Zeitpunkt als ISO-Text in lokaler Zeit mit Zeitzonenversatz, z. B. 2026-11-25T16:59:00+01:00 (§8 exportedAt). */
  function isoMitZeitzone(jetzt = new Date()) {
    const z = (n) => String(Math.abs(n)).padStart(2, '0');
    const versatz = -jetzt.getTimezoneOffset();
    return heuteIso(jetzt) + 'T' + z(jetzt.getHours()) + ':' + z(jetzt.getMinutes()) + ':' + z(jetzt.getSeconds())
      + (versatz >= 0 ? '+' : '-') + z(Math.trunc(versatz / 60)) + ':' + z(versatz % 60);
  }

  /** Dateiname für den Export: stundenplan-JJJJ-MM-TT.json (§8). */
  function exportDateiname(jetzt = new Date(), zusatz = '') {
    return 'stundenplan-' + (zusatz ? zusatz + '-' : '') + heuteIso(jetzt) + '.json';
  }

  return {
    erzeugeZufall, neueId, normalisiereStamm, tiefeKopie,
    WOCHENTAGE, istIsoDatum, wochentag, plusTage, unterrichtstage, wochenbeginn,
    heuteIso, isoMitZeitzone, exportDateiname,
  };
})();
