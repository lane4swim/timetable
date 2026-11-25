/* ==========================================================================
 * Modul App (Oberfläche)
 * Seitengerüst mit Reitern (Spezifikation §7) und Statuszeile.
 * Die Inhalte der Reiter folgen in den Meilensteinen M3–M7.
 * ========================================================================== */
const App = (() => {
  'use strict';

  /** Reiter in der Reihenfolge von §7. */
  const REITER = [
    { id: 'stammdaten', titel: 'Stammdaten', hinweis: 'Lehrkräfte, Fächer, Räume, Klassen und Zeitraster mit Pausen pflegen.' },
    { id: 'zuordnung', titel: 'Zuordnung', hinweis: 'Haupt- und Zweitlehrkräfte je Klasse und Fach festlegen.' },
    { id: 'planung', titel: 'Planung', hinweis: 'Plan erstellen, Optionen einstellen, Kostenvektor verfolgen.' },
    { id: 'plan', titel: 'Plan', hinweis: 'Wochenraster je Klasse, Lehrkraft, Raum oder Aufsicht.' },
    { id: 'ausfall', titel: 'Ausfall', hinweis: 'Abwesenheiten erfassen und datumsgenaue Vertretungen prüfen.' },
    { id: 'bericht', titel: 'Bericht', hinweis: 'Ausfall, Vertretungsquote, Auslastung und Aufsichten auswerten.' },
    { id: 'daten', titel: 'Daten', hinweis: 'JSON exportieren, importieren oder zurücksetzen.' },
  ];

  const zustand = { aktiv: REITER[0].id, daten: Kern.Modell.leererZustand() };

  /** Kleiner Helfer zum Erzeugen von Elementen ohne innerHTML. */
  function el(tag, attribute = {}, ...kinder) {
    const knoten = document.createElement(tag);
    for (const [k, v] of Object.entries(attribute)) {
      if (v === false || v == null) continue;
      if (k === 'text') knoten.textContent = v;
      else if (k.startsWith('on')) knoten.addEventListener(k.slice(2), v);
      else knoten.setAttribute(k, v === true ? '' : v);
    }
    for (const kind of kinder) if (kind != null) knoten.append(kind);
    return knoten;
  }

  /** Baut Reiterleiste und Panels auf (ARIA-Tabs mit Pfeiltasten-Bedienung). */
  function baueReiter(wurzel) {
    const leiste = el('div', { role: 'tablist', 'aria-label': 'Bereiche', class: 'reiterleiste' });
    const panels = el('div', { class: 'panels' });
    for (const r of REITER) {
      const knopf = el('button', {
        type: 'button', role: 'tab', id: 'reiter-' + r.id, class: 'reiter',
        'aria-controls': 'panel-' + r.id, 'data-reiter': r.id, text: r.titel,
        onclick: () => aktiviere(r.id, true),
      });
      leiste.append(knopf);
      panels.append(el('section', {
        role: 'tabpanel', id: 'panel-' + r.id, class: 'panel', 'aria-labelledby': 'reiter-' + r.id, tabindex: '0',
      },
      el('h2', { text: r.titel }),
      el('p', { class: 'hinweis', text: r.hinweis }),
      el('p', { class: 'platzhalter', text: 'Dieser Bereich wird in einem späteren Meilenstein umgesetzt.' })));
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

  /** Statuszeile: Rechenkern-Zustand, Version. */
  function setzeStatus(text, art = 'info') {
    const s = document.getElementById('status-rechenkern');
    s.textContent = text;
    s.dataset.art = art;
  }

  function start() {
    const wurzel = document.getElementById('app');
    baueReiter(wurzel);
    aktiviere(zustand.aktiv);
    document.getElementById('version').textContent = 'Version ' + Kern.version;
    setzeStatus('Rechenkern wird gestartet …');
    Rechenkern.anfrage('ping')
      .then((a) => setzeStatus('Rechenkern bereit (' + a.version + ')', 'ok'))
      .catch((e) => setzeStatus('Rechenkern nicht verfügbar: ' + e.message, 'fehler'));
  }

  return { REITER, start, aktiviere, zustand };
})();

// Zugriff für Tests und Fehlersuche in der Konsole.
window.Stundenplan = { Kern, App, Rechenkern };
document.addEventListener('DOMContentLoaded', App.start);
