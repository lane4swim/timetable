/* ==========================================================================
 * Modul BerichtReiter (Oberfläche, Reiter „Bericht“)
 * Ausfallstunden je Klasse und Fach, Vertretungsquote, Auslastung je
 * Lehrkraft (mit Zweitbesetzungsstunden und ungenutztem Kontingent),
 * Pausenaufsichten und Verstöße gegen weiche Regeln (§7). Druckbar.
 * ========================================================================== */
const BerichtReiter = (() => {
  'use strict';
  let panel = null;
  let sichtbar = () => {};
  const zeitraum = { von: null, bis: null };

  function baue(ziel) {
    panel = ziel;
    const el = App.el;
    const montag = Kern.Hilfen.wochenbeginn(Kern.Hilfen.heuteIso());
    zeitraum.von = montag;
    zeitraum.bis = Kern.Hilfen.plusTage(montag, 4);
    panel.append(
      el('div', { class: 'formular formular-zeile' },
        el('label', { class: 'feld' }, el('span', { text: 'Vertretungen von' }), el('input', { type: 'date', id: 'bericht-von', value: zeitraum.von, onchange: (e) => { zeitraum.von = e.target.value; render(); } })),
        el('label', { class: 'feld' }, el('span', { text: 'bis' }), el('input', { type: 'date', id: 'bericht-bis', value: zeitraum.bis, onchange: (e) => { zeitraum.bis = e.target.value; render(); } })),
        el('div', { class: 'feld feld-knopf' }, el('button', { type: 'button', class: 'knopf', id: 'bericht-drucken', text: 'Bericht drucken', onclick: drucke }))),
      el('div', { id: 'bericht-inhalt' }),
    );
    sichtbar = App.beobachteSichtbar(panel, render);
    render();
  }

  const prozent = (x) => (x === null ? '–' : `${Math.round(x * 1000) / 10} %`);

  function inhalt(d) {
    const el = App.el;
    const ix = Kern.Index.erstelle(d);
    const n = ix.name;
    if (!Kern.Hilfen.istIsoDatum(zeitraum.von) || !Kern.Hilfen.istIsoDatum(zeitraum.bis) || zeitraum.bis < zeitraum.von) {
      return [el('p', { class: 'fehler-text', text: '⚠ Bitte einen gültigen Zeitraum wählen.' })];
    }
    const b = Kern.Bericht.erstelle(d, zeitraum.von, zeitraum.bis);
    const tabelle = (id, titel, kopf, zeilen, zahlenAb = 99) => el('div', { class: 'tabellen-rahmen' }, el('table', { class: 'tabelle', id },
      el('caption', { text: titel }),
      el('thead', {}, el('tr', {}, ...kopf.map((t, i) => el('th', { scope: 'col', class: i >= zahlenAb ? 'zahl' : null, text: t })))),
      el('tbody', {}, ...(zeilen.length ? zeilen : [el('tr', {}, el('td', { colspan: String(kopf.length), class: 'leise', text: 'Keine Einträge.' }))]))));
    const zeile = (werte, zahlenAb = 99, attr = {}) => el('tr', attr, ...werte.map((w, i) => (i === 0 ? el('th', { scope: 'row', text: String(w) }) : el('td', { class: i >= zahlenAb ? 'zahl' : null, text: String(w) }))));

    const r = b.regelplan;
    const v = b.vertretung;
    const ueberblick = el('dl', { class: 'uebersicht', id: 'bericht-ueberblick' },
      ...[
        ['Regelplan', r.stunden ? (r.verstoesse ? `⚠ ungültig – ${r.verstoesse} Verstoß/Verstöße (${Object.entries(r.verstoesseJeRegel).map(([k, x]) => `${k} ×${x}`).join(', ')})` : '✓ gültig') : 'noch nicht erstellt'],
        ['Kostenvektor', Kern.Kosten.formatiere(r.vektor)],
        ['Ausfall im Regelplan', `${r.vektor[0]} Stunde(n) je Woche`],
        ['Unterrichtstage im Zeitraum', String(b.zeitraum.unterrichtstage)],
        ['Vertretungsfälle', String(v.faelle)],
        ['Vertretungsquote', `${prozent(v.quote)}${v.quote !== null ? ` (${v.faelle - v.ausfallStunden} von ${v.faelle} ohne Ausfall)` : ''}`],
        ['Ausfallstunden im Zeitraum', String(v.ausfallStunden)],
        ['Noch nicht vertreten', v.offen ? `⚠ ${v.offen} Stunde(n)/Aufsicht(en)` : '0'],
        ['Unbesetzte Aufsichten', `${b.aufsichten.unbesetztRegel.reduce((s, x) => s + x.anzahl, 0)} je Woche im Regelplan, ${b.aufsichten.unbesetztZeitraum.length} im Zeitraum`],
      ].flatMap(([k, w]) => [el('dt', { text: k }), el('dd', { 'data-feld': k, class: /^⚠/.test(w) ? 'fehler-text' : null, text: w })]));

    const teile = [
      el('h3', { text: 'Überblick' }), ueberblick,
      el('h3', { text: 'Ausfallstunden je Klasse und Fach' }),
      el('div', { class: 'bericht-spalten' },
        tabelle('bericht-ausfall-regel', 'Regelplan (Stunden je Woche, die nicht im Plan stehen)', ['Klasse', 'Fach', 'Stundentafel', 'im Plan', 'Ausfall'],
          r.ausfall.map((a) => zeile([n.klasse(a.klasse), n.fach(a.fach), a.soll, a.ist, a.ausfall], 2)), 2),
        tabelle('bericht-ausfall-zeitraum', `Vertretungen ${zeitraum.von} bis ${zeitraum.bis} (Entfall und Aufsicht)`, ['Klasse', 'Fach', 'Ausfallstunden'],
          v.ausfall.map((a) => zeile([n.klasse(a.klasse), a.fach ? n.fach(a.fach) : '–', a.anzahl], 2)), 2)),
      el('h3', { text: 'Vertretungsfälle nach Art' }),
      tabelle('bericht-status', `Einträge im Zeitraum (${v.faelle})`, ['Status', 'Anzahl'],
        Object.entries(v.nachStatus).map(([s, x]) => zeile([{ regulaer: 'regulär (verschoben, Ersatzraum, ohne Zweitbesetzung)', vertreten: 'vertreten', doppeltBetreut: 'Doppelbetreuung', aufgeteilt: 'aufgeteilt', entfaellt: 'entfällt', aufsicht: 'Aufsicht statt Unterricht' }[s] || s, x], 1)), 1),
      el('h3', { text: 'Auslastung je Lehrkraft (Regelplan)' }),
      tabelle('bericht-auslastung', 'Stunden je Woche; Vertretungen und Mehraufsichten im gewählten Zeitraum',
        ['Kürzel', 'Name', 'Soll', 'Reserve', 'Max', 'Haupt', 'Zweitbes.', 'Gesamt', 'Ungenutzt', 'Vertretungen', 'Aufsichten Soll', 'Aufsichten Ist', 'Mehraufsichten', 'Hinweis'],
        b.auslastung.map((a) => {
          const hinweis = a.gesamt > a.max ? '⚠ über Höchstgrenze' : a.gesamt < a.min ? 'unter Mindeststunden' : a.ungenutzt ? 'Kontingent frei' : '';
          return zeile([a.kuerzel, a.name, a.soll, a.reserve, a.max, a.haupt, a.zweit, a.gesamt, a.ungenutzt, a.vertretungen, a.aufsichtenSoll, a.aufsichtenIst, a.mehrAufsichten, hinweis], 2, { 'data-lehrkraft': a.lehrkraft });
        }), 2),
      el('h3', { text: 'Unbesetzte Pausenaufsichten' }),
      el('ul', { id: 'bericht-aufsichten' }, ...[...b.aufsichten.unbesetztRegel.map((x) => `Regelplan: ${x.text}`), ...b.aufsichten.unbesetztZeitraum.map((x) => `Vertretung: ${x.text}`)]
        .map((t) => el('li', { text: t })), ...(b.aufsichten.unbesetztRegel.length + b.aufsichten.unbesetztZeitraum.length ? [] : [el('li', { class: 'leise', text: 'Keine.' })])),
      el('h3', { text: 'Verstöße gegen weiche Regeln (Regelplan, Ziel 6)' }),
      tabelle('bericht-weich', `Planqualität K6 = ${r.vektor[6]}`, ['Regel', 'Bedeutung', 'Anzahl', 'Gewicht', 'Beitrag'],
        Kern.Kosten.WEICH.map((w) => zeile([w, r.weich[w].titel, r.weich[w].anzahl, r.weich[w].gewicht, r.weich[w].beitrag], 2)), 2),
      el('div', { class: 'bericht-posten' }, ...Kern.Kosten.WEICH.filter((w) => r.weich[w].posten.length).map((w) => el('details', {},
        el('summary', { text: `${w} – ${r.weich[w].titel} (${r.weich[w].posten.length} Posten)` }),
        el('ul', {}, ...r.weich[w].posten.slice(0, 50).map((p) => el('li', { text: `${p.text} (${p.menge})` })),
          ...(r.weich[w].posten.length > 50 ? [el('li', { class: 'leise', text: `… und ${r.weich[w].posten.length - 50} weitere` })] : []))))),
    ];
    return teile;
  }

  function render() {
    panel.querySelector('#bericht-inhalt').replaceChildren(...inhalt(App.zustand.daten));
  }

  function drucke() {
    const d = App.zustand.daten;
    const el = App.el;
    document.getElementById('druckbereich').replaceChildren(el('section', { class: 'druckseite bericht-druck' },
      el('h2', { text: `Bericht ${d.schule?.name || ''} ${d.schule?.schuljahr || ''}`.trim() }),
      el('p', { class: 'leise', text: `Vertretungen ${zeitraum.von} bis ${zeitraum.bis}` }),
      ...inhalt(d)));
    window.print();
  }

  return { sichtbar: () => sichtbar(), baue };
})();
