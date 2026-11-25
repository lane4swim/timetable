/* ==========================================================================
 * Modul AusfallReiter (Oberfläche, Reiter „Ausfall“)
 * Abwesenheiten erfassen (Lehrkraft oder Raum, Zeitraum), datumsgenaue
 * Vertretungsvorschläge je Stunde und Pause prüfen, übernehmen, ändern
 * (Alternative wählen) oder verwerfen (§5, §7). Nichts wird ohne Bestätigung
 * übernommen. Dazu der Tagesvertretungsplan mit Konflikten und Ausfallbericht.
 * ========================================================================== */
const AusfallReiter = (() => {
  'use strict';
  let panel = null;
  let sichtbar = () => {};
  const zeitraum = { von: null, bis: null };
  let vorschlaege = [];
  let berechnet = false;
  const verworfen = new Set();
  let tagesDatum = null;

  /* ------------------------------ Aufbau ------------------------------- */

  function baue(ziel) {
    panel = ziel;
    const el = App.el;
    const heute = Kern.Hilfen.heuteIso();
    zeitraum.von = heute;
    zeitraum.bis = Kern.Hilfen.plusTage(heute, 4);
    tagesDatum = heute;
    panel.append(
      el('section', { class: 'abschnitt', 'aria-labelledby': 'ausfall-erfassen-titel' },
        el('h3', { id: 'ausfall-erfassen-titel', text: 'Abwesenheit erfassen' }),
        el('div', { class: 'formular formular-zeile' },
          el('label', { class: 'feld' }, el('span', { text: 'Art' }),
            el('select', { id: 'abw-art', onchange: () => fuelleWer() }, el('option', { value: 'lehrkraft', text: 'Lehrkraft' }), el('option', { value: 'raum', text: 'Raum' }))),
          el('label', { class: 'feld' }, el('span', { text: 'Wer / welcher Raum' }), el('select', { id: 'abw-wer' })),
          el('label', { class: 'feld' }, el('span', { text: 'Von' }), el('input', { type: 'date', id: 'abw-von', value: heute })),
          el('label', { class: 'feld' }, el('span', { text: 'Bis' }), el('input', { type: 'date', id: 'abw-bis', value: heute })),
          el('label', { class: 'feld' }, el('span', { text: 'Grund (optional)' }), el('input', { type: 'text', id: 'abw-grund' })),
          el('div', { class: 'feld feld-knopf' }, el('button', { type: 'button', class: 'knopf knopf-primaer', id: 'abw-erfassen', text: 'Erfassen', onclick: erfasse }))),
        el('div', { class: 'meldungen', id: 'abw-meldung', 'aria-live': 'polite' }),
        el('div', { class: 'tabellen-rahmen' }, el('table', { class: 'tabelle', id: 'abw-liste' }))),
      el('section', { class: 'abschnitt abschnitt-breit', 'aria-labelledby': 'ausfall-vorschlaege-titel' },
        el('h3', { id: 'ausfall-vorschlaege-titel', text: 'Vertretungsvorschläge' }),
        el('p', { class: 'hinweis', text: 'Je betroffener Stunde und Pause die günstigste Lösung nach der Eskalationskette (Zweitbesetzung rückt auf → Umplanen → Lehrkraft der Klasse → andere Lehrkraft → Doppelbetreuung → Aufteilung → Entfall/Nachrücken/Aufsicht). Nichts wird ohne Bestätigung übernommen.' }),
        el('div', { class: 'formular formular-zeile' },
          el('label', { class: 'feld' }, el('span', { text: 'Von' }), el('input', { type: 'date', id: 'vs-von', value: zeitraum.von, onchange: (e) => { zeitraum.von = e.target.value; } })),
          el('label', { class: 'feld' }, el('span', { text: 'Bis' }), el('input', { type: 'date', id: 'vs-bis', value: zeitraum.bis, onchange: (e) => { zeitraum.bis = e.target.value; } })),
          el('div', { class: 'feld feld-knopf knopfleiste' },
            el('button', { type: 'button', class: 'knopf knopf-primaer', id: 'vs-berechnen', text: 'Vorschläge berechnen', onclick: () => { berechne(true); renderTag(); } }),
            el('button', { type: 'button', class: 'knopf', id: 'vs-alle', text: 'Alle übernehmen', onclick: alleUebernehmen }))),
        el('p', { id: 'vs-status', class: 'leise', 'aria-live': 'polite' }),
        el('div', { class: 'tabellen-rahmen' }, el('table', { class: 'tabelle vorschlaege', id: 'vs-tabelle' }))),
      el('section', { class: 'abschnitt abschnitt-breit', 'aria-labelledby': 'ausfall-tag-titel' },
        el('h3', { id: 'ausfall-tag-titel', text: 'Tagesvertretungsplan' }),
        el('div', { class: 'formular formular-zeile' },
          el('label', { class: 'feld' }, el('span', { text: 'Datum' }), el('input', { type: 'date', id: 'tag-datum', value: tagesDatum, onchange: (e) => { tagesDatum = e.target.value; renderTag(); } })),
          el('div', { class: 'feld feld-knopf' }, el('button', { type: 'button', class: 'knopf', id: 'tag-drucken', text: 'Tagesplan drucken', onclick: drucke }))),
        el('div', { id: 'tag-inhalt' })),
    );
    fuelleWer();
    sichtbar = App.beobachteSichtbar(panel, render);
    render();
  }

  function fuelleWer() {
    const d = App.zustand.daten;
    const art = panel.querySelector('#abw-art').value;
    const liste = art === 'raum' ? d.raeume.map((r) => [r.id, r.name]) : d.lehrkraefte.map((l) => [l.id, `${l.kuerzel} – ${l.name}`]);
    const wahl = panel.querySelector('#abw-wer');
    const alt = wahl.value;
    wahl.replaceChildren(...liste.map(([id, t]) => App.el('option', { value: id, text: t, selected: id === alt })));
  }

  /* ---------------------------- Abwesenheiten -------------------------- */

  function meldung(art, titel, text) {
    panel.querySelector('#abw-meldung').replaceChildren(App.el('div', { class: 'meldung meldung-' + art, role: art === 'fehler' ? 'alert' : 'status' },
      App.el('p', { class: 'meldung-titel', text: (art === 'fehler' ? '⚠ ' : '✓ ') + titel }), text ? App.el('p', { text }) : null));
  }

  function erfasse() {
    const art = panel.querySelector('#abw-art').value;
    const id = panel.querySelector('#abw-wer').value;
    const von = panel.querySelector('#abw-von').value;
    const bis = panel.querySelector('#abw-bis').value || von;
    const grund = panel.querySelector('#abw-grund').value.trim();
    if (!id) return meldung('fehler', 'Bitte eine Lehrkraft oder einen Raum wählen.');
    if (!Kern.Hilfen.istIsoDatum(von) || !Kern.Hilfen.istIsoDatum(bis)) return meldung('fehler', 'Bitte gültige Daten eingeben.');
    if (bis < von) return meldung('fehler', 'Das Ende liegt vor dem Beginn.');
    const sammlung = art === 'raum' ? 'raeume' : 'lehrkraefte';
    const d0 = App.zustand.daten;
    const name = art === 'raum' ? d0.raeume.find((r) => r.id === id)?.name : d0.lehrkraefte.find((l) => l.id === id)?.kuerzel;
    const alt = { ...zeitraum, tagesDatum, berechnet };
    setzeZeitraum(von, bis);
    berechnet = true; // die Änderung zeichnet neu und berechnet die Vorschläge für den neuen Zeitraum
    const r = App.aendere(`Abwesenheit ${name} ${von}–${bis} erfasst`, (d) => {
      d[sammlung].find((x) => x.id === id).abwesenheiten.push({ von, bis, grund });
    });
    if (!r.ok) {
      setzeZeitraum(alt.von, alt.bis);
      tagesDatum = alt.tagesDatum;
      berechnet = alt.berechnet;
      return meldung('fehler', 'Abwesenheit nicht erfasst', r.fehler[0]?.meldung);
    }
    meldung('ok', `Abwesenheit ${name} vom ${von} bis ${bis} erfasst.`, 'Die Vorschläge für diesen Zeitraum stehen unten.');
    return undefined;
  }

  function setzeZeitraum(von, bis) {
    zeitraum.von = von;
    zeitraum.bis = bis;
    panel.querySelector('#vs-von').value = von;
    panel.querySelector('#vs-bis').value = bis;
    tagesDatum = Kern.Hilfen.unterrichtstage(von, bis, App.zustand.daten.zeitraster.tage)[0] || von;
    panel.querySelector('#tag-datum').value = tagesDatum;
  }

  function renderAbwesenheiten(d) {
    const el = App.el;
    const zeilen = [
      ...d.lehrkraefte.flatMap((l) => l.abwesenheiten.map((a, i) => ({ art: 'Lehrkraft', sammlung: 'lehrkraefte', id: l.id, name: `${l.kuerzel} – ${l.name}`, a, i }))),
      ...d.raeume.flatMap((r) => r.abwesenheiten.map((a, i) => ({ art: 'Raum', sammlung: 'raeume', id: r.id, name: r.name, a, i }))),
    ].sort((x, y) => x.a.von.localeCompare(y.a.von));
    panel.querySelector('#abw-liste').replaceChildren(
      el('caption', { text: `Erfasste Abwesenheiten (${zeilen.length})` }),
      el('thead', {}, el('tr', {}, ...['Art', 'Wer', 'Von', 'Bis', 'Grund', 'Aktionen'].map((t) => el('th', { scope: 'col', text: t })))),
      el('tbody', {}, ...(zeilen.length ? zeilen.map((z) => el('tr', {},
        el('td', { text: z.art }), el('th', { scope: 'row', text: z.name }), el('td', { text: z.a.von }), el('td', { text: z.a.bis }), el('td', { text: z.a.grund || '–' }),
        el('td', { class: 'knopfleiste' },
          el('button', { type: 'button', class: 'knopf knopf-klein', text: 'Vorschläge', 'aria-label': `Vorschläge für ${z.name} ${z.a.von}–${z.a.bis}`, onclick: () => { setzeZeitraum(z.a.von, z.a.bis); berechne(true); renderTag(); } }),
          el('button', {
            type: 'button', class: 'knopf knopf-klein knopf-gefahr', text: 'Löschen', 'aria-label': `Abwesenheit ${z.name} ${z.a.von}–${z.a.bis} löschen`,
            onclick: () => App.aendere(`Abwesenheit ${z.name} ${z.a.von}–${z.a.bis} gelöscht`, (x) => { x[z.sammlung].find((e) => e.id === z.id).abwesenheiten.splice(z.i, 1); }),
          }))))
        : [el('tr', {}, el('td', { colspan: '6', class: 'leise', text: 'Keine Abwesenheiten erfasst.' }))])));
  }

  /* ----------------------------- Vorschläge ---------------------------- */

  function berechne(verworfeneZuruecksetzen) {
    if (verworfeneZuruecksetzen) verworfen.clear();
    const status = panel.querySelector('#vs-status');
    const d = App.zustand.daten;
    if (!d.plan.regelplan.length) { vorschlaege = []; berechnet = true; status.textContent = 'Noch kein Regelplan – bitte zuerst im Reiter „Planung“ erstellen.'; renderVorschlaege(); return; }
    if (!Kern.Hilfen.istIsoDatum(zeitraum.von) || !Kern.Hilfen.istIsoDatum(zeitraum.bis) || zeitraum.bis < zeitraum.von) { status.textContent = '⚠ Bitte einen gültigen Zeitraum wählen.'; return; }
    const t0 = performance.now();
    vorschlaege = Kern.Vertretung.vorschlaege(d, zeitraum.von, zeitraum.bis, { ausgeschlossen: verworfen });
    berechnet = true;
    const ohne = vorschlaege.filter((v) => v.stufe === 8).length;
    status.textContent = vorschlaege.length
      ? `${vorschlaege.length === 1 ? 'Ein Vorschlag' : vorschlaege.length + ' Vorschläge'} für ${zeitraum.von} bis ${zeitraum.bis}${ohne ? ` – ⚠ ${ohne} ohne regelkonforme Lösung` : ''} (berechnet in ${((performance.now() - t0) / 1000).toFixed(1)} s).`
      : `Im Zeitraum ${zeitraum.von} bis ${zeitraum.bis} ist nichts (mehr) zu vertreten.${verworfen.size ? ` ${verworfen.size} verworfene Vorschläge ausgeblendet.` : ''}`;
    renderVorschlaege();
  }

  function renderVorschlaege() {
    const el = App.el;
    const d = App.zustand.daten;
    const ix = Kern.Index.erstelle(d);
    const n = ix.name;
    const tabelle = panel.querySelector('#vs-tabelle');
    if (!vorschlaege.length) { tabelle.replaceChildren(); return; }
    const kopf = el('thead', {}, el('tr', {}, ...['Datum', 'Zeit', 'Betroffen', 'Ausfall', 'Vorschlag', 'Kosten (K1 K1A K2 K3 K4)', 'Aktion'].map((t) => el('th', { scope: 'col', text: t }))));
    const zeilen = vorschlaege.map((v, nr) => {
      const zeit = v.art === 'aufsicht' ? n.pause(Kern.Hilfen.wochentag(v.datum), v.vorStunde).replace(/^\S+ /, '') : `${v.stunde}. Stunde`;
      const betroffen = v.art === 'aufsicht' ? 'Pausenaufsicht' : `${n.klasse(v.klasse)} ${n.fach(Kern.Vertretung.tagesplan(d, v.datum).stunden.find((s) => s.klasse === v.klasse && s.stunde === v.stunde)?.fach)}`;
      const ausfall = v.art === 'raum' ? `Raum ${n.raum(v.raum)}` : v.art === 'zweit' ? `${n.lehrkraft(v.lehrkraft)} (Zweitbesetzung)` : n.lehrkraft(v.lehrkraft);
      const optionen = [v, ...v.alternativen];
      const auswahl = el('select', { class: 'vs-auswahl', 'aria-label': `Lösung für ${betroffen} ${v.datum} ${zeit}` },
        ...optionen.map((o, i) => el('option', { value: String(i), text: `${i === 0 ? '★ ' : ''}Stufe ${o.stufe}: ${o.stufeText} – ${o.text}` })));
      const beschreibung = el('div', {}, el('strong', { text: `${v.stufe === 8 ? '⚠ ' : ''}Stufe ${v.stufe}: ${v.stufeText}` }), el('div', { class: 'vs-text', text: v.text }));
      const kosten = el('td', { class: 'zahl', text: v.vektor ? v.vektor.slice(0, 5).join(' ') : '–' });
      auswahl.addEventListener('change', () => {
        const o = optionen[Number(auswahl.value)];
        beschreibung.replaceChildren(el('strong', { text: `${o.stufe === 8 ? '⚠ ' : ''}Stufe ${o.stufe}: ${o.stufeText}` }), el('div', { class: 'vs-text', text: o.text }));
        kosten.textContent = o.vektor ? o.vektor.slice(0, 5).join(' ') : '–';
      });
      return el('tr', { 'data-schluessel': v.schluessel, class: v.stufe === 8 ? 'vs-problem' : null },
        el('td', { text: v.datum }), el('td', { text: zeit }), el('th', { scope: 'row', text: betroffen }), el('td', { text: ausfall }),
        el('td', {}, beschreibung, optionen.length > 1 ? el('details', {}, el('summary', { text: `Andere Lösung wählen (${optionen.length - 1})` }), auswahl) : null),
        kosten,
        el('td', { class: 'knopfleiste' },
          el('button', { type: 'button', class: 'knopf knopf-klein knopf-primaer', 'data-aktion': 'uebernehmen', text: 'Übernehmen', onclick: () => uebernehme(nr, optionen[Number(auswahl.value)]) }),
          el('button', { type: 'button', class: 'knopf knopf-klein', 'data-aktion': 'verwerfen', text: 'Verwerfen', onclick: () => { verworfen.add(v.schluessel); berechne(false); } })));
    });
    tabelle.replaceChildren(el('caption', { text: 'Vorschläge (★ = günstigste Lösung)' }), kopf, el('tbody', {}, ...zeilen));
  }

  /** Übernimmt eine Lösung; die Änderung zeichnet neu (Vorschläge und Tagesplan). */
  function uebernehme(nr, loesung) {
    const v = vorschlaege[nr];
    tagesDatum = v.datum;
    panel.querySelector('#tag-datum').value = tagesDatum;
    const r = App.aendere(`Vertretung übernommen: ${v.wo} – ${loesung.stufeText}`, (d) => Kern.Vertretung.uebernehmen(d, loesung));
    if (!r.ok) panel.querySelector('#vs-status').textContent = '⚠ Nicht übernommen: ' + (r.fehler[0]?.meldung || '');
  }

  function alleUebernehmen() {
    if (!vorschlaege.length) return;
    const anzahl = vorschlaege.length;
    const kopie = vorschlaege.slice();
    App.aendere(`${anzahl} Vertretungsvorschläge übernommen`, (d) => { for (const v of kopie) Kern.Vertretung.uebernehmen(d, v); });
    panel.querySelector('#vs-status').textContent = `${anzahl === 1 ? 'Ein Vorschlag' : anzahl + ' Vorschläge'} übernommen. ` + panel.querySelector('#vs-status').textContent;
  }

  /* -------------------------- Tagesvertretungsplan --------------------- */

  function tagesInhalt(d, fuerDruck) {
    const el = App.el;
    const ix = Kern.Index.erstelle(d);
    const n = ix.name;
    const datum = tagesDatum;
    if (!Kern.Hilfen.istIsoDatum(datum)) return [el('p', { class: 'leise', text: 'Bitte ein Datum wählen.' })];
    const tag = Kern.Hilfen.wochentag(datum);
    if (!ix.tage.includes(tag)) return [el('p', { class: 'leise', text: `${datum} ist ein ${tag} – kein Unterrichtstag.` })];
    const tp = Kern.Vertretung.tagesplan(d, datum);
    const regel = new Map(d.plan.regelplan.filter((s) => s.tag === tag).map((s) => [s.klasse + '|' + s.stunde, s]));
    const eintraege = d.plan.vertretungen.map((v, i) => [v, i]).filter(([v]) => v.datum === datum)
      .sort(([a], [b]) => a.stunde - b.stunde || n.klasse(a.klasse).localeCompare(n.klasse(b.klasse)));
    const aufs = d.plan.aufsichtsVertretungen.map((v, i) => [v, i]).filter(([v]) => v.datum === datum);
    const status = { regulaer: 'regulär', vertreten: 'vertreten', doppeltBetreut: '⇄ Doppelbetreuung', aufgeteilt: 'aufgeteilt', entfaellt: 'entfällt', aufsicht: 'Aufsicht' };
    const wer = (liste) => (liste || []).map((l, r) => (r ? '+' : '') + n.lehrkraft(l)).join(' ') || '–';
    const teile = [];
    teile.push(el('table', { class: 'tabelle', id: fuerDruck ? null : 'tag-vertretungen' },
      el('caption', { text: `Vertretungen am ${tag}, ${datum} (${eintraege.length})` }),
      el('thead', {}, el('tr', {}, ...['Stunde', 'Klasse', 'Fach', 'Regulär', 'Status', 'Lehrkraft', 'Raum', 'Grund', ...(fuerDruck ? [] : [''])].map((t) => el('th', { scope: 'col', text: t })))),
      el('tbody', {}, ...(eintraege.length ? eintraege.map(([v, i]) => {
        const r = regel.get(v.klasse + '|' + v.stunde);
        const zusatz = v.status === 'doppeltBetreut' && v.mitKlasse ? ` mit ${n.klasse(v.mitKlasse)}` : v.status === 'aufgeteilt' ? ': ' + (v.verteilung || []).map((g) => `${g.gruppe ? 'Gruppe ' + g.gruppe + ' ' : ''}→ ${n.klasse(g.zielKlasse)} (${g.anzahl})`).join(', ') : '';
        return el('tr', {},
          el('td', { text: `${v.stunde}.` }), el('th', { scope: 'row', text: n.klasse(v.klasse) }), el('td', { text: n.fach(v.fach ?? r?.fach) }),
          el('td', { text: r ? `${n.fach(r.fach)} ${wer(r.lehrkraefte)}` : '–' }), el('td', { text: status[v.status] + zusatz }),
          el('td', { text: wer(v.lehrkraefte) }), el('td', { text: v.raum ? n.raum(v.raum) : '–' }), el('td', { text: Kern.Vertretung.GRUENDE[v.grund] || v.grund || '' }),
          ...(fuerDruck ? [] : [el('td', {}, el('button', { type: 'button', class: 'mini', 'aria-label': `Vertretung ${n.klasse(v.klasse)} ${v.stunde}. Stunde entfernen`, text: '×', onclick: () => App.aendere(`Vertretung ${n.klasse(v.klasse)} ${datum} ${v.stunde}. entfernt`, (x) => { x.plan.vertretungen.splice(i, 1); }) }))]));
      }) : [el('tr', {}, el('td', { colspan: '9', class: 'leise', text: 'Keine Vertretungen an diesem Tag.' }))]))));
    if (aufs.length) {
      teile.push(el('table', { class: 'tabelle', id: fuerDruck ? null : 'tag-aufsichten' },
        el('caption', { text: 'Aufsichtsvertretungen' }),
        el('thead', {}, el('tr', {}, ...['Pause', 'für', 'Vertretung', ...(fuerDruck ? [] : [''])].map((t) => el('th', { scope: 'col', text: t })))),
        el('tbody', {}, ...aufs.map(([a, i]) => el('tr', {},
          el('td', { text: n.pause(tag, a.vorStunde).replace(/^\S+ /, '') }), el('td', { text: n.lehrkraft(a.fuer) }),
          el('td', { class: a.status === 'unbesetzt' ? 'fehler-text' : null, text: a.status === 'unbesetzt' ? '⚠ unbesetzt' : n.lehrkraft(a.lehrkraft) }),
          ...(fuerDruck ? [] : [el('td', {}, el('button', { type: 'button', class: 'mini', 'aria-label': 'Aufsichtsvertretung entfernen', text: '×', onclick: () => App.aendere(`Aufsichtsvertretung ${datum} entfernt`, (x) => { x.plan.aufsichtsVertretungen.splice(i, 1); }) }))]))))));
    }
    if (!fuerDruck) {
      const verstoesse = Kern.Regeln.pruefeHart(d, tp, { datum });
      const offen = Kern.Vertretung.betroffen(d, datum);
      teile.push(el('div', { class: 'meldung ' + (verstoesse.length ? 'meldung-fehler' : 'meldung-ok'), id: 'tag-pruefung', role: 'status' },
        el('p', { class: 'meldung-titel', text: verstoesse.length ? `⚠ ${verstoesse.length} Konflikt(e) im Tagesplan` : '✓ Tagesplan ohne Verstöße gegen harte Regeln' }),
        offen.length ? el('p', { text: `${offen.length} betroffene Stunde(n)/Aufsicht(en) sind noch nicht vertreten.` }) : null,
        verstoesse.length ? el('ul', { class: 'pfadliste' }, ...verstoesse.slice(0, 30).map((v) => el('li', {}, el('strong', { text: v.regel }), ' ' + v.text))) : null));
    }
    const bericht = Kern.Vertretung.ausfallbericht(d, datum, datum);
    teile.push(el('h4', { text: `Ausfallbericht (${bericht.length})` }), bericht.length
      ? el('ul', { id: fuerDruck ? null : 'tag-ausfall' }, ...bericht.map((b) => el('li', { text: `${b.stunde}. Stunde ${b.klasse} ${b.fach}: ${b.status === 'aufsicht' ? 'Aufsicht statt Unterricht' : 'entfällt'} – ${b.grund}` })))
      : el('p', { class: 'leise', text: 'Kein Unterrichtsausfall.' }));
    return teile;
  }

  function renderTag() {
    panel.querySelector('#tag-inhalt').replaceChildren(...tagesInhalt(App.zustand.daten, false));
  }

  function drucke() {
    const d = App.zustand.daten;
    const el = App.el;
    document.getElementById('druckbereich').replaceChildren(el('section', { class: 'druckseite' },
      el('h2', { text: `Vertretungsplan ${Kern.Hilfen.istIsoDatum(tagesDatum) ? Kern.Hilfen.wochentag(tagesDatum) + ', ' : ''}${tagesDatum}` }),
      el('p', { class: 'leise', text: `${d.schule?.name || ''} ${d.schule?.schuljahr || ''}`.trim() }),
      ...tagesInhalt(d, true)));
    window.print();
  }

  /* ------------------------------ Render ------------------------------- */

  function render() {
    const d = App.zustand.daten;
    fuelleWer();
    renderAbwesenheiten(d);
    if (berechnet) {
      // Vorschläge passen nicht mehr zum geänderten Stand → neu berechnen
      berechne(false);
    }
    renderTag();
  }

  return { sichtbar: () => sichtbar(), baue, berechne, setzeZeitraum, vorschlaege: () => vorschlaege };
})();
