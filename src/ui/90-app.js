/* ==========================================================================
 * Modul App (Oberfläche)
 * Seitengerüst mit Reitern (Spezifikation §7), Anwendungszustand und
 * Statuszeile. Reiter mit Inhalt registrieren sich über REITER[].modul.
 * ========================================================================== */
const App = (() => {
  'use strict';

  /** Reiter in der Reihenfolge von §7. `modul` baut den Inhalt (sonst Platzhalter). */
  const REITER = [
    { id: 'stammdaten', titel: 'Stammdaten', hinweis: 'Lehrkräfte, Fächer, Räume, Klassen und Zeitraster mit Pausen pflegen.' },
    { id: 'zuordnung', titel: 'Zuordnung', hinweis: 'Haupt- und Zweitlehrkräfte je Klasse und Fach festlegen.' },
    { id: 'planung', titel: 'Planung', hinweis: 'Plan erstellen, Optionen einstellen, Kostenvektor verfolgen.' },
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

  /** Ersetzt den gesamten Datenstand (Import, Zurücksetzen). */
  function setzeDaten(neu, { geaendert = false, letzterExport = zustand.letzterExport } = {}) {
    zustand.daten = neu;
    zustand.geaendert = geaendert;
    zustand.letzterExport = letzterExport;
    melde();
  }

  /** Nach jeder Bearbeitung aufrufen (ab M3 über Undo/Redo). */
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
  }

  function start() {
    const wurzel = document.getElementById('app');
    baueReiter(wurzel);
    aktiviere(zustand.aktiv);
    document.getElementById('version').textContent = 'Version ' + Kern.version;
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

  return { REITER, zustand, el, start, aktiviere, beobachte, setzeDaten, markiereGeaendert, vermerkeExport };
})();

// Zugriff für Tests und Fehlersuche in der Konsole.
window.Stundenplan = { Kern, App, Rechenkern, DatenReiter };
document.addEventListener('DOMContentLoaded', App.start);
