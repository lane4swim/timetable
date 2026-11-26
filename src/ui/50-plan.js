/* ==========================================================================
 * Modul PlanReiter (Oberfläche, Reiter „Plan“)
 * Wochenraster des Regelplans (§7) mit Umschalter Klasse / Lehrkraft / Raum /
 * Aufsicht. Pausen stehen als schmale Zeilen zwischen den Stunden.
 *   - Drag-and-drop: Stunde verschieben (in der Klasse tauschen), Aufsicht
 *     verschieben, Lehrkraft aus „Freie Kontingente“ als Zweitbesetzung bzw.
 *     aus „Aufsichtssoll offen“ als Aufsicht ablegen
 *   - Tastatur: Pfeiltasten wählen die Zelle, Enter/Leertaste nimmt auf bzw.
 *     legt ab, Esc bricht ab, Entf entfernt Zweitbesetzung bzw. Aufsicht
 *   - Konflikte: rot umrandet, mit ⚠ und Regelnummer (nie nur Farbe)
 *   - Druckansicht je Klasse und Lehrkraft (einzeln oder alle)
 * ========================================================================== */
const PlanReiter = (() => {
  'use strict';
  const MIME = 'application/x-stundenplan';
  let panel = null;
  let sichtbar = () => {};
  const ansicht = { art: 'klasse', id: null };
  let aufgenommen = null; // { art: 'stunde'|'aufsicht'|'zweit'|'aufsichtNeu', index?, lehrkraft? }
  let aktiv = { zeile: 0, spalte: 0 };
  let letzteDauerMs = 0;

  const ARTEN = [['klasse', 'Klasse'], ['lehrkraft', 'Lehrkraft'], ['raum', 'Raum'], ['aufsicht', 'Aufsicht']];

  /* ------------------------------ Aufbau ------------------------------- */

  function baue(ziel) {
    panel = ziel;
    const el = App.el;
    panel.append(
      el('div', { class: 'plan-werkzeuge' },
        el('div', { class: 'umschalter', role: 'group', 'aria-label': 'Ansicht' },
          ...ARTEN.map(([art, titel]) => el('button', { type: 'button', class: 'knopf', id: 'ansicht-' + art, 'aria-pressed': String(art === ansicht.art), text: titel, onclick: () => wechsle(art) }))),
        el('label', { class: 'feld-zeile' }, el('span', { id: 'plan-auswahl-titel', text: 'Klasse' }),
          el('select', { id: 'plan-auswahl', 'aria-labelledby': 'plan-auswahl-titel', onchange: (e) => { ansicht.id = e.target.value; render(); } })),
        el('button', { type: 'button', class: 'knopf', id: 'plan-drucken', text: 'Drucken', onclick: () => drucke(false) }),
        el('button', { type: 'button', class: 'knopf', id: 'plan-drucken-alle', text: 'Alle drucken', onclick: () => drucke(true) })),
      el('p', { class: 'hinweis', text: 'Ziehen Sie Stunden auf andere Zeitslots (in der Klasse wird getauscht). Touchscreen: Karte antippen und dann das Ziel antippen – oder Karte kurz gedrückt halten und ziehen. Tastatur: Pfeiltasten, Enter zum Aufnehmen und Ablegen, Esc zum Abbrechen, Entf entfernt Zweitbesetzung oder Aufsicht.' }),
      el('p', { id: 'plan-ansage', class: 'ansage', 'aria-live': 'polite' }),
      el('div', { class: 'plan-layout' },
        el('div', { class: 'plan-raster-rahmen', id: 'plan-raster-rahmen' }),
        el('aside', { class: 'plan-seite', id: 'plan-seite', 'aria-label': 'Konflikte und freie Lehrkräfte' })),
    );
    if (!document.getElementById('druckbereich')) document.body.append(el('div', { id: 'druckbereich' }));
    window.addEventListener('afterprint', () => document.getElementById('druckbereich').replaceChildren());
    richteBeruehrungEin();
    sichtbar = App.beobachteSichtbar(panel, render);
    render();
  }

  function wechsle(art, id) {
    ansicht.art = art;
    ansicht.id = id ?? null;
    aufgenommen = null;
    aktiv = { zeile: 0, spalte: 0 };
    for (const [a] of ARTEN) panel.querySelector('#ansicht-' + a).setAttribute('aria-pressed', String(a === art));
    render();
  }

  const listeFuer = (d, art) => (art === 'klasse' ? d.klassen.map((k) => [k.id, k.name])
    : art === 'lehrkraft' ? d.lehrkraefte.map((l) => [l.id, `${l.kuerzel} – ${l.name}`])
      : art === 'raum' ? d.raeume.map((r) => [r.id, r.name]) : []);

  /* --------------------------- Daten aufbereiten ----------------------- */

  /** Konflikte je Stunde/Aufsicht und Gäste aus Aufteilungen. */
  function analysiere(d) {
    const verstoesse = Kern.Regeln.pruefeHart(d);
    const stundeRegeln = new Map();
    const aufsichtRegeln = new Map();
    const texte = new Map();
    for (const v of verstoesse) {
      for (const i of v.stunden) { if (!stundeRegeln.has(i)) stundeRegeln.set(i, new Set()); stundeRegeln.get(i).add(v.regel); texte.set('s' + i, [...(texte.get('s' + i) || []), `${v.regel}: ${v.text}`]); }
      for (const i of v.aufsichten) { if (!aufsichtRegeln.has(i)) aufsichtRegeln.set(i, new Set()); aufsichtRegeln.get(i).add(v.regel); texte.set('a' + i, [...(texte.get('a' + i) || []), `${v.regel}: ${v.text}`]); }
    }
    const gaeste = new Map(); // Klasse|Tag|Stunde → Anzahl
    for (const s of d.plan.regelplan) {
      if (s.status !== 'aufgeteilt') continue;
      for (const v of s.verteilung || []) { const k = `${v.zielKlasse}|${s.tag}|${s.stunde}`; gaeste.set(k, (gaeste.get(k) || 0) + v.anzahl); }
    }
    return { verstoesse, stundeRegeln, aufsichtRegeln, texte, gaeste };
  }

  /* ------------------------------ Darstellung -------------------------- */

  function render() {
    const t0 = performance.now();
    const d = App.zustand.daten;
    const ix = Kern.Index.erstelle(d);
    const liste = listeFuer(d, ansicht.art);
    if (ansicht.art !== 'aufsicht' && !liste.some(([id]) => id === ansicht.id)) ansicht.id = liste[0]?.[0] ?? null;
    const auswahl = panel.querySelector('#plan-auswahl');
    panel.querySelector('#plan-auswahl-titel').textContent = ARTEN.find(([a]) => a === ansicht.art)[1];
    auswahl.closest('label').hidden = ansicht.art === 'aufsicht';
    auswahl.replaceChildren(...liste.map(([id, text]) => App.el('option', { value: id, text, selected: id === ansicht.id })));
    panel.querySelector('#plan-drucken-alle').textContent = ansicht.art === 'lehrkraft' ? 'Alle Lehrkräfte drucken' : ansicht.art === 'raum' ? 'Alle Räume drucken' : ansicht.art === 'aufsicht' ? 'Aufsichtsplan drucken' : 'Alle Klassen drucken';

    const info = analysiere(d);
    const rahmen = panel.querySelector('#plan-raster-rahmen');
    const imRaster = rahmen.contains(document.activeElement);
    if (!d.plan.regelplan.length && ansicht.art !== 'aufsicht') {
      rahmen.replaceChildren(App.el('p', { class: 'leise', id: 'plan-leer', text: 'Noch kein Regelplan – bitte im Reiter „Planung“ erstellen oder im Reiter „Daten“ importieren.' }));
    } else if (!ix.tage.length) {
      rahmen.replaceChildren();
    } else {
      rahmen.replaceChildren(raster(d, ix, info, ansicht.art, ansicht.id, false));
    }
    renderSeite(d, ix, info);
    setzeAktiv(imRaster);
    letzteDauerMs = performance.now() - t0;
    panel.dataset.renderMs = letzteDauerMs.toFixed(1);
  }

  /** Erzeugt das Wochenraster (Bildschirm oder Druck). */
  function raster(d, ix, info, art, id, fuerDruck) {
    const el = App.el;
    const pausen = new Map(ix.pausen.map((p) => [p.vorStunde, p]));
    const titel = art === 'aufsicht' ? 'Aufsichtsplan' : `Stundenplan ${ARTEN.find(([a]) => a === art)[1]} ${listeFuer(d, art).find(([x]) => x === id)?.[1] || ''}`;
    const tabelle = el('table', { class: 'raster', role: fuerDruck ? null : 'grid', 'aria-label': titel, 'data-art': art });
    tabelle.append(el('thead', {}, el('tr', {}, el('th', { scope: 'col', class: 'raster-ecke', text: art === 'aufsicht' ? 'Pause' : 'Stunde' }), ...ix.tage.map((t) => el('th', { scope: 'col', text: t })))));
    const koerper = el('tbody');
    const eintraege = d.plan.regelplan.map((s, i) => [s, i]).filter(([s]) => art === 'klasse' ? s.klasse === id
      : art === 'lehrkraft' ? s.lehrkraefte.includes(id) : art === 'raum' ? s.raum === id : false);
    const proSlot = new Map();
    for (const [s, i] of eintraege) { const k = s.tag + '|' + s.stunde; if (!proSlot.has(k)) proSlot.set(k, []); proSlot.get(k).push(i); }
    const aufsichtenJe = new Map();
    d.plan.aufsichten.forEach((a, i) => { if (art === 'lehrkraft' && a.lehrkraft !== id) return; const k = a.tag + '|' + a.vorStunde; if (!aufsichtenJe.has(k)) aufsichtenJe.set(k, []); aufsichtenJe.get(k).push(i); });
    const klassenDa = new Set(d.plan.regelplan.filter((s) => s.status !== 'entfaellt').map((s) => s.tag + '|' + s.stunde));

    for (const st of d.zeitraster.stunden) {
      const p = pausen.get(st.nr);
      if (p && (art === 'aufsicht' || art === 'lehrkraft' || art === 'klasse' || art === 'raum')) {
        const tr = el('tr', { class: 'pausenzeile' }, el('th', { scope: 'row', text: `${p.name || 'Pause'}${art === 'aufsicht' ? ` (vor ${st.nr}.) · Bedarf ${p.aufsichten}` : ''}` }));
        for (const tag of ix.tage) {
          const td = el('td', { 'data-tag': tag, 'data-pause': String(st.nr), class: 'zelle pause' });
          if (art === 'aufsicht' || art === 'lehrkraft') {
            for (const i of aufsichtenJe.get(tag + '|' + st.nr) || []) td.append(aufsichtChip(d, info, i, fuerDruck));
            if (art === 'aufsicht') {
              const ist = (aufsichtenJe.get(tag + '|' + st.nr) || []).length;
              const bedarf = klassenDa.has(tag + '|' + st.nr) ? p.aufsichten : 0;
              td.append(el('span', { class: 'bedarf' + (ist < bedarf ? ' fehlt' : ''), title: ist < bedarf ? 'Aufsicht unbesetzt (Ziel 1A)' : null, text: `${ist < bedarf ? '⚠ ' : ''}${ist}/${bedarf}` }));
            }
          }
          if (!fuerDruck) zielZelle(td);
          tr.append(td);
        }
        koerper.append(tr);
      }
      if (art === 'aufsicht') continue;
      const tr = el('tr', {}, el('th', { scope: 'row' }, el('span', { class: 'stunde-nr', text: `${st.nr}.` }), el('span', { class: 'stunde-zeit', text: `${st.von}–${st.bis}` })));
      for (const tag of ix.tage) {
        const td = el('td', { 'data-tag': tag, 'data-stunde': String(st.nr), class: 'zelle' });
        for (const i of proSlot.get(tag + '|' + st.nr) || []) td.append(karte(d, ix, info, art, id, i, fuerDruck));
        if (art === 'klasse') {
          const g = info.gaeste.get(`${id}|${tag}|${st.nr}`);
          if (g) td.append(el('span', { class: 'gaeste', text: `+ ${g} Gäste` }));
        }
        if (!fuerDruck) zielZelle(td);
        tr.append(td);
      }
      koerper.append(tr);
    }
    tabelle.append(koerper);
    return tabelle;
  }

  /** Karte einer Unterrichtsstunde. */
  function karte(d, ix, info, art, id, i, fuerDruck) {
    const el = App.el;
    const s = d.plan.regelplan[i];
    const n = ix.name;
    const regeln = info.stundeRegeln.get(i);
    const k = el('div', {
      class: 'karte' + (regeln ? ' konflikt' : '') + ' status-' + s.status, 'data-index': String(i),
      draggable: fuerDruck ? null : 'true', title: regeln ? info.texte.get('s' + i).join('\n') : null,
      style: kartenStil(d, s),
    });
    const fach = s.fach ? n.fach(s.fach) : '–';
    const statusText = { vertreten: 'vertreten', doppeltBetreut: '⇄', aufgeteilt: 'aufgeteilt', entfaellt: 'entfällt', aufsicht: 'Aufsicht' }[s.status];
    if (art === 'klasse') {
      k.append(el('strong', { text: fach }));
    } else {
      k.append(el('strong', { text: n.klasse(s.klasse) }), document.createTextNode(' ' + fach));
    }
    if (art === 'lehrkraft' && s.lehrkraefte[1] === id) k.append(el('span', { class: 'zweit-hinweis', text: ' (2.)' }));
    if (statusText) k.append(el('span', { class: 'status-marke', text: ' ' + statusText }));
    if (s.status === 'doppeltBetreut' && s.mitKlasse) k.append(el('span', { class: 'status-marke', text: ` mit ${n.klasse(s.mitKlasse)}` }));
    // Lehrkräfte (in der Lehrkraft-Ansicht die jeweils andere)
    const lehrer = el('div', { class: 'karte-lehrer' });
    s.lehrkraefte.forEach((l, rolle) => {
      if (art === 'lehrkraft' && l === id) return;
      const span = el('span', { class: rolle ? 'zweit' : 'haupt', text: (rolle ? '+' : '') + n.lehrkraft(l) });
      lehrer.append(span, document.createTextNode(' '));
      if (rolle && !fuerDruck && art === 'klasse') {
        lehrer.append(el('button', { type: 'button', class: 'mini', tabindex: '-1', 'aria-label': `Zweitbesetzung ${n.lehrkraft(l)} entfernen`, title: 'Zweitbesetzung entfernen', text: '×', onclick: (e) => { e.stopPropagation(); fuehreAus({ art: 'zweitWeg', index: i }); } }));
      }
    });
    if (lehrer.childNodes.length) k.append(lehrer);
    if (art !== 'raum' && s.raum) k.append(el('div', { class: 'karte-raum', text: n.raum(s.raum) }));
    if (regeln) k.append(el('div', { class: 'konflikt-marke', text: '⚠ ' + [...regeln].join(' ') }));
    if (!fuerDruck) {
      k.addEventListener('dragstart', (e) => { if (!nativesZiehen(e)) return; e.dataTransfer.setData(MIME, JSON.stringify({ art: 'stunde', index: i })); e.dataTransfer.effectAllowed = 'move'; });
    }
    return k;
  }

  /**
   * Farben einer Karte: Hintergrund nach Fach, Balken links nach Hauptlehrkraft,
   * schmaler Balken rechts nach Zweitbesetzung. Entfall und Aufteilung bleiben neutral.
   */
  function kartenStil(d, s) {
    const teile = [];
    if (s.fach && s.status !== 'entfaellt' && s.status !== 'aufgeteilt') teile.push(`background-color:${Kern.Farben.fach(d, s.fach)}`);
    if (s.lehrkraefte[0]) teile.push(`border-left:6px solid ${Kern.Farben.lehrkraft(d, s.lehrkraefte[0])}`);
    if (s.lehrkraefte[1]) teile.push(`border-right:4px solid ${Kern.Farben.lehrkraft(d, s.lehrkraefte[1])}`);
    return teile.join(';') || null;
  }

  function aufsichtChip(d, info, i, fuerDruck) {
    const el = App.el;
    const a = d.plan.aufsichten[i];
    const regeln = info.aufsichtRegeln.get(i);
    const chip = el('span', {
      class: 'chip' + (regeln ? ' konflikt' : ''), 'data-aufsicht': String(i), draggable: fuerDruck ? null : 'true',
      title: regeln ? info.texte.get('a' + i).join('\n') : null,
      style: `border-left:5px solid ${Kern.Farben.lehrkraft(d, a.lehrkraft)}`,
    }, ansicht.art === 'lehrkraft' && !fuerDruck ? 'Aufsicht' : (d.lehrkraefte.find((l) => l.id === a.lehrkraft)?.kuerzel || a.lehrkraft));
    if (regeln) chip.append(el('span', { class: 'konflikt-marke', text: ' ⚠ ' + [...regeln].join(' ') }));
    if (!fuerDruck) {
      chip.append(el('button', { type: 'button', class: 'mini', tabindex: '-1', 'aria-label': 'Aufsicht entfernen', title: 'Aufsicht entfernen', text: '×', onclick: (e) => { e.stopPropagation(); fuehreAus({ art: 'aufsichtWeg', index: i }); } }));
      chip.addEventListener('dragstart', (e) => { if (!nativesZiehen(e)) return; e.dataTransfer.setData(MIME, JSON.stringify({ art: 'aufsicht', index: i })); e.dataTransfer.effectAllowed = 'move'; });
    }
    return chip;
  }

  /** Macht eine Zelle zum Ablageziel und zur Tastatur-Zelle. */
  function zielZelle(td) {
    td.setAttribute('role', 'gridcell');
    td.tabIndex = -1;
    td.addEventListener('dragover', (e) => {
      if (!Array.from(e.dataTransfer.types).includes(MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      td.classList.add('ziel');
    });
    td.addEventListener('dragleave', () => td.classList.remove('ziel'));
    td.addEventListener('drop', (e) => {
      const roh = e.dataTransfer.getData(MIME);
      if (!roh) return;
      e.preventDefault();
      td.classList.remove('ziel');
      const nutzlast = JSON.parse(roh);
      const karte = e.target.closest?.('.karte');
      lege(nutzlast, td, karte ? Number(karte.dataset.index) : null);
    });
    td.addEventListener('click', (e) => tippe(td, e));
    td.addEventListener('focus', () => { const r = koordinaten(td); if (r && (r.zeile !== aktiv.zeile || r.spalte !== aktiv.spalte)) { aktiv = r; setzeAktiv(false); } });
    td.addEventListener('keydown', tasten);
  }

  function renderSeite(d, ix, info) {
    const el = App.el;
    const seite = panel.querySelector('#plan-seite');
    const v = info.verstoesse;
    const konflikte = el('section', { class: 'seiten-block', id: 'plan-konflikte' },
      el('h3', { text: v.length ? `⚠ Konflikte (${v.length})` : '✓ Keine Verstöße gegen harte Regeln' }));
    if (v.length) {
      konflikte.append(el('p', { class: 'fehler-text', text: 'Der Regelplan ist ungültig. Klicken Sie auf einen Eintrag, um ihn anzuzeigen.' }),
        el('ul', { class: 'konfliktliste' }, ...v.slice(0, 100).map((x) => el('li', {}, el('button', {
          type: 'button', class: 'link', onclick: () => zeigeVerstoss(x),
        }, el('strong', { text: x.regel }), ' ' + x.text)))));
    }
    const frei = Kern.Bearbeitung.freieKontingente(d);
    const offen = Kern.Bearbeitung.offeneAufsichten(d);
    const kontingente = el('section', { class: 'seiten-block', id: 'plan-frei' },
      el('h3', { text: 'Freie Kontingente (Zweitbesetzung)' }),
      el('p', { class: 'leise', text: 'Auf eine Stunde ziehen oder mit Enter aufnehmen.' }),
      frei.length ? el('div', { class: 'chips' }, ...frei.map((f) => quelle(d, f.lehrkraft, `noch ${f.frei}`, 'zweit'))) : el('p', { class: 'leise', text: 'Keine.' }));
    const aufsicht = el('section', { class: 'seiten-block', id: 'plan-aufsicht-offen' },
      el('h3', { text: 'Aufsichtssoll offen' }),
      offen.length ? el('div', { class: 'chips' }, ...offen.map((f) => quelle(d, f.lehrkraft, `noch ${f.offen}`, 'aufsichtNeu'))) : el('p', { class: 'leise', text: 'Keine.' }));
    const farben = farblegende(d, ix);
    const legende = el('section', { class: 'seiten-block' }, el('h3', { text: 'Zeichen' }),
      el('ul', { class: 'legende' }, ...[['⚠ H1', 'Verstoß gegen harte Regel (Nummer)'], ['+KÜR', 'Zweitbesetzung'], ['(2.)', 'Lehrkraft ist hier Zweitbesetzung'], ['⇄', 'Doppelbetreuung'], ['aufgeteilt / + n Gäste', 'Aufteilung einer Klasse']]
        .map(([z, t]) => el('li', {}, el('strong', { text: z }), ' – ' + t))));
    const teile = [konflikte];
    if (ansicht.art !== 'aufsicht') teile.push(kontingente);
    if (ansicht.art === 'aufsicht' || ansicht.art === 'lehrkraft') teile.push(aufsicht);
    if (farben) teile.push(farben);
    teile.push(legende);
    seite.replaceChildren(...teile);
  }

  /** Farblegende der aktuellen Ansicht: Fächer (Kartenfarbe) und Lehrkräfte (Balken). */
  function farblegende(d, ix) {
    const el = App.el;
    const sichtbar = d.plan.regelplan.filter((s) => (ansicht.art === 'klasse' ? s.klasse === ansicht.id
      : ansicht.art === 'lehrkraft' ? s.lehrkraefte.includes(ansicht.id) : ansicht.art === 'raum' ? s.raum === ansicht.id : false));
    const faecher = [...new Set(sichtbar.map((s) => s.fach).filter(Boolean))].sort((a, b) => ix.name.fach(a).localeCompare(ix.name.fach(b)));
    const lehrer = [...new Set(ansicht.art === 'aufsicht' ? d.plan.aufsichten.map((a) => a.lehrkraft) : sichtbar.flatMap((s) => s.lehrkraefte))]
      .sort((a, b) => ix.name.lehrkraft(a).localeCompare(ix.name.lehrkraft(b)));
    if (!faecher.length && !lehrer.length) return null;
    return el('section', { class: 'seiten-block', id: 'plan-farben' }, el('h3', { text: 'Farben' }),
      faecher.length ? el('p', { class: 'leise', text: 'Kartenfarbe = Fach' }) : null,
      faecher.length ? el('div', { class: 'chips' }, ...faecher.map((f) => el('span', { class: 'farbmuster', 'data-fach': f, style: `background-color:${Kern.Farben.fach(d, f)}`, text: ix.name.fach(f), title: ix.faecher.get(f)?.name }))) : null,
      lehrer.length ? el('p', { class: 'leise', text: 'Balken links = Lehrkraft (rechts: Zweitbesetzung)' }) : null,
      lehrer.length ? el('div', { class: 'chips' }, ...lehrer.map((l) => el('span', { class: 'farbmuster', 'data-lehrkraft': l, style: `border-left:6px solid ${Kern.Farben.lehrkraft(d, l)}`, text: ix.name.lehrkraft(l), title: ix.lehrkraefte.get(l)?.name }))) : null,
      el('p', { class: 'leise', text: 'Farben lassen sich im Reiter „Stammdaten“ ändern.' }));
  }

  function quelle(d, lehrkraft, zusatz, art) {
    const l = d.lehrkraefte.find((x) => x.id === lehrkraft);
    const chip = App.el('button', {
      type: 'button', class: 'chip quelle', draggable: 'true', 'data-quelle': art, 'data-lehrkraft': lehrkraft,
      'aria-label': `${l.kuerzel} (${l.name}) ${zusatz} – aufnehmen`, text: `${l.kuerzel} · ${zusatz}`,
      onclick: () => {
        if (Date.now() < klickSperreBis) return;
        aufgenommen = { art, lehrkraft };
        ansage(`${l.kuerzel} aufgenommen – Zielzelle antippen bzw. anklicken oder mit den Pfeiltasten wählen und Enter drücken (Esc bricht ab).`);
        setzeAktiv(zeigerArt === 'mouse');
      },
    });
    chip.addEventListener('dragstart', (e) => { if (!nativesZiehen(e)) return; e.dataTransfer.setData(MIME, JSON.stringify({ art, lehrkraft })); e.dataTransfer.effectAllowed = 'copy'; });
    return chip;
  }

  function zeigeVerstoss(v) {
    const d = App.zustand.daten;
    if (v.stunden.length) {
      const s = d.plan.regelplan[v.stunden[0]];
      const art = v.regel === 'H3' || v.regel === 'H5' || v.regel === 'H6' ? 'raum' : v.regel === 'H1' || v.regel === 'H4' || v.regel === 'H7' || v.regel === 'H11' ? 'lehrkraft' : 'klasse';
      const id = art === 'raum' && s.raum ? s.raum : art === 'lehrkraft' ? s.lehrkraefte[0] : s.klasse;
      wechsle(id ? art : 'klasse', id || s.klasse);
      fokussiereSlot(s.tag, s.stunde);
    } else if (v.aufsichten.length) {
      const a = d.plan.aufsichten[v.aufsichten[0]];
      wechsle('aufsicht');
      fokussiereSlot(a.tag, null, a.vorStunde);
    }
    ansage(`${v.regel}: ${v.text}`);
  }

  /* ------------------------------ Aktionen ----------------------------- */

  /** Legt eine Nutzlast auf einer Zelle ab. */
  function lege(nutzlast, td, kartenIndex) {
    const tag = td.dataset.tag;
    const stunde = td.dataset.stunde ? Number(td.dataset.stunde) : null;
    const pause = td.dataset.pause ? Number(td.dataset.pause) : null;
    if (nutzlast.art === 'stunde') {
      if (stunde === null) return ansage('Stunden können nur auf Stunden-Zellen abgelegt werden.');
      return fuehreAus({ art: 'stunde', index: nutzlast.index, tag, stunde });
    }
    if (nutzlast.art === 'zweit') {
      const index = kartenIndex ?? (td.querySelector('.karte') ? Number(td.querySelector('.karte').dataset.index) : null);
      if (index === null) return ansage('Bitte auf eine Unterrichtsstunde ablegen.');
      return fuehreAus({ art: 'zweit', index, lehrkraft: nutzlast.lehrkraft });
    }
    if (pause === null) return ansage('Aufsichten können nur auf Pausen-Zellen abgelegt werden.');
    if (nutzlast.art === 'aufsicht') return fuehreAus({ art: 'aufsicht', index: nutzlast.index, tag, vorStunde: pause });
    if (nutzlast.art === 'aufsichtNeu') return fuehreAus({ art: 'aufsichtNeu', lehrkraft: nutzlast.lehrkraft, tag, vorStunde: pause });
    return undefined;
  }

  /** Führt eine Bearbeitung über App.aendere aus (rückgängig machbar). */
  function fuehreAus(aktion) {
    const B = Kern.Bearbeitung;
    let r = null;
    const ergebnis = App.aendere(() => r.text, (d) => {
      r = aktion.art === 'stunde' ? B.verschiebeStunde(d, aktion.index, aktion.tag, aktion.stunde)
        : aktion.art === 'zweit' ? B.setzeZweit(d, aktion.index, aktion.lehrkraft)
          : aktion.art === 'zweitWeg' ? B.setzeZweit(d, aktion.index, null)
            : aktion.art === 'aufsicht' ? B.verschiebeAufsicht(d, aktion.index, aktion.tag, aktion.vorStunde)
              : aktion.art === 'aufsichtNeu' ? B.neueAufsicht(d, aktion.tag, aktion.vorStunde, aktion.lehrkraft)
                : B.entferneAufsicht(d, aktion.index);
      if (r.fehler) return false;
    });
    aufgenommen = null;
    if (r?.fehler) { ansage('⚠ ' + r.fehler); return false; }
    if (!ergebnis.ok) { ansage('⚠ Änderung nicht möglich: ' + (ergebnis.fehler[0]?.meldung || '')); return false; }
    const v = Kern.Regeln.pruefeHart(App.zustand.daten).length;
    const satz = r.text.endsWith('.') ? r.text : r.text + '.';
    ansage(`${satz}${v ? ` Der Plan hat jetzt ${v === 1 ? 'einen Verstoß' : v + ' Verstöße'} gegen harte Regeln.` : ''}`);
    return true;
  }

  function ansage(text) {
    panel.querySelector('#plan-ansage').textContent = text;
  }

  /* ------------------------------ Tastatur ----------------------------- */

  function zellen() {
    const tabelle = panel.querySelector('.raster');
    return tabelle ? [...tabelle.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')]) : [];
  }
  function koordinaten(td) {
    const z = zellen();
    for (let r = 0; r < z.length; r++) { const c = z[r].indexOf(td); if (c >= 0) return { zeile: r, spalte: c }; }
    return null;
  }
  function setzeAktiv(fokus) {
    const z = zellen();
    if (!z.length) return;
    aktiv.zeile = Math.max(0, Math.min(aktiv.zeile, z.length - 1));
    aktiv.spalte = Math.max(0, Math.min(aktiv.spalte, z[aktiv.zeile].length - 1));
    z.flat().forEach((td) => { td.tabIndex = -1; td.classList.remove('aufgenommen-ziel'); });
    const td = z[aktiv.zeile][aktiv.spalte];
    td.tabIndex = 0;
    if (aufgenommen) td.classList.add('aufgenommen-ziel');
    panel.querySelectorAll('.aufgenommen').forEach((x) => x.classList.remove('aufgenommen'));
    if (aufgenommen?.art === 'stunde') panel.querySelector(`.karte[data-index="${aufgenommen.index}"]`)?.classList.add('aufgenommen');
    if (aufgenommen?.art === 'aufsicht') panel.querySelector(`.chip[data-aufsicht="${aufgenommen.index}"]`)?.classList.add('aufgenommen');
    if (fokus) td.focus();
  }
  function fokussiereSlot(tag, stunde, pause) {
    const sel = stunde !== null && stunde !== undefined ? `td[data-tag="${tag}"][data-stunde="${stunde}"]` : `td[data-tag="${tag}"][data-pause="${pause}"]`;
    const td = panel.querySelector('.raster ' + sel);
    const k = td && koordinaten(td);
    if (k) { aktiv = k; setzeAktiv(true); }
  }

  function tasten(e) {
    const z = zellen();
    const schritte = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (schritte[e.key]) {
      e.preventDefault();
      aktiv.zeile = Math.max(0, Math.min(z.length - 1, aktiv.zeile + schritte[e.key][0]));
      aktiv.spalte = Math.max(0, Math.min(z[aktiv.zeile].length - 1, aktiv.spalte + schritte[e.key][1]));
      setzeAktiv(true);
      return;
    }
    const td = z[aktiv.zeile]?.[aktiv.spalte];
    if (!td) return;
    if (e.key === 'Escape') {
      if (aufgenommen) { aufgenommen = null; ansage('Abgebrochen.'); setzeAktiv(true); }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (aufgenommen) {
        const merke = { ...aktiv };
        lege(aufgenommen, td, null);
        aufgenommen = null;
        aktiv = merke;
        setzeAktiv(true);
        return;
      }
      const k = td.querySelector('.karte');
      const c = td.querySelector('.chip[data-aufsicht]');
      if (k) { aufgenommen = { art: 'stunde', index: Number(k.dataset.index) }; ansage(`Stunde aufgenommen (${k.textContent.trim()}) – Ziel wählen und Enter drücken, Esc bricht ab.`); } else if (c) { aufgenommen = { art: 'aufsicht', index: Number(c.dataset.aufsicht) }; ansage('Aufsicht aufgenommen – Ziel-Pause wählen und Enter drücken, Esc bricht ab.'); } else ansage('Hier ist nichts zum Aufnehmen.');
      setzeAktiv(true);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const c = td.querySelector('.chip[data-aufsicht]');
      const k = [...td.querySelectorAll('.karte')].find((x) => App.zustand.daten.plan.regelplan[Number(x.dataset.index)]?.lehrkraefte.length > 1);
      const merke = { ...aktiv };
      if (ansicht.art === 'klasse' && k) fuehreAus({ art: 'zweitWeg', index: Number(k.dataset.index) });
      else if (c) fuehreAus({ art: 'aufsichtWeg', index: Number(c.dataset.aufsicht) });
      else ansage('Hier gibt es keine Zweitbesetzung oder Aufsicht zum Entfernen.');
      aktiv = merke;
      setzeAktiv(true);
    }
  }

  /* ----------------------------- Touchscreen ---------------------------- */
  // HTML-Drag-and-drop funktioniert auf Touchscreens (insbesondere Safari unter
  // iOS/iPadOS) nicht zuverlässig. Daher zwei eigene Wege:
  //   1. Antippen und Ziel antippen (wie Aufnehmen/Ablegen per Tastatur)
  //   2. Gedrückt halten (≈ 350 ms) und ziehen; kurzes Wischen scrollt weiter
  const HALTEN_MS = 350;
  const TOLERANZ_PX = 10;
  let zeigerArt = 'mouse';
  let beruehrung = null; // { nutzlast, quelle, x, y, timer, aktiv, geist, ziel }
  let klickSperreBis = 0;

  /** Was eine Karte bzw. ein Chip transportiert. */
  function nutzlastVon(element) {
    const k = element?.closest?.('.raster .karte[data-index]');
    if (k) return { art: 'stunde', index: Number(k.dataset.index) };
    const c = element?.closest?.('.raster .chip[data-aufsicht]');
    if (c) return { art: 'aufsicht', index: Number(c.dataset.aufsicht) };
    const q = element?.closest?.('.chip.quelle');
    if (q) return { art: q.dataset.quelle, lehrkraft: q.dataset.lehrkraft };
    return null;
  }

  /** Natives Ziehen nur mit Maus; bei Berührung übernimmt die eigene Steuerung. */
  function nativesZiehen(e) {
    if (zeigerArt !== 'mouse' || beruehrung) { e.preventDefault(); return false; }
    return true;
  }

  function richteBeruehrungEin() {
    panel.addEventListener('pointerdown', (e) => { zeigerArt = e.pointerType || 'mouse'; }, true);
    panel.addEventListener('touchstart', (e) => { zeigerArt = 'touch'; beruehrungStart(e); }, { passive: true });
    // Kein Kontextmenü/Lupe beim langen Drücken auf Karten
    panel.addEventListener('contextmenu', (e) => { if (zeigerArt !== 'mouse' && nutzlastVon(e.target)) e.preventDefault(); });
  }

  /** Tippen oder Klicken auf eine Zelle: ablegen, aufnehmen oder Zelle wählen. */
  function tippe(td, e) {
    if (Date.now() < klickSperreBis || e.target.closest('button')) return;
    const r = koordinaten(td);
    if (r) aktiv = r;
    if (aufgenommen) {
      const eigene = nutzlastVon(e.target);
      if (eigene && eigene.art === aufgenommen.art && eigene.index === aufgenommen.index && eigene.index !== undefined) {
        aufgenommen = null;
        ansage('Abgebrochen.');
      } else {
        const karte = e.target.closest('.karte');
        const nutzlast = aufgenommen;
        aufgenommen = null;
        lege(nutzlast, td, karte ? Number(karte.dataset.index) : null);
      }
      setzeAktiv(zeigerArt === 'mouse');
      return;
    }
    if (zeigerArt !== 'mouse') {
      const n = nutzlastVon(e.target);
      if (n) {
        aufgenommen = n;
        ansage(`${n.art === 'stunde' ? 'Stunde' : 'Aufsicht'} aufgenommen – jetzt das Ziel antippen (nochmals antippen bricht ab).`);
        setzeAktiv(false);
        return;
      }
    }
    setzeAktiv(true);
  }

  function beruehrungStart(e) {
    abbrechenBeruehrung();
    if (e.touches.length !== 1 || e.target.closest('button.mini')) return;
    const quelleElement = e.target.closest('.karte, .chip');
    const nutzlast = nutzlastVon(e.target);
    if (!quelleElement || !nutzlast) return;
    const t = e.touches[0];
    beruehrung = { nutzlast, quelle: quelleElement, x: t.clientX, y: t.clientY, aktiv: false, ziel: null, geist: null };
    beruehrung.timer = setTimeout(starteZiehen, HALTEN_MS);
    document.addEventListener('touchmove', beruehrungBewegung, { passive: false });
    document.addEventListener('touchend', beruehrungEnde, { passive: false });
    document.addEventListener('touchcancel', abbrechenBeruehrung);
  }

  function starteZiehen() {
    if (!beruehrung) return;
    beruehrung.aktiv = true;
    const geist = beruehrung.quelle.cloneNode(true);
    const rechteck = beruehrung.quelle.getBoundingClientRect();
    geist.classList.add('geist');
    geist.removeAttribute('id');
    geist.style.width = rechteck.width + 'px';
    geist.style.left = beruehrung.x + 'px';
    geist.style.top = beruehrung.y + 'px';
    document.body.append(geist);
    beruehrung.geist = geist;
    beruehrung.quelle.classList.add('aufgenommen');
    navigator.vibrate?.(15);
    ansage('Zum Ziel ziehen und loslassen.');
  }

  function beruehrungBewegung(e) {
    if (!beruehrung) return;
    const t = e.touches[0];
    if (!beruehrung.aktiv) {
      // vor Ablauf der Haltezeit bewegt: der Finger scrollt – kein Ziehen
      if (Math.hypot(t.clientX - beruehrung.x, t.clientY - beruehrung.y) > TOLERANZ_PX) abbrechenBeruehrung();
      return;
    }
    e.preventDefault(); // nicht scrollen, solange gezogen wird
    beruehrung.geist.style.left = t.clientX + 'px';
    beruehrung.geist.style.top = t.clientY + 'px';
    const td = document.elementFromPoint(t.clientX, t.clientY)?.closest('.raster td[data-tag]');
    if (td !== beruehrung.ziel) {
      beruehrung.ziel?.classList.remove('ziel');
      td?.classList.add('ziel');
      beruehrung.ziel = td || null;
    }
    beruehrung.punkt = { x: t.clientX, y: t.clientY };
  }

  function beruehrungEnde(e) {
    if (!beruehrung) return;
    if (!beruehrung.aktiv) { abbrechenBeruehrung(); return; } // kurzer Tipp → Klick-Behandlung
    e.preventDefault();
    const { nutzlast, ziel, punkt } = beruehrung;
    const karte = punkt ? document.elementFromPoint(punkt.x, punkt.y)?.closest('.karte') : null;
    abbrechenBeruehrung();
    klickSperreBis = Date.now() + 500; // nachfolgenden Klick ignorieren
    if (ziel) lege(nutzlast, ziel, karte && ziel.contains(karte) ? Number(karte.dataset.index) : null);
    else ansage('Nicht abgelegt – bitte über einer Zelle loslassen.');
  }

  function abbrechenBeruehrung() {
    if (!beruehrung) return;
    clearTimeout(beruehrung.timer);
    beruehrung.geist?.remove();
    beruehrung.ziel?.classList.remove('ziel');
    beruehrung.quelle?.classList.remove('aufgenommen');
    beruehrung = null;
    document.removeEventListener('touchmove', beruehrungBewegung);
    document.removeEventListener('touchend', beruehrungEnde);
    document.removeEventListener('touchcancel', abbrechenBeruehrung);
  }

  /* ------------------------------- Druck ------------------------------- */

  /** Füllt den Druckbereich (eine oder alle Entitäten der Ansicht). */
  function druckvorbereitung(alle) {
    const d = App.zustand.daten;
    const ix = Kern.Index.erstelle(d);
    const info = analysiere(d);
    const el = App.el;
    const art = ansicht.art;
    const ids = art === 'aufsicht' ? [null] : alle ? listeFuer(d, art).map(([id]) => id) : [ansicht.id];
    const bereich = document.getElementById('druckbereich');
    bereich.replaceChildren(...ids.map((id) => {
      const t = raster(d, ix, info, art, id, true);
      return el('section', { class: 'druckseite' },
        el('h2', { text: `${t.getAttribute('aria-label')}` }),
        el('p', { class: 'leise', text: `${d.schule?.name || ''} ${d.schule?.schuljahr || ''}`.trim() }),
        t);
    }));
    return ids.length;
  }

  function drucke(alle) {
    druckvorbereitung(alle);
    window.print();
  }

  return { sichtbar: () => sichtbar(), baue, wechsle, druckvorbereitung, fuehreAus, dauer: () => letzteDauerMs };
})();
