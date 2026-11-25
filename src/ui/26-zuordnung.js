/* ==========================================================================
 * Modul ZuordnungReiter (Oberfläche, Reiter „Zuordnung“)
 * Matrix Klasse × Fach (§7): Wochenstunden der Stundentafel, Haupt- und
 * Zweitlehrkraft (Kürzel), Doppelstunde gewünscht. Daneben Soll-/Ist-Stunden
 * je Lehrkraft mit Warnung bei Überschreitung.
 * Tastatur: Enter/↓/↑ wechseln in dieselbe Spalte der nächsten/vorigen Klasse.
 * ========================================================================== */
const ZuordnungReiter = (() => {
  'use strict';
  let panel = null;
  let sichtbar = () => {};
  let fokusNach = null;

  function baue(ziel) {
    panel = ziel;
    const el = App.el;
    panel.append(
      el('p', { class: 'hinweis', text: 'Je Zelle: Wochenstunden (Std), Hauptlehrkraft (H) und Zweitlehrkraft (Z) als Kürzel, D = Doppelstunde gewünscht. Leere Stunden entfernen das Fach aus der Stundentafel.' }),
      el('datalist', { id: 'liste-lehrkraefte' }),
      el('div', { class: 'meldungen', id: 'zuordnung-meldung', 'aria-live': 'polite' }),
      el('div', { class: 'tabellen-rahmen' }, el('table', { class: 'tabelle matrix', id: 'zuordnung-matrix' })),
      el('h3', { text: 'Soll- und Ist-Stunden laut Zuordnung' }),
      el('div', { class: 'tabellen-rahmen' }, el('table', { class: 'tabelle', id: 'zuordnung-soll-ist' })),
    );
    sichtbar = App.beobachteSichtbar(panel, render);
    render();
  }

  const kuerzel = (d, id) => d.lehrkraefte.find((l) => l.id === id)?.kuerzel || '';

  function render() {
    const d = App.zustand.daten;
    const el = App.el;
    const aktiv = document.activeElement;
    if (!fokusNach && aktiv && panel.contains(aktiv) && aktiv.dataset.zeile) fokusNach = { zeile: aktiv.dataset.zeile, spalte: aktiv.dataset.spalte };
    panel.querySelector('#liste-lehrkraefte').replaceChildren(...d.lehrkraefte.map((l) => el('option', { value: l.kuerzel, label: l.name })));
    const ix = Kern.Index.erstelle(d);
    const matrix = panel.querySelector('#zuordnung-matrix');
    const kopf = el('tr', {}, el('th', { scope: 'col', text: 'Klasse' }), ...d.faecher.map((f) => el('th', { scope: 'col', text: f.kuerzel, title: f.name })), el('th', { scope: 'col', class: 'zahl', text: 'Summe' }));
    const zeilen = d.klassen.map((k) => {
      const tafel = new Map(k.stundentafel.map((e) => [e.fach, e]));
      return el('tr', {}, el('th', { scope: 'row', text: k.name }),
        ...d.faecher.map((f) => zelle(d, ix, k, f, tafel.get(f.id))),
        el('td', { class: 'zahl', text: String(k.stundentafel.reduce((s, e) => s + e.stunden, 0)) }));
    });
    matrix.replaceChildren(el('caption', { text: 'Stundentafel und Lehrkräfte je Klasse und Fach' }), el('thead', {}, kopf),
      el('tbody', {}, ...(zeilen.length ? zeilen : [el('tr', {}, el('td', { colspan: String(d.faecher.length + 2), class: 'leise', text: 'Noch keine Klassen – bitte im Reiter „Stammdaten“ anlegen.' }))])));
    renderSollIst(d, ix);
    if (fokusNach) {
      const z = panel.querySelector(`[data-zeile="${CSS.escape(fokusNach.zeile)}"][data-spalte="${CSS.escape(fokusNach.spalte)}"]`);
      fokusNach = null;
      if (z) { z.focus(); z.select?.(); }
    }
  }

  function zelle(d, ix, k, f, eintrag) {
    const el = App.el;
    const zu = ix.zuordnungVon(k.id, f.id);
    const wo = `${f.kuerzel} ${k.name}`;
    const feld = (art, wert, beschr, extra = {}) => el('input', {
      type: 'text', class: 'eingabe-' + art, value: wert, 'data-zeile': k.id, 'data-spalte': f.id + '|' + art,
      'aria-label': `${beschr} ${wo}`, spellcheck: 'false', autocomplete: 'off', ...extra,
      onchange: (e) => uebernehme(k.id, f.id, art, e.target.value, e.target),
      onkeydown: (e) => tasten(e, k.id, f.id, art),
    });
    const td = el('td', { class: 'matrix-zelle' + (eintrag ? '' : ' leer') },
      el('label', {}, el('span', { text: 'Std' }), feld('std', eintrag ? String(eintrag.stunden) : '', 'Wochenstunden', { inputmode: 'numeric' })),
      el('label', {}, el('span', { text: 'H' }), feld('haupt', kuerzel(d, zu.haupt), 'Hauptlehrkraft', { list: 'liste-lehrkraefte' })),
      el('label', {}, el('span', { text: 'Z' }), feld('zweit', kuerzel(d, zu.zweit[0]), 'Zweitlehrkraft', { list: 'liste-lehrkraefte' })),
      el('label', { class: 'matrix-doppel' }, el('input', {
        type: 'checkbox', checked: !!eintrag?.doppelt, disabled: !eintrag, 'aria-label': `Doppelstunde gewünscht ${wo}`,
        'data-zeile': k.id, 'data-spalte': f.id + '|doppelt', onchange: (e) => uebernehme(k.id, f.id, 'doppelt', e.target.checked, e.target),
      }), el('span', { text: 'D' })));
    if (zu.haupt && eintrag && !ix.istQualifiziert(zu.haupt, f.id, k.stufe)) {
      td.classList.add('warnung');
      td.append(el('span', { class: 'marke', title: `${kuerzel(d, zu.haupt)} ist für ${f.kuerzel} in Stufe ${k.stufe} nicht qualifiziert (H8) – der Planer weist die Stunden neu zu`, text: '⚠ H8' }));
    }
    return td;
  }

  function tasten(e, klasse, fach, art) {
    const d = App.zustand.daten;
    const i = d.klassen.findIndex((k) => k.id === klasse);
    const r = e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (e.key === 'Escape') { e.preventDefault(); render(); return; }
    if (!r) return;
    e.preventDefault();
    const ziel = d.klassen[i + r];
    const naechstes = ziel ? { zeile: ziel.id, spalte: fach + '|' + art } : null;
    const vorher = e.target.defaultValue;
    if (e.target.value !== vorher) {
      if (!uebernehme(klasse, fach, art, e.target.value, e.target, naechstes)) return;
    } else if (naechstes) {
      panel.querySelector(`[data-zeile="${CSS.escape(naechstes.zeile)}"][data-spalte="${CSS.escape(naechstes.spalte)}"]`)?.focus();
    }
  }

  /** Übernimmt eine Zelleneingabe; liefert true bei Erfolg. */
  function uebernehme(klasseId, fachId, art, roh, eingabe, danach) {
    let lokal = null;
    const d0 = App.zustand.daten;
    const wo = `${d0.faecher.find((f) => f.id === fachId)?.kuerzel} ${d0.klassen.find((k) => k.id === klasseId)?.name}`;
    const titel = { std: 'Wochenstunden', haupt: 'Hauptlehrkraft', zweit: 'Zweitlehrkraft', doppelt: 'Doppelstunde' }[art];
    const r = App.aendere(`Zuordnung ${wo}: ${titel} geändert`, (d) => {
      const k = d.klassen.find((x) => x.id === klasseId);
      const eintrag = k.stundentafel.find((e) => e.fach === fachId);
      if (art === 'std') {
        const t = String(roh).trim();
        if (t === '' || t === '0') {
          k.stundentafel = k.stundentafel.filter((e) => e.fach !== fachId);
          d.zuordnungen = d.zuordnungen.filter((z) => !(z.klasse === klasseId && z.fach === fachId));
          return;
        }
        const n = Number(t);
        if (!Number.isInteger(n) || n < 1 || n > 20) { lokal = 'Bitte eine ganze Zahl von 0 bis 20 eingeben.'; return false; }
        if (eintrag) eintrag.stunden = n;
        else {
          k.stundentafel.push({ fach: fachId, stunden: n, doppelt: false });
          const reihenfolge = d.faecher.map((f) => f.id);
          k.stundentafel.sort((a, b) => reihenfolge.indexOf(a.fach) - reihenfolge.indexOf(b.fach));
        }
        return;
      }
      if (!eintrag) { lokal = 'Bitte zuerst Wochenstunden eintragen.'; return false; }
      if (art === 'doppelt') { eintrag.doppelt = !!roh; return; }
      const t = String(roh).trim();
      let lehrkraft = null;
      if (t) {
        lehrkraft = d.lehrkraefte.find((l) => l.kuerzel.toLowerCase() === t.toLowerCase());
        if (!lehrkraft) { lokal = `Kürzel „${t}“ gibt es nicht.`; return false; }
      }
      // bisherige Einträge dieser Rolle entfernen, ebenso dieselbe Lehrkraft in der anderen Rolle
      d.zuordnungen = d.zuordnungen.filter((z) => !(z.klasse === klasseId && z.fach === fachId && (z.rolle === art || (lehrkraft && z.lehrkraft === lehrkraft.id))));
      if (lehrkraft) d.zuordnungen.push({ klasse: klasseId, fach: fachId, lehrkraft: lehrkraft.id, rolle: art });
    });
    const meldung = panel.querySelector('#zuordnung-meldung');
    if (lokal || !r.ok) {
      eingabe.setAttribute('aria-invalid', 'true');
      if (eingabe.type === 'checkbox') eingabe.checked = !eingabe.checked;
      meldung.replaceChildren(App.el('div', { class: 'meldung meldung-fehler', role: 'alert' },
        App.el('p', { class: 'meldung-titel', text: `⚠ ${titel} für ${wo} nicht übernommen` }),
        App.el('ul', { class: 'pfadliste' }, ...(lokal ? [{ meldung: lokal }] : r.fehler.slice(0, 8)).map((f) => App.el('li', {}, f.pfad ? App.el('code', { text: f.pfad }) : null, f.pfad ? ': ' : '', f.meldung)))));
      return false;
    }
    meldung.replaceChildren();
    if (danach) fokusNach = danach;
    render();
    return true;
  }

  function renderSollIst(d, ix) {
    const el = App.el;
    const haupt = new Map();
    const zweit = new Map();
    for (const z of d.zuordnungen) {
      const h = ix.tafel.get(z.klasse)?.get(z.fach)?.stunden || 0;
      const ziel = z.rolle === 'haupt' ? haupt : zweit;
      ziel.set(z.lehrkraft, (ziel.get(z.lehrkraft) || 0) + h);
    }
    const tabelle = panel.querySelector('#zuordnung-soll-ist');
    tabelle.replaceChildren(
      el('caption', { text: 'Stunden laut Festzuordnung (der Planer verteilt Stunden ohne Zuordnung und vergibt weitere Zweitbesetzungen)' }),
      el('thead', {}, el('tr', {}, ...['Kürzel', 'Name', 'Soll', 'Reserve', 'Max', 'Haupt', 'Zweit', 'Gesamt', 'Hinweis'].map((t, i) => el('th', { scope: 'col', class: i >= 2 && i <= 7 ? 'zahl' : null, text: t })))),
      el('tbody', {}, ...d.lehrkraefte.map((l) => {
        const h = haupt.get(l.id) || 0;
        const z = zweit.get(l.id) || 0;
        const g = h + z;
        const reserve = ix.reserve(l);
        let hinweis = '';
        let art = '';
        if (g > l.maxStunden) { hinweis = `⚠ ${g - l.maxStunden} über der Höchstgrenze (H7)`; art = 'fehler-text'; } else if (z > 0 && g > l.sollStunden - reserve) { hinweis = '⚠ Zweitbesetzung greift die Vertretungsreserve an (H11)'; art = 'fehler-text'; } else if (g > l.sollStunden - reserve) { hinweis = 'Reserve wird für Hauptunterricht genutzt'; art = 'warnung-text'; } else if (g < l.minStunden) { hinweis = `unter Mindeststunden (${l.minStunden})`; art = 'leise'; }
        return el('tr', { 'data-lehrkraft': l.id }, el('th', { scope: 'row', text: l.kuerzel }), el('td', { text: l.name }),
          ...[l.sollStunden, reserve, l.maxStunden, h, z, g].map((x) => el('td', { class: 'zahl', text: String(x) })),
          el('td', { class: art, text: hinweis }));
      })));
  }

  return { sichtbar: () => sichtbar(), baue };
})();
