/* ==========================================================================
 * Modul App (Oberfläche)
 * Seitengerüst mit Reitern (Spezifikation §7), Anwendungszustand und
 * Statuszeile. Reiter mit Inhalt registrieren sich über REITER[].modul.
 * ========================================================================== */
const App = (() => {
  'use strict';

  /** Reiter in der Reihenfolge von §7. `modul` baut den Inhalt (sonst Platzhalter). */
  const REITER = [
    { id: 'stammdaten', titel: 'Stammdaten', hinweis: 'Lehrkräfte, Fächer, Räume, Klassen und Zeitraster mit Pausen pflegen.', modul: () => StammdatenReiter },
    { id: 'zuordnung', titel: 'Zuordnung', hinweis: 'Stundentafeln sowie Haupt- und Zweitlehrkräfte je Klasse und Fach festlegen.', modul: () => ZuordnungReiter },
    { id: 'planung', titel: 'Planung', hinweis: 'Plan erstellen, Optionen einstellen, Kostenvektor verfolgen.', modul: () => PlanungReiter },
    { id: 'plan', titel: 'Plan', hinweis: 'Wochenraster je Klasse, Lehrkraft, Raum oder Aufsicht.' },
    { id: 'ausfall', titel: 'Ausfall', hinweis: 'Abwesenheiten erfassen und datumsgenaue Vertretungen prüfen.' },
    { id: 'bericht', titel: 'Bericht', hinweis: 'Ausfall, Vertretungsquote, Auslastung und Aufsichten auswerten.' },
    { id: 'daten', titel: 'Daten', hinweis: 'JSON exportieren, importieren oder zurücksetzen.', modul: () => DatenReiter },
  ];

  /**
   * Anwendungszustand.
   * daten:          aktueller Datenstand (Format wie JSON-Export)
   * geaendert:      es gibt Änderungen seit dem letzten vollständigen Export/Import
   * letzterExport:  Zeitpunkt des letzten vollständigen Exports (Date oder ISO-Text)
   */
  const zustand = {
    aktiv: REITER[0].id,
    daten: Kern.Modell.leererZustand(),
    geaendert: false,
    letzterExport: null,
  };
  const beobachter = new Set();
  /** Verlauf für Rückgängig/Wiederholen: Schnappschüsse des Datenstands (§7: mindestens 50 Schritte). */
  const MAX_VERLAUF = 100;
  const verlauf = { zurueck: [], vor: [] };

  /** Kleiner Helfer zum Erzeugen von Elementen ohne innerHTML. */
  function el(tag, attribute = {}, ...kinder) {
    const knoten = document.createElement(tag);
    for (const [k, v] of Object.entries(attribute)) {
      if (v === false || v == null) continue;
      if (k === 'text') knoten.textContent = v;
      else if (k.startsWith('on')) knoten.addEventListener(k.slice(2), v);
      else knoten.setAttribute(k, v === true ? '' : v);
    }
    for (const kind of kinder) if (kind != null && kind !== '') knoten.append(kind);
    return knoten;
  }

  /* --------------------------- Zustand ---------------------------------- */

  function melde() { for (const fn of beobachter) fn(zustand); }

  /** Registriert eine Funktion, die nach jeder Zustandsänderung aufgerufen wird. */
  function beobachte(fn) { beobachter.add(fn); return () => beobachter.delete(fn); }

  /**
   * Wie beobachte, aber nur solange `panel` sichtbar ist; sonst wird beim
   * nächsten Einblenden einmal nachgezeichnet. Liefert die Funktion für `sichtbar`.
   */
  function beobachteSichtbar(panel, render) {
    let veraltet = false;
    beobachte(() => { if (panel.hidden) veraltet = true; else render(); });
    return () => { if (veraltet) { veraltet = false; render(); } };
  }

  function merke(beschreibung) {
    verlauf.zurueck.push({ beschreibung, daten: zustand.daten });
    if (verlauf.zurueck.length > MAX_VERLAUF) verlauf.zurueck.shift();
    verlauf.vor = [];
  }

  /** Ersetzt den gesamten Datenstand (Import, Zurücksetzen); rückgängig machbar. */
  function setzeDaten(neu, { geaendert = false, letzterExport = zustand.letzterExport, beschreibung = 'Daten ersetzt' } = {}) {
    merke(beschreibung);
    zustand.daten = neu;
    zustand.geaendert = geaendert;
    zustand.letzterExport = letzterExport;
    melde();
  }

  /**
   * Führt eine Bearbeitung aus: `fn` verändert eine Kopie des Datenstands.
   * Mit `pruefen` (Standard) wird die Kopie vollständig validiert; bei Fehlern
   * bleibt der Stand unverändert. `fn` kann false liefern, um abzubrechen.
   * @returns {{ok: boolean, fehler: {pfad: string, meldung: string}[]}}
   */
  function aendere(beschreibung, fn, { pruefen = true } = {}) {
    const neu = structuredClone(zustand.daten);
    if (fn(neu) === false) return { ok: false, fehler: [] };
    if (pruefen) {
      Kern.Schema.normalisiere(neu);
      const { fehler } = Kern.Schema.validiere(neu);
      if (fehler.length) return { ok: false, fehler };
    }
    merke(beschreibung);
    zustand.daten = neu;
    zustand.geaendert = true;
    melde();
    return { ok: true, fehler: [] };
  }

  function rueckgaengig() {
    const schritt = verlauf.zurueck.pop();
    if (!schritt) return false;
    verlauf.vor.push({ beschreibung: schritt.beschreibung, daten: zustand.daten });
    zustand.daten = schritt.daten;
    zustand.geaendert = true;
    melde();
    return true;
  }

  function wiederholen() {
    const schritt = verlauf.vor.pop();
    if (!schritt) return false;
    verlauf.zurueck.push({ beschreibung: schritt.beschreibung, daten: zustand.daten });
    zustand.daten = schritt.daten;
    zustand.geaendert = true;
    melde();
    return true;
  }

  /** Nur für Tests: markiert den Stand als geändert, ohne Inhalt zu ändern. */
  function markiereGeaendert() { zustand.geaendert = true; melde(); }

  /** Nach einem Export: Zeitpunkt merken; ein vollständiger Export sichert alle Änderungen. */
  function vermerkeExport(zeitpunkt, vollstaendig) {
    if (vollstaendig) { zustand.letzterExport = zeitpunkt; zustand.geaendert = false; }
    melde();
  }

  /* --------------------------- Reiter ----------------------------------- */

  /** Baut Reiterleiste und Panels auf (ARIA-Tabs mit Pfeiltasten-Bedienung). */
  function baueReiter(wurzel) {
    const leiste = el('div', { role: 'tablist', 'aria-label': 'Bereiche', class: 'reiterleiste' });
    const panels = el('div', { class: 'panels' });
    for (const r of REITER) {
      leiste.append(el('button', {
        type: 'button', role: 'tab', id: 'reiter-' + r.id, class: 'reiter',
        'aria-controls': 'panel-' + r.id, 'data-reiter': r.id, text: r.titel,
        onclick: () => aktiviere(r.id, true),
      }));
      const panel = el('section', {
        role: 'tabpanel', id: 'panel-' + r.id, class: 'panel', 'aria-labelledby': 'reiter-' + r.id, tabindex: '0',
      }, el('h2', { text: r.titel }), el('p', { class: 'hinweis', text: r.hinweis }));
      panels.append(panel);
      if (r.modul) r.modul().baue(panel);
      else panel.append(el('p', { class: 'platzhalter', text: 'Dieser Bereich wird in einem späteren Meilenstein umgesetzt.' }));
    }
    leiste.addEventListener('keydown', (e) => {
      const i = REITER.findIndex((r) => r.id === zustand.aktiv);
      let ziel = null;
      if (e.key === 'ArrowRight') ziel = (i + 1) % REITER.length;
      else if (e.key === 'ArrowLeft') ziel = (i - 1 + REITER.length) % REITER.length;
      else if (e.key === 'Home') ziel = 0;
      else if (e.key === 'End') ziel = REITER.length - 1;
      if (ziel === null) return;
      e.preventDefault();
      aktiviere(REITER[ziel].id, true);
    });
    wurzel.append(leiste, panels);
  }

  /** Schaltet auf einen Reiter um; optional mit Fokus auf den Reiterknopf. */
  function aktiviere(id, fokus = false) {
    zustand.aktiv = id;
    for (const r of REITER) {
      const knopf = document.getElementById('reiter-' + r.id);
      const panel = document.getElementById('panel-' + r.id);
      const an = r.id === id;
      knopf.setAttribute('aria-selected', String(an));
      knopf.tabIndex = an ? 0 : -1;
      panel.hidden = !an;
      if (an) r.modul?.().sichtbar?.();
      if (an && fokus) knopf.focus();
    }
  }

  /* --------------------------- Statuszeile ------------------------------ */

  function setzeStatus(text, art = 'info') {
    const s = document.getElementById('status-rechenkern');
    s.textContent = text;
    s.dataset.art = art;
  }

  function zeigeSpeicherstand() {
    const s = document.getElementById('status-speicher');
    s.textContent = zustand.geaendert ? '⚠ Ungespeicherte Änderungen' : '';
    const z = document.getElementById('knopf-rueckgaengig');
    const v = document.getElementById('knopf-wiederholen');
    const oben = (liste) => liste[liste.length - 1];
    z.disabled = !verlauf.zurueck.length;
    v.disabled = !verlauf.vor.length;
    z.title = verlauf.zurueck.length ? `Rückgängig: ${oben(verlauf.zurueck).beschreibung} (Strg+Z)` : 'Nichts rückgängig zu machen';
    v.title = verlauf.vor.length ? `Wiederholen: ${oben(verlauf.vor).beschreibung} (Strg+Y)` : 'Nichts zu wiederholen';
  }

  /** Strg+Z / Strg+Y (bzw. Strg+Umschalt+Z) außerhalb von Eingabefeldern. */
  function tastenkuerzel(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const ziel = e.target;
    if (ziel && (ziel.tagName === 'INPUT' || ziel.tagName === 'TEXTAREA' || ziel.tagName === 'SELECT' || ziel.isContentEditable)) return;
    if (document.querySelector('dialog[open]')) return;
    const taste = e.key.toLowerCase();
    if (taste === 'z' && !e.shiftKey) { e.preventDefault(); rueckgaengig(); } else if (taste === 'y' || (taste === 'z' && e.shiftKey)) { e.preventDefault(); wiederholen(); }
  }

  function start() {
    const wurzel = document.getElementById('app');
    baueReiter(wurzel);
    aktiviere(zustand.aktiv);
    document.getElementById('version').textContent = 'Version ' + Kern.version;
    document.getElementById('knopf-rueckgaengig').addEventListener('click', rueckgaengig);
    document.getElementById('knopf-wiederholen').addEventListener('click', wiederholen);
    document.addEventListener('keydown', tastenkuerzel);
    beobachte(zeigeSpeicherstand);
    zeigeSpeicherstand();
    // Warnung beim Schließen des Tabs, solange es ungespeicherte Änderungen gibt (§8).
    window.addEventListener('beforeunload', (e) => {
      if (!zustand.geaendert) return;
      e.preventDefault();
      e.returnValue = '';
    });
    setzeStatus('Rechenkern wird gestartet …');
    Rechenkern.anfrage('ping')
      .then((a) => setzeStatus('Rechenkern bereit (' + a.version + ')', 'ok'))
      .catch((e) => setzeStatus('Rechenkern nicht verfügbar: ' + e.message, 'fehler'));
  }

  return {
    REITER, zustand, verlauf, el, start, aktiviere, beobachte, beobachteSichtbar, setzeDaten, aendere, rueckgaengig, wiederholen,
    markiereGeaendert, vermerkeExport,
  };
})();

// Zugriff für Tests und Fehlersuche in der Konsole.
window.Stundenplan = { Kern, App, Rechenkern, DatenReiter, PlanungReiter, StammdatenReiter, ZuordnungReiter };
document.addEventListener('DOMContentLoaded', App.start);
