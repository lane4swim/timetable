/* ==========================================================================
 * Modul PlanungReiter (Oberfläche, Reiter „Planung“)
 * Optionen (Zeitbudget, Startwert, Zweitbesetzung, Vertretungsreserve,
 * Gewichte), „Plan erstellen“ im Web Worker mit Fortschritt und Abbruch,
 * Ergebnis mit Kostenvektor, Vorprüfung, Ausfall und Hinweisen (§6, §7).
 * ========================================================================== */
const PlanungReiter = (() => {
  'use strict';
  let panel = null;
  let laufId = 0;
  let laeuft = false;
  let lokalerLauf = null;

  const PHASEN = { konflikte: 'Stunden setzen und Konflikte lösen', optimierung: 'Nachoptimierung', abschluss: 'Räume, Zweitbesetzung, Aufsichten' };

  /** Eingabefelder für Einstellungen: [Schlüssel, Beschriftung, min, max, Schritt]. */
  const FELDER = [
    ['zeitbudgetSekunden', 'Zeitbudget (Sekunden)', 1, 600, 1],
    ['zufallsStartwert', 'Startwert (gleicher Wert ⇒ gleicher Plan)', 0, 4294967295, 1],
    ['vertretungsreserveProzent', 'Vertretungsreserve (% der Sollstunden)', 0, 50, 1],
  ];

  function baue(ziel) {
    panel = ziel;
    const el = App.el;
    const felder = el('div', { class: 'formular' },
      ...FELDER.map(([schluessel, text, min, max, schritt]) => feld(schluessel, text, min, max, schritt)),
      el('label', { class: 'feld feld-haken' },
        el('input', { type: 'checkbox', id: 'opt-zweitbesetzungErlaubt', onchange: (e) => setze('zweitbesetzungErlaubt', e.target.checked) }),
        el('span', { text: 'Zweitbesetzung vergeben (freie Kontingente als zweite Lehrkraft)' })));
    const gewichte = el('details', { class: 'gewichte' },
      el('summary', { text: 'Gewichte der weichen Regeln (Ziel 6)' }),
      el('div', { class: 'formular formular-gewichte' },
        ...Kern.Kosten.WEICH.map((w) => feld('gewichte.' + w, `${w} – ${Kern.Kosten.WTITEL[w]}`, 0, 1000, 1))));
    panel.append(
      el('section', { class: 'abschnitt', 'aria-labelledby': 'planung-optionen-titel' },
        el('h3', { id: 'planung-optionen-titel', text: 'Optionen' }), felder, gewichte),
      el('section', { class: 'abschnitt', 'aria-labelledby': 'planung-lauf-titel' },
        el('h3', { id: 'planung-lauf-titel', text: 'Plan erstellen' }),
        el('div', { class: 'knopfleiste' },
          el('button', { type: 'button', class: 'knopf knopf-primaer', id: 'plan-erstellen', text: 'Plan erstellen', onclick: erstelle }),
          el('button', { type: 'button', class: 'knopf', id: 'plan-abbrechen', text: 'Abbrechen (beste Lösung übernehmen)', disabled: true, onclick: abbrechen })),
        el('div', { class: 'fortschritt', id: 'planung-fortschritt', hidden: true },
          el('progress', { id: 'planung-balken', max: '1', value: '0', 'aria-label': 'Fortschritt der Planung' }),
          el('p', { id: 'planung-status', 'aria-live': 'polite' }))),
      el('section', { class: 'abschnitt', id: 'planung-ergebnis', 'aria-live': 'polite' }),
    );
    App.beobachte(zeigeEinstellungen);
    zeigeEinstellungen();
  }

  function feld(schluessel, text, min, max, schritt) {
    const el = App.el;
    const id = 'opt-' + schluessel.replace('.', '-');
    return el('label', { class: 'feld', for: id },
      el('span', { text }),
      el('input', {
        type: 'number', id, min: String(min), max: String(max), step: String(schritt), 'data-schluessel': schluessel,
        onchange: (e) => {
          const wert = Number(e.target.value);
          const ok = e.target.value !== '' && Number.isFinite(wert) && wert >= min && wert <= max && (schritt !== 1 || Number.isInteger(wert));
          e.target.setAttribute('aria-invalid', String(!ok));
          const hinweis = e.target.parentElement.querySelector('.feld-fehler');
          if (!ok) {
            const meldung = `Bitte eine ganze Zahl von ${min} bis ${max} eingeben.`;
            if (hinweis) hinweis.textContent = '⚠ ' + meldung;
            else e.target.parentElement.append(el('span', { class: 'feld-fehler', text: '⚠ ' + meldung }));
            return;
          }
          hinweis?.remove();
          setze(schluessel, wert);
        },
      }));
  }

  /** Schreibt eine Einstellung in den Zustand. */
  function setze(schluessel, wert) {
    const e = App.zustand.daten.einstellungen;
    if (schluessel.startsWith('gewichte.')) e.gewichte[schluessel.slice(9)] = wert;
    else e[schluessel] = wert;
    App.markiereGeaendert();
  }

  function zeigeEinstellungen() {
    const e = App.zustand.daten.einstellungen;
    for (const input of panel.querySelectorAll('input[data-schluessel]')) {
      if (input === document.activeElement || input.getAttribute('aria-invalid') === 'true') continue;
      const k = input.dataset.schluessel;
      input.value = String(k.startsWith('gewichte.') ? e.gewichte[k.slice(9)] : e[k]);
    }
    panel.querySelector('#opt-zweitbesetzungErlaubt').checked = !!e.zweitbesetzungErlaubt;
  }

  /* ----------------------------- Lauf ---------------------------------- */

  async function erstelle() {
    if (laeuft) return;
    const d = App.zustand.daten;
    const ergebnis = panel.querySelector('#planung-ergebnis');
    const el = App.el;
    const { fehler } = Kern.Schema.validiere(Kern.Schema.normalisiere(Kern.Hilfen.tiefeKopie(d)));
    if (fehler.length) {
      ergebnis.replaceChildren(el('div', { class: 'meldung meldung-fehler', role: 'alert' },
        el('p', { class: 'meldung-titel', text: '⚠ Die Daten sind nicht vollständig gültig' }),
        el('p', { text: `${fehler.length} Fehler, z. B. ${fehler[0].pfad}: ${fehler[0].meldung}` })));
      return;
    }
    if (!d.klassen.length) {
      ergebnis.replaceChildren(el('div', { class: 'meldung meldung-info', role: 'status' },
        el('p', { class: 'meldung-titel', text: 'ℹ Keine Klassen vorhanden' }),
        el('p', { text: 'Bitte zuerst Stammdaten erfassen oder im Reiter „Daten“ importieren.' })));
      return;
    }
    if (d.plan.regelplan.length) {
      const wert = await Dialog.frage({
        titel: 'Regelplan neu erstellen?',
        text: 'Der vorhandene Regelplan und die Pausenaufsichten werden ersetzt. Vertretungen bleiben erhalten. Sie können den aktuellen Stand vorher exportieren.',
        knoepfe: [
          { text: 'Aktuellen Stand exportieren', wert: 'export' },
          { text: 'Neu erstellen', wert: 'ja', art: 'primaer' },
          { text: 'Abbrechen', wert: 'abbrechen', fokus: true },
        ],
      });
      if (wert === 'export') DatenReiter.exportiere('gesamt');
      if (wert !== 'ja' && wert !== 'export') return;
      if (wert === 'export') {
        const nochmal = await Dialog.frage({ titel: 'Regelplan neu erstellen?', text: 'Der Stand wurde exportiert.', knoepfe: [{ text: 'Neu erstellen', wert: 'ja', art: 'primaer' }, { text: 'Abbrechen', wert: 'abbrechen', fokus: true }] });
        if (nochmal !== 'ja') return;
      }
    }
    starteLauf(Kern.Hilfen.tiefeKopie(d));
  }

  function starteLauf(zustand) {
    laeuft = true;
    const id = ++laufId;
    const beginn = Date.now();
    zeigeLaufend(true);
    aktualisiereFortschritt({ phase: 'konflikte', anteil: 0, konflikte: 0, weich: null, restMs: zustand.einstellungen.zeitbudgetSekunden * 1000 });
    const fertig = (antwort) => {
      if (id !== laufId) return;
      laeuft = false;
      lokalerLauf = null;
      zeigeLaufend(false);
      uebernehme(antwort, Date.now() - beginn);
    };
    const fehler = (e) => {
      if (id !== laufId) return;
      laeuft = false;
      zeigeLaufend(false);
      panel.querySelector('#planung-ergebnis').replaceChildren(App.el('div', { class: 'meldung meldung-fehler', role: 'alert' },
        App.el('p', { class: 'meldung-titel', text: '⚠ Planung fehlgeschlagen' }), App.el('p', { text: e.message })));
    };
    if (Rechenkern.starte()) {
      Rechenkern.anfrage('planen', { zustand }, aktualisiereFortschritt).then(fertig, fehler);
    } else {
      // Rückfall ohne Worker: in Zeitscheiben im Hauptthread
      lokalerLauf = Kern.Planer.starte(zustand);
      const takt = () => {
        try {
          const ende = lokalerLauf.schritt(30);
          aktualisiereFortschritt(lokalerLauf.fortschritt());
          if (ende) fertig(lokalerLauf.ergebnis()); else setTimeout(takt, 0);
        } catch (e) { fehler(e); }
      };
      setTimeout(takt, 0);
    }
  }

  function abbrechen() {
    if (!laeuft) return;
    if (lokalerLauf) lokalerLauf.abbrechen(); else Rechenkern.sende('abbrechen');
    panel.querySelector('#planung-status').textContent = 'Abbruch angefordert – beste bisherige Lösung wird übernommen …';
  }

  function zeigeLaufend(an) {
    panel.querySelector('#plan-erstellen').disabled = an;
    panel.querySelector('#plan-abbrechen').disabled = !an;
    panel.querySelector('#planung-fortschritt').hidden = false;
    panel.setAttribute('aria-busy', String(an));
  }

  function aktualisiereFortschritt(f) {
    panel.querySelector('#planung-balken').value = f.anteil;
    const teile = [`Phase: ${PHASEN[f.phase] || f.phase}`];
    if (f.phase === 'konflikte') teile.push(`Konflikte: ${f.konflikte}`);
    if (f.weich !== null && f.weich !== undefined) teile.push(`Zwischenwert der Optimierung: ${f.weich}`);
    if (f.ausfall) teile.push(`Ausfall bisher: ${f.ausfall} Stunde(n)`);
    teile.push(`noch höchstens ${Math.ceil(f.restMs / 1000)} s`);
    panel.querySelector('#planung-status').textContent = teile.join(' · ');
  }

  /* ---------------------------- Ergebnis -------------------------------- */

  function uebernehme(antwort, dauerMs) {
    const { plan, bericht } = antwort;
    panel.querySelector('#planung-balken').value = 1;
    panel.querySelector('#planung-status').textContent = `Fertig nach ${(dauerMs / 1000).toFixed(1)} s${bericht.statistik.abgebrochen ? ' (abgebrochen)' : ''}.`;
    const d = App.zustand.daten;
    d.plan.regelplan = plan.regelplan;
    d.plan.aufsichten = plan.aufsichten;
    App.markiereGeaendert();
    zeigeErgebnis(bericht, dauerMs);
  }

  function zeigeErgebnis(b, dauerMs) {
    const el = App.el;
    const ix = Kern.Index.erstelle(App.zustand.daten);
    const s = b.statistik;
    const kopf = s.abgebrochen ? 'Plan erstellt (abgebrochen – beste bisherige Lösung übernommen)' : 'Plan erstellt und übernommen';
    const tabelle = el('table', { class: 'tabelle', id: 'planung-vektor' },
      el('caption', { text: 'Kostenvektor (lexikografisch: ein früheres Ziel geht immer vor)' }),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Ziel' }), el('th', { scope: 'col', text: 'Bedeutung' }), el('th', { scope: 'col', class: 'zahl', text: 'Wert' }))),
      el('tbody', {}, ...Kern.Kosten.ZIELE.map((k, i) => el('tr', { 'data-ziel': k },
        el('th', { scope: 'row', text: k }), el('td', { text: Kern.Kosten.ZIELTITEL[k] }), el('td', { class: 'zahl', text: String(b.vektor[i]) })))));
    const teile = [
      el('h3', { text: 'Ergebnis' }),
      el('div', { class: 'meldung ' + (b.verstoesse.length ? 'meldung-fehler' : 'meldung-ok'), role: 'status' },
        el('p', { class: 'meldung-titel', text: (b.verstoesse.length ? '⚠ ' : '✓ ') + kopf }),
        el('p', { text: b.verstoesse.length
          ? `${b.verstoesse.length} Verstöße gegen harte Regeln – bitte melden: ${b.verstoesse[0].regel} ${b.verstoesse[0].text}`
          : `Keine Verstöße gegen harte Regeln. ${b.ausfallMinimalNachgewiesen ? `Ausfall nachweislich minimal (${b.vektor[0]} Stunde(n), untere Schranke ${b.untereSchrankeK1}).` : `Ausfall ${b.vektor[0]} Stunde(n), untere Schranke ${b.untereSchrankeK1}.`}` }),
        el('p', { class: 'leise', text: `Dauer ${(dauerMs / 1000).toFixed(1)} s · ${s.iterationenKonflikte} Konflikt- und ${s.iterationenOptimierung} Optimierungsschritte${s.zeitbudgetErreicht ? ' · Zeitbudget erreicht (Ergebnis ggf. nicht reproduzierbar)' : ''}` })),
      tabelle,
    ];
    if (b.ausfall.length) {
      teile.push(el('h4', { text: 'Ausfall' }), el('ul', { id: 'planung-ausfall' },
        ...b.ausfall.map((a) => el('li', { text: `${ix.name.klasse(a.klasse)} ${ix.name.fach(a.fach)}: ${a.stunden} Stunde(n) – ${a.grund}` }))));
    }
    if (b.warnungen.length) {
      teile.push(el('h4', { text: 'Hinweise der Vorprüfung' }), el('ul', { id: 'planung-hinweise' }, ...b.warnungen.map((w) => el('li', { text: w }))));
    }
    const weich = b.bewertung.weich;
    teile.push(el('details', {},
      el('summary', { text: 'Aufschlüsselung der Planqualität (Ziel 6)' }),
      el('table', { class: 'tabelle' },
        el('thead', {}, el('tr', {}, ...['Regel', 'Bedeutung', 'Anzahl', 'Gewicht', 'Beitrag'].map((t, i) => el('th', { scope: 'col', class: i > 1 ? 'zahl' : null, text: t })))),
        el('tbody', {}, ...Kern.Kosten.WEICH.map((w) => el('tr', {},
          el('th', { scope: 'row', text: w }), el('td', { text: weich[w].titel }),
          el('td', { class: 'zahl', text: String(weich[w].anzahl) }), el('td', { class: 'zahl', text: String(weich[w].gewicht) }),
          el('td', { class: 'zahl', text: String(weich[w].beitrag) })))))));
    panel.querySelector('#planung-ergebnis').replaceChildren(...teile);
  }

  return { baue, erstelle, abbrechen };
})();
