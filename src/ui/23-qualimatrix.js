/* ==========================================================================
 * Modul QualiMatrix (Oberfläche, Stammdaten → „Qualifikationen“)
 * Matrix Lehrkräfte × Fächer. Jede Zelle hat je Stufengruppe einen Schalter
 * (P = Primarstufe 1–4, SI = Sekundarstufe I 5–10, SII = Sekundarstufe II 11–13).
 * Schnellaktionen je Zeile („alle Fächer“) und je Spalte („alle Lehrkräfte“).
 * Bereiche, die eine Gruppe nur teilweise abdecken, erscheinen als „teilweise“;
 * ein Klick setzt die ganze Gruppe. Fehlt einer Hauptlehrkraft aus der
 * Zuordnung die Qualifikation, ist die Zelle mit „⚠ H8“ markiert.
 * Werte werden an Ort und Stelle aktualisiert, damit der Fokus erhalten bleibt.
 * ========================================================================== */
const QualiMatrix = (() => {
  'use strict';
  const Q = () => Kern.Qualifikation;
  let wurzel = null;
  let gewaehlt = null; // null = Gruppen der vorhandenen Klassen
  let signatur = '';
  const schalter = new Map(); // `${lk}\u0001${fach}\u0001${gruppe}` → button
  const zeilenKnoepfe = new Map(); // `${lk}\u0001${gruppe}`
  const spaltenKnoepfe = new Map(); // `${fach}\u0001${gruppe}`
  const zellen = new Map(); // `${lk}\u0001${fach}` → td
  const S = '\u0001';

  const gruppen = (d) => {
    const ids = gewaehlt || Q().genutzteGruppen(d);
    return Q().GRUPPEN.filter((g) => ids.includes(g.id));
  };

  function baue() {
    const el = App.el;
    wurzel = el('div', {},
      el('fieldset', { class: 'tage', id: 'quali-gruppen' }, el('legend', { text: 'Angezeigte Stufengruppen' }),
        ...Q().GRUPPEN.map((g) => el('label', { class: 'feld-haken' },
          el('input', { type: 'checkbox', 'data-gruppe': g.id, onchange: () => waehleGruppen() }),
          el('span', { text: `${g.kurz} – ${g.name} (${g.von}–${g.bis})` })))),
      el('p', { class: 'hinweis', text: 'Je Lehrkraft und Fach die Stufengruppen anklicken, in denen sie unterrichten darf. „alle“ in der Kopfzeile setzt eine Gruppe für alle Lehrkräfte eines Fachs, „alle“ in der Zeile für alle Fächer einer Lehrkraft (erneuter Klick entfernt sie). Gestrichelt = nur teilweise (z. B. Stufen 3–4 aus einem Import); ein Klick setzt die ganze Gruppe. ⚠ H8: Hauptlehrkraft laut Zuordnung ohne passende Qualifikation.' }),
      el('div', { class: 'tabellen-rahmen' }, el('table', { class: 'matrix quali-matrix', id: 'quali-matrix' })));
    return wurzel;
  }

  function waehleGruppen() {
    const ids = [...wurzel.querySelectorAll('#quali-gruppen input')].filter((i) => i.checked).map((i) => i.dataset.gruppe);
    gewaehlt = ids;
    render();
  }

  /** Neuaufbau bei geänderten Lehrkräften, Fächern oder Gruppen, sonst nur Werte. */
  function render() {
    if (!wurzel) return;
    const d = App.zustand.daten;
    const gr = gruppen(d);
    for (const i of wurzel.querySelectorAll('#quali-gruppen input')) i.checked = gr.some((g) => g.id === i.dataset.gruppe);
    const neu = JSON.stringify([d.lehrkraefte.map((l) => [l.id, l.kuerzel, l.name]), d.faecher.map((f) => [f.id, f.kuerzel, f.name]), gr.map((g) => g.id)]);
    if (neu !== signatur) { signatur = neu; aufbau(d, gr); }
    fuelle(d, gr);
  }

  function aufbau(d, gr) {
    const el = App.el;
    schalter.clear(); zeilenKnoepfe.clear(); spaltenKnoepfe.clear(); zellen.clear();
    const tabelle = wurzel.querySelector('#quali-matrix');
    if (!d.lehrkraefte.length || !d.faecher.length || !gr.length) {
      tabelle.replaceChildren(el('caption', { text: 'Qualifikationen' }), el('tbody', {}, el('tr', {}, el('td', { class: 'leise',
        text: !gr.length ? 'Bitte mindestens eine Stufengruppe anzeigen.' : 'Zuerst Lehrkräfte und Fächer anlegen.' }))));
      return;
    }
    const knopf = (text, label, onclick, extra = {}) => el('button', { type: 'button', class: 'quali-knopf', text, 'aria-label': label, title: label, 'aria-pressed': 'false', onclick, ...extra });
    const kopf = el('tr', {}, el('th', { scope: 'col', text: 'Lehrkraft' }),
      ...d.faecher.map((f) => {
        const knoepfe = gr.map((g) => {
          const b = knopf(`alle ${g.kurz}`, `${f.kuerzel}: ${g.name} für alle Lehrkräfte`, () => spalte(f.id, g.id), { 'data-spalte-fach': f.id, 'data-gruppe': g.id });
          spaltenKnoepfe.set(f.id + S + g.id, b);
          return b;
        });
        return el('th', { scope: 'col', title: f.name }, el('div', { text: f.kuerzel }), el('div', { class: 'quali-gruppe' }, ...knoepfe));
      }));
    const koerper = el('tbody', {}, ...d.lehrkraefte.map((l) => {
      const knoepfe = gr.map((g) => {
        const b = knopf(`alle ${g.kurz}`, `${l.kuerzel}: ${g.name} für alle Fächer`, () => zeile(l.id, g.id), { 'data-zeile-lk': l.id, 'data-gruppe': g.id });
        zeilenKnoepfe.set(l.id + S + g.id, b);
        return b;
      });
      const th = el('th', { scope: 'row', 'data-lk': l.id }, el('div', { text: `${l.kuerzel} – ${l.name}` }), el('div', { class: 'quali-gruppe' }, ...knoepfe));
      return el('tr', {}, th, ...d.faecher.map((f) => {
        const td = el('td', { class: 'quali-zelle' });
        const gruppe = el('div', { class: 'quali-gruppe' }, ...gr.map((g) => {
          const b = knopf(g.kurz, `${l.kuerzel} ${f.kuerzel} ${g.name}`, () => zelle(l.id, f.id, g.id), { 'data-lk': l.id, 'data-fach': f.id, 'data-gruppe': g.id });
          schalter.set(l.id + S + f.id + S + g.id, b);
          return b;
        }));
        td.append(gruppe);
        zellen.set(l.id + S + f.id, td);
        return td;
      }));
    }));
    tabelle.replaceChildren(el('caption', { text: `Qualifikationen (${d.lehrkraefte.length} Lehrkräfte × ${d.faecher.length} Fächer)` }), el('thead', {}, kopf), koerper);
  }

  /** Hauptlehrkräfte ohne passende Qualifikation: `${lk}\u0001${fach}` → Klassennamen. */
  function h8(d) {
    const m = new Map();
    for (const zu of d.zuordnungen) {
      if (zu.rolle !== 'haupt' || !zu.lehrkraft) continue;
      const l = d.lehrkraefte.find((x) => x.id === zu.lehrkraft);
      const k = d.klassen.find((x) => x.id === zu.klasse);
      if (!l || !k || Q().stufen(l, zu.fach).has(k.stufe)) continue;
      const key = l.id + S + zu.fach;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(k.name);
    }
    return m;
  }

  function fuelle(d, gr) {
    const fehlt = h8(d);
    for (const l of d.lehrkraefte) for (const f of d.faecher) {
      for (const g of gr) {
        const b = schalter.get(l.id + S + f.id + S + g.id);
        if (!b) continue;
        const st = Q().status(l, f.id, g.id);
        b.setAttribute('aria-pressed', st === 'ja' ? 'true' : st === 'teilweise' ? 'mixed' : 'false');
        const basis = `${l.kuerzel} ${f.kuerzel} ${g.name}`;
        const text = st === 'teilweise' ? `${basis}: nur Stufen ${Q().teilText(l, f.id, g.id)} – Klick setzt die ganze Gruppe` : basis;
        b.setAttribute('aria-label', text); b.title = text;
      }
      const td = zellen.get(l.id + S + f.id);
      if (!td) continue;
      const klassen = fehlt.get(l.id + S + f.id);
      td.classList.toggle('warnung', !!klassen);
      let marke = td.querySelector('.marke');
      if (klassen) {
        if (!marke) { marke = App.el('span', { class: 'marke', text: '⚠ H8' }); td.append(marke); }
        marke.title = `${l.kuerzel} ist laut Zuordnung Hauptlehrkraft für ${f.kuerzel} in ${klassen.join(', ')}, aber für diese Stufe nicht qualifiziert (H8)`;
      } else marke?.remove();
    }
    for (const g of gr) {
      for (const l of d.lehrkraefte) zeilenKnoepfe.get(l.id + S + g.id)?.setAttribute('aria-pressed', String(d.faecher.every((f) => Q().status(l, f.id, g.id) === 'ja')));
      for (const f of d.faecher) spaltenKnoepfe.get(f.id + S + g.id)?.setAttribute('aria-pressed', String(d.lehrkraefte.every((l) => Q().status(l, f.id, g.id) === 'ja')));
    }
  }

  /* ------------------------------ Aktionen ----------------------------- */

  const gruppeName = (id) => Q().GRUPPEN.find((g) => g.id === id).name;

  function zelle(lkId, fachId, gruppenId) {
    App.aendere(() => {
      const d = App.zustand.daten;
      const l = d.lehrkraefte.find((x) => x.id === lkId);
      const an = Q().status(l, fachId, gruppenId) !== 'ja';
      return `Qualifikation ${l.kuerzel} ${d.faecher.find((f) => f.id === fachId).kuerzel} ${gruppeName(gruppenId)} ${an ? 'gesetzt' : 'entfernt'}`;
    }, (d) => {
      const l = d.lehrkraefte.find((x) => x.id === lkId);
      Q().setze(l, fachId, gruppenId, Q().status(l, fachId, gruppenId) !== 'ja');
    });
  }

  function zeile(lkId, gruppenId) {
    const allesGesetzt = (d, l) => d.faecher.every((f) => Q().status(l, f.id, gruppenId) === 'ja');
    App.aendere(() => {
      const d = App.zustand.daten;
      const l = d.lehrkraefte.find((x) => x.id === lkId);
      return `Qualifikation ${l.kuerzel}: ${gruppeName(gruppenId)} für alle Fächer ${allesGesetzt(d, l) ? 'entfernt' : 'gesetzt'}`;
    }, (d) => {
      const l = d.lehrkraefte.find((x) => x.id === lkId);
      const an = !allesGesetzt(d, l);
      for (const f of d.faecher) Q().setze(l, f.id, gruppenId, an);
    });
  }

  function spalte(fachId, gruppenId) {
    const allesGesetzt = (d) => d.lehrkraefte.every((l) => Q().status(l, fachId, gruppenId) === 'ja');
    App.aendere(() => `Qualifikation ${App.zustand.daten.faecher.find((f) => f.id === fachId).kuerzel}: ${gruppeName(gruppenId)} für alle Lehrkräfte ${allesGesetzt(App.zustand.daten) ? 'entfernt' : 'gesetzt'}`, (d) => {
      const an = !allesGesetzt(d);
      for (const l of d.lehrkraefte) Q().setze(l, fachId, gruppenId, an);
    });
  }

  /** Fokus auf die erste Schaltfläche der Zeile einer Lehrkraft (Sprung aus der Lehrkräfte-Tabelle). */
  function fokus(lkId) {
    render();
    const th = wurzel.querySelector(`#quali-matrix th[data-lk="${CSS.escape(lkId)}"]`);
    if (!th) return;
    th.scrollIntoView?.({ block: 'nearest' });
    th.parentElement.querySelector('td .quali-knopf')?.focus();
  }

  return { baue, render, fokus };
})();
