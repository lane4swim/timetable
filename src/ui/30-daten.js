/* ==========================================================================
 * Modul DatenReiter (Oberfläche, Reiter „Daten“)
 * JSON exportieren (gesamt oder Teil), importieren (Dateiauswahl oder
 * Drag-and-drop), Daten zurücksetzen, Speicherstand anzeigen (§7, §8).
 * ========================================================================== */
const DatenReiter = (() => {
  'use strict';
  let panel = null;
  let meldungen = null;

  /* ---------------------------- Aufbau ---------------------------------- */

  function baue(ziel) {
    panel = ziel;
    const el = App.el;
    const dateiwahl = el('input', {
      type: 'file', accept: '.json,application/json', id: 'daten-datei', class: 'versteckt',
      onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importiereDatei(f); },
    });
    meldungen = el('div', { id: 'daten-meldungen', class: 'meldungen', 'aria-live': 'polite' });
    panel.append(
      el('section', { class: 'abschnitt', 'aria-labelledby': 'daten-stand-titel' },
        el('h3', { id: 'daten-stand-titel', text: 'Aktueller Stand' }),
        el('dl', { id: 'daten-uebersicht', class: 'uebersicht' }),
        el('p', { id: 'daten-speicherstand' })),
      el('section', { class: 'abschnitt', 'aria-labelledby': 'daten-export-titel' },
        el('h3', { id: 'daten-export-titel', text: 'Exportieren' }),
        el('p', { class: 'hinweis', text: 'Das Programm speichert nichts selbst. Sichern Sie Ihre Arbeit als JSON-Datei und importieren Sie sie später wieder.' }),
        el('div', { class: 'knopfleiste' },
          el('button', { type: 'button', class: 'knopf knopf-primaer', id: 'export-gesamt', text: 'Alles exportieren', onclick: () => exportiere('gesamt') }),
          el('button', { type: 'button', class: 'knopf', id: 'export-stammdaten', text: 'Nur Stammdaten exportieren', onclick: () => exportiere('stammdaten') }),
          el('button', { type: 'button', class: 'knopf', id: 'export-plan', text: 'Nur Plan exportieren', onclick: () => exportiere('plan') }))),
      el('section', { class: 'abschnitt', 'aria-labelledby': 'daten-import-titel' },
        el('h3', { id: 'daten-import-titel', text: 'Importieren' }),
        el('div', { class: 'ablage', id: 'daten-ablage' },
          el('p', { text: 'JSON-Datei hierher ziehen (oder irgendwo auf die Seite) oder' }),
          el('button', { type: 'button', class: 'knopf', id: 'import-waehlen', text: 'Datei auswählen …', onclick: () => dateiwahl.click() }),
          dateiwahl),
        meldungen),
      el('section', { class: 'abschnitt', 'aria-labelledby': 'daten-reset-titel' },
        el('h3', { id: 'daten-reset-titel', text: 'Zurücksetzen' }),
        el('button', { type: 'button', class: 'knopf knopf-gefahr', id: 'daten-zuruecksetzen', text: 'Alle Daten zurücksetzen …', onclick: zuruecksetzen })),
    );
    richteSeitenAblageEin();
    App.beobachte(aktualisiere);
    aktualisiere();
  }

  /** Datei-Drag-and-drop auf die ganze Seite (andere Drags, z. B. im Plan, bleiben unberührt). */
  function richteSeitenAblageEin() {
    let tiefe = 0;
    const hatDateien = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    document.addEventListener('dragenter', (e) => { if (hatDateien(e)) { tiefe++; document.body.classList.add('ablage-aktiv'); } });
    document.addEventListener('dragleave', (e) => { if (hatDateien(e) && --tiefe <= 0) { tiefe = 0; document.body.classList.remove('ablage-aktiv'); } });
    document.addEventListener('dragover', (e) => { if (hatDateien(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    document.addEventListener('drop', (e) => {
      if (!hatDateien(e)) return;
      e.preventDefault();
      tiefe = 0;
      document.body.classList.remove('ablage-aktiv');
      const datei = e.dataTransfer.files[0];
      if (!datei) return;
      App.aktiviere('daten');
      importiereDatei(datei);
    });
  }

  /* ---------------------------- Anzeige --------------------------------- */

  function aktualisiere() {
    const d = App.zustand.daten;
    const el = App.el;
    const p = d.plan || {};
    const zeilen = [
      ['Schule', d.schule?.name || '–'],
      ['Schuljahr', d.schule?.schuljahr || '–'],
      ['Lehrkräfte', d.lehrkraefte.length],
      ['Fächer', d.faecher.length],
      ['Räume', d.raeume.length],
      ['Klassen', d.klassen.length],
      ['Zuordnungen', d.zuordnungen.length],
      ['Stunden im Regelplan', (p.regelplan || []).length],
      ['Vertretungseinträge', (p.vertretungen || []).length + (p.aufsichtsVertretungen || []).length],
    ];
    const dl = panel.querySelector('#daten-uebersicht');
    dl.replaceChildren(...zeilen.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: String(v), 'data-feld': k })]));
    dl.append(...planpruefung(d));
    const stand = panel.querySelector('#daten-speicherstand');
    const exportText = App.zustand.letzterExport ? 'Zuletzt exportiert: ' + formatiere(App.zustand.letzterExport) : 'Noch nicht exportiert.';
    stand.replaceChildren(
      el('span', { text: exportText }),
      document.createTextNode(' · '),
      App.zustand.geaendert
        ? el('strong', { class: 'warnung-text', text: '⚠ Ungespeicherte Änderungen' })
        : el('span', { text: 'Keine ungespeicherten Änderungen' }));
  }

  /** Prüfung des Regelplans: harte Regeln (gültig/ungültig) und Kostenvektor (§3, §4). */
  function planpruefung(d) {
    const el = App.el;
    if (!(d.plan?.regelplan || []).length) return [];
    let verstoesse;
    let bewertung;
    try {
      verstoesse = Kern.Regeln.pruefeHart(d);
      bewertung = Kern.Kosten.bewerte(d, undefined, { mitPosten: false });
    } catch (e) {
      return [el('dt', { text: 'Regelplan' }), el('dd', { class: 'warnung-text', text: '⚠ Prüfung nicht möglich: ' + e.message })];
    }
    const zahl = Kern.Regeln.zaehle(verstoesse);
    const status = verstoesse.length
      ? el('dd', { 'data-feld': 'Regelplan', class: 'fehler-text', title: verstoesse.slice(0, 20).map((v) => v.regel + ': ' + v.text).join('\n') },
        `⚠ ungültig – ${verstoesse.length} Verstoß/Verstöße gegen harte Regeln (${Object.entries(zahl).map(([r, n]) => `${r} ×${n}`).join(', ')})`)
      : el('dd', { 'data-feld': 'Regelplan', text: '✓ gültig – keine Verstöße gegen harte Regeln' });
    return [
      el('dt', { text: 'Regelplan' }), status,
      el('dt', { text: 'Kostenvektor' }), el('dd', { 'data-feld': 'Kostenvektor', text: Kern.Kosten.formatiere(bewertung.vektor) }),
    ];
  }

  function formatiere(zeitpunkt) {
    const d = zeitpunkt instanceof Date ? zeitpunkt : new Date(zeitpunkt);
    if (Number.isNaN(d.getTime())) return String(zeitpunkt);
    return d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  }

  /** Meldung oberhalb aller älteren anzeigen (ersetzt vorherige). */
  function zeige(art, titel, ...inhalt) {
    const el = App.el;
    const symbol = { ok: '✓', fehler: '⚠', info: 'ℹ', warnung: '⚠' }[art];
    meldungen.replaceChildren(el('div', { class: 'meldung meldung-' + art, role: art === 'fehler' ? 'alert' : 'status' },
      el('p', { class: 'meldung-titel' }, el('span', { 'aria-hidden': 'true', text: symbol + ' ' }), titel),
      ...inhalt));
  }

  function liste(eintraege, klasse) {
    const el = App.el;
    return el('ul', { class: 'pfadliste ' + (klasse || '') },
      ...eintraege.map((f) => el('li', {}, f.pfad ? el('code', { text: f.pfad }) : null, f.pfad ? ': ' : '', f.meldung)));
  }

  /* ---------------------------- Export ---------------------------------- */

  function exportiere(teil) {
    const jetzt = new Date();
    const { dateiname, text } = Kern.Io.exportiere(App.zustand.daten, { teil, jetzt });
    herunterladen(dateiname, text);
    App.vermerkeExport(jetzt, teil === 'gesamt');
    zeige('ok', `Exportiert: ${dateiname}`, App.el('p', { text: teil === 'gesamt'
      ? 'Die Datei enthält den vollständigen Stand.'
      : `Die Datei enthält nur: ${Kern.Io.TEILNAMEN[teil]}.` }));
  }

  /** Download über Blob und <a download> (§8). */
  function herunterladen(dateiname, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = App.el('a', { href: url, download: dateiname, class: 'versteckt' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /* ---------------------------- Import ---------------------------------- */

  /** Liest eine Datei als Text (FileReader, §8). */
  function leseDatei(datei) {
    return new Promise((erfuellen, ablehnen) => {
      const r = new FileReader();
      r.onload = () => erfuellen(String(r.result));
      r.onerror = () => ablehnen(r.error || new Error('Datei konnte nicht gelesen werden'));
      r.readAsText(datei, 'utf-8');
    });
  }

  async function importiereDatei(datei) {
    let text;
    try {
      text = await leseDatei(datei);
    } catch (e) {
      zeige('fehler', `Import abgelehnt: ${datei.name}`, App.el('p', { text: e.message + ' Es wurden keine Daten verändert.' }));
      return false;
    }
    return importiereText(datei.name, text);
  }

  async function importiereText(name, text, optionen = {}) {
    const el = App.el;
    const erg = Kern.Io.importiere(text, App.zustand.daten, optionen);
    if (!erg.ok) {
      const n = erg.fehler.length;
      const inhalt = [el('p', { text: `Die Datei enthält ${n === 1 ? 'einen Fehler' : n + ' Fehler'}. Es wurden keine Daten verändert.` }), liste(erg.fehler)];
      if (erg.planUnvertraeglich) {
        inhalt.splice(1, 0, el('p', { text: 'Die Stammdaten selbst sind in Ordnung, aber der vorhandene Plan verweist auf Einträge, die es darin nicht mehr gibt.' }),
          el('button', { type: 'button', class: 'knopf', id: 'import-plan-verwerfen', text: 'Stammdaten übernehmen und Plan verwerfen',
            onclick: () => importiereText(name, text, { ...optionen, planVerwerfen: true }) }));
      }
      zeige('fehler', `Import abgelehnt: ${name}`, ...inhalt);
      return false;
    }
    if (!Kern.Modell.istLeer(App.zustand.daten)) {
      const bereich = { gesamt: 'alle vorhandenen Daten', stammdaten: 'die vorhandenen Stammdaten', plan: 'den vorhandenen Plan' }[erg.teil]
        + (optionen.planVerwerfen ? ' und verwirft den vorhandenen Plan' : '');
      const ja = await bestaetigeErsetzen('Vorhandene Daten ersetzen?', `Der Import von „${name}“ ersetzt ${bereich}.`);
      if (!ja) {
        zeige('info', 'Import abgebrochen', el('p', { text: 'Es wurden keine Daten verändert.' }));
        return false;
      }
    }
    // Ein vollständiger Import entspricht einem gespeicherten Stand; nach einem Teil-Import ist der Gesamtstand neu.
    App.setzeDaten(erg.zustand, {
      geaendert: erg.teil !== 'gesamt',
      letzterExport: erg.teil === 'gesamt' ? (erg.zustand.exportedAt || null) : App.zustand.letzterExport,
    });
    const inhalt = [el('p', { text: `Übernommen: ${Kern.Io.TEILNAMEN[erg.teil]}.` + (erg.migriertVon !== undefined ? ` Die Datei wurde von Schemaversion ${erg.migriertVon} aktualisiert.` : '') })];
    if (erg.warnungen.length) inhalt.push(el('p', { text: `Hinweise (${erg.warnungen.length}):` }), liste(erg.warnungen, 'hinweise'));
    zeige(erg.warnungen.length ? 'warnung' : 'ok', `Importiert: ${name}`, ...inhalt);
    return true;
  }

  /**
   * Rückfrage vor dem Überschreiben mit der Möglichkeit, vorher zu exportieren (§8).
   * @returns {Promise<boolean>}
   */
  async function bestaetigeErsetzen(titel, text) {
    for (;;) {
      const wert = await Dialog.frage({
        titel,
        text: text + (App.zustand.geaendert ? ' Es gibt ungespeicherte Änderungen.' : '') + ' Sie können den aktuellen Stand vorher exportieren.',
        knoepfe: [
          { text: 'Aktuellen Stand exportieren', wert: 'export' },
          { text: 'Ersetzen', wert: 'ersetzen', art: 'gefahr' },
          { text: 'Abbrechen', wert: 'abbrechen', fokus: true },
        ],
      });
      if (wert === 'export') { exportiere('gesamt'); continue; }
      return wert === 'ersetzen';
    }
  }

  async function zuruecksetzen() {
    if (!Kern.Modell.istLeer(App.zustand.daten)) {
      const ja = await bestaetigeErsetzen('Alle Daten zurücksetzen?', 'Alle Stammdaten, Pläne und Einstellungen werden gelöscht.');
      if (!ja) return;
    }
    App.setzeDaten(Kern.Modell.leererZustand(), { geaendert: false, letzterExport: null });
    zeige('ok', 'Daten zurückgesetzt', App.el('p', { text: 'Das Programm ist jetzt leer.' }));
  }

  return { baue, importiereDatei, importiereText, exportiere };
})();
