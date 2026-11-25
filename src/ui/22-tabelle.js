/* ==========================================================================
 * Modul Tabelle (Oberfläche)
 * Bearbeitbare Tabelle für Stammdaten (§7): Zeilen hinzufügen, bearbeiten,
 * löschen; sofortige Prüfung jeder Eingabe; Tastaturbedienung:
 *   Enter / ↓   übernehmen und eine Zeile nach unten (gleiche Spalte)
 *   ↑           übernehmen und eine Zeile nach oben
 *   Esc         Eingabe verwerfen
 *   Tab         nächstes Feld (Standard des Browsers)
 * Jede Änderung läuft über App.aendere (geprüft, rückgängig machbar).
 * ========================================================================== */
const Tabelle = (() => {
  'use strict';

  /** Hilfen zum Lesen und Schreiben kompakter Texteingaben. */
  const Text = {
    /** „1–4, 6“ → [1,2,3,4,6] */
    zahlen(text) {
      const ergebnis = [];
      for (const teil of text.split(',').map((t) => t.trim()).filter(Boolean)) {
        const m = /^(\d+)\s*(?:[-–]\s*(\d+))?$/.exec(teil);
        if (!m) return null;
        const von = Number(m[1]);
        const bis = m[2] ? Number(m[2]) : von;
        if (bis < von) return null;
        for (let x = von; x <= bis; x++) ergebnis.push(x);
      }
      return [...new Set(ergebnis)].sort((a, b) => a - b);
    },
    /** [1,2,3,5] → „1–3, 5“ */
    bereiche(zahlen) {
      const s = [...zahlen].sort((a, b) => a - b);
      const teile = [];
      for (let i = 0; i < s.length;) {
        let j = i;
        while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
        teile.push(j > i ? `${s[i]}–${s[j]}` : String(s[i]));
        i = j + 1;
      }
      return teile.join(', ');
    },
  };

  /**
   * @param {object} o
   * @param {string} o.id              HTML-ID der Tabelle
   * @param {string} o.beschriftung     Tabellenüberschrift
   * @param {string} o.einzahl          z. B. „Lehrkraft“ (für Knöpfe und Verlauf)
   * @param {(d: object) => object[]} o.liste       Zeilen im Datenstand
   * @param {(zeile: object, i: number) => string} [o.schluessel]  stabiler Zeilenschlüssel (Standard: id)
   * @param {(zeile: object) => string} [o.name]   lesbarer Zeilenname
   * @param {object[]} o.spalten        { feld, titel, art: text|zahl|bool|wahl|anzeige, breite, min, max, ganz,
   *                                     optionen(d) → [[wert, text]], anzeigen(zeile, d), setzen(zeile, wert, d) → Fehlertext|undefined }
   * @param {(d: object) => (object|string)} [o.neu]   neue Zeile anlegen (oder Fehlertext)
   * @param {(d: object, zeile: object) => ({pfad,text}[]|undefined)} [o.verweise] blockierende Verweise
   * @param {(d: object, schluessel: string) => void} [o.entferne] Zeile entfernen (Standard: aus liste)
   */
  function erstelle(o) {
    const el = App.el;
    const schluessel = o.schluessel || ((z) => z.id);
    const name = o.name || ((z) => z.name || z.kuerzel || z.id);
    const tabelle = el('table', { class: 'tabelle bearbeitbar', id: o.id });
    const meldung = el('div', { class: 'meldungen', 'aria-live': 'polite' });
    const wurzel = el('div', { class: 'tabellen-block' }, el('div', { class: 'tabellen-rahmen' }, tabelle));
    if (o.neu) {
      wurzel.append(el('div', { class: 'knopfleiste' },
        el('button', { type: 'button', class: 'knopf', 'data-aktion': 'neu', text: `+ ${o.einzahl} hinzufügen`, onclick: hinzufuegen })));
    }
    wurzel.append(meldung);
    let fokusNach = null; // { zeile, spalte }

    function zeige(art, titel, eintraege = []) {
      meldung.replaceChildren(el('div', { class: 'meldung meldung-' + art, role: art === 'fehler' ? 'alert' : 'status' },
        el('p', { class: 'meldung-titel', text: (art === 'fehler' ? '⚠ ' : art === 'ok' ? '✓ ' : 'ℹ ') + titel }),
        eintraege.length ? el('ul', { class: 'pfadliste' }, ...eintraege.map((f) => el('li', {}, f.pfad ? el('code', { text: f.pfad }) : null, f.pfad ? ': ' : '', f.meldung || f.text))) : null));
    }

    function render() {
      const d = App.zustand.daten;
      const aktiv = document.activeElement;
      if (!fokusNach && aktiv && tabelle.contains(aktiv) && aktiv.dataset.zeile) fokusNach = { zeile: aktiv.dataset.zeile, spalte: aktiv.dataset.spalte };
      const zeilen = o.liste(d);
      const kopf = el('tr', {}, ...o.spalten.map((s) => el('th', { scope: 'col', class: s.art === 'zahl' ? 'zahl' : null, style: s.breite ? `min-width:${s.breite}` : null, text: s.titel })));
      if (o.verweise || o.entferne) kopf.append(el('th', { scope: 'col' }, el('span', { class: 'versteckt', text: 'Aktionen' })));
      const koerper = el('tbody', {}, ...zeilen.map((z, i) => zeile(z, i, d)));
      tabelle.replaceChildren(el('caption', { text: `${o.beschriftung} (${zeilen.length})` }), el('thead', {}, kopf), koerper);
      if (!zeilen.length) koerper.append(el('tr', {}, el('td', { colspan: String(o.spalten.length + 1), class: 'leise', text: 'Noch keine Einträge.' })));
      if (fokusNach) {
        const ziel = tabelle.querySelector(`[data-zeile="${CSS.escape(fokusNach.zeile)}"][data-spalte="${CSS.escape(fokusNach.spalte)}"]`);
        fokusNach = null;
        if (ziel) { ziel.focus(); ziel.select?.(); }
      }
    }

    function zeile(z, i, d) {
      const key = schluessel(z, i);
      const tr = el('tr', { 'data-schluessel': key });
      for (const s of o.spalten) {
        const beschr = `${s.titel} – ${name(z)}`;
        const wert = s.anzeigen ? s.anzeigen(z, d) : z[s.feld];
        const gemeinsam = { 'data-zeile': key, 'data-spalte': s.feld, 'aria-label': beschr };
        let feld;
        if (s.art === 'anzeige') {
          feld = el('span', { text: String(wert ?? '') });
        } else if (s.art === 'bool') {
          feld = el('input', { type: 'checkbox', ...gemeinsam, checked: !!wert, onchange: (e) => uebernehme(key, s, e.target.checked, e.target) });
        } else if (s.art === 'wahl') {
          feld = el('select', { ...gemeinsam, onchange: (e) => uebernehme(key, s, e.target.value, e.target) },
            ...s.optionen(d).map(([w, t]) => el('option', { value: w, text: t, selected: String(w) === String(wert ?? '') })));
          feld.addEventListener('keydown', (e) => tasten(e, key, s, i, d));
        } else {
          feld = el('input', {
            type: 'text', ...gemeinsam, value: String(wert ?? ''), spellcheck: 'false', autocomplete: 'off',
            inputmode: s.art === 'zahl' ? 'decimal' : null, class: s.art === 'zahl' ? 'zahl' : null, list: s.liste || null,
            placeholder: s.platzhalter || null,
            onchange: (e) => uebernehme(key, s, e.target.value, e.target),
          });
          feld.addEventListener('keydown', (e) => tasten(e, key, s, i, d));
        }
        tr.append(el('td', { class: s.art === 'zahl' ? 'zahl' : null }, feld));
      }
      if (o.verweise || o.entferne) {
        tr.append(el('td', {}, el('button', {
          type: 'button', class: 'knopf knopf-klein knopf-gefahr', 'data-aktion': 'loeschen', 'aria-label': `${o.einzahl} ${name(z)} löschen`,
          title: `${o.einzahl} ${name(z)} löschen`, text: 'Löschen', onclick: () => loesche(key),
        })));
      }
      return tr;
    }

    function tasten(e, key, s, i) {
      const zeilen = o.liste(App.zustand.daten);
      const nachbar = (r) => {
        const j = i + r;
        if (j < 0 || j >= zeilen.length) return null;
        return { zeile: schluessel(zeilen[j], j), spalte: s.feld };
      };
      if (e.key === 'Escape') {
        e.preventDefault();
        render();
        tabelle.querySelector(`[data-zeile="${CSS.escape(key)}"][data-spalte="${CSS.escape(s.feld)}"]`)?.focus();
        meldung.replaceChildren();
        return;
      }
      const richtung = e.key === 'Enter' || (e.key === 'ArrowDown' && e.target.tagName === 'INPUT') ? 1
        : e.key === 'ArrowUp' && e.target.tagName === 'INPUT' ? -1 : 0;
      if (!richtung) return;
      e.preventDefault();
      const ziel = nachbar(richtung);
      const gespeichert = e.target.tagName === 'INPUT' && e.target.value !== String((s.anzeigen ? s.anzeigen(zeilen[i], App.zustand.daten) : zeilen[i][s.feld]) ?? '')
        ? uebernehme(key, s, e.target.value, e.target, ziel) : true;
      if (gespeichert && ziel && !fokusNach) {
        tabelle.querySelector(`[data-zeile="${CSS.escape(ziel.zeile)}"][data-spalte="${CSS.escape(ziel.spalte)}"]`)?.focus();
      }
    }

    function finde(d, key) {
      return o.liste(d).find((z, i) => schluessel(z, i) === key);
    }

    /** Übernimmt eine Eingabe; liefert true bei Erfolg. */
    function uebernehme(key, s, roh, eingabe, danach) {
      let lokal = null;
      const alt = finde(App.zustand.daten, key);
      const r = App.aendere(`${o.einzahl} ${alt ? name(alt) : key}: ${s.titel} geändert`, (d) => {
        const z = finde(d, key);
        if (!z) return false;
        lokal = s.setzen ? s.setzen(z, roh, d) : setzeStandard(z, s, roh);
        if (lokal) return false;
      });
      if (lokal || !r.ok) {
        eingabe.setAttribute('aria-invalid', 'true');
        zeige('fehler', `${s.titel} von „${alt ? name(alt) : key}“ nicht übernommen`, lokal ? [{ meldung: lokal }] : r.fehler.slice(0, 8));
        return false;
      }
      meldung.replaceChildren();
      if (danach) fokusNach = danach;
      render();
      return true;
    }

    function hinzufuegen() {
      let fehlerText = null;
      let neueZeile = null;
      const r = App.aendere(`${o.einzahl} hinzugefügt`, (d) => {
        const z = o.neu(d);
        if (typeof z === 'string') { fehlerText = z; return false; }
        neueZeile = z;
      });
      if (fehlerText || !r.ok) { zeige('fehler', `${o.einzahl} nicht hinzugefügt`, fehlerText ? [{ meldung: fehlerText }] : r.fehler.slice(0, 8)); return; }
      const liste = o.liste(App.zustand.daten);
      fokusNach = { zeile: schluessel(neueZeile, liste.length - 1), spalte: o.spalten.find((s) => s.art !== 'anzeige' && s.art !== 'bool').feld };
      zeige('ok', `${o.einzahl} „${name(neueZeile)}“ hinzugefügt – bitte Angaben ergänzen.`);
      render();
    }

    function loesche(key) {
      const d = App.zustand.daten;
      const z = finde(d, key);
      if (!z) return;
      const verweise = o.verweise ? o.verweise(d, z) || [] : [];
      if (verweise.length) {
        zeige('fehler', `${o.einzahl} „${name(z)}“ kann nicht gelöscht werden – ${verweise.length} Verweis(e):`,
          verweise.slice(0, 30).map((v) => ({ meldung: v.text })).concat(verweise.length > 30 ? [{ meldung: `… und ${verweise.length - 30} weitere` }] : []));
        return;
      }
      const r = App.aendere(`${o.einzahl} ${name(z)} gelöscht`, (neu) => {
        if (o.entferne) return o.entferne(neu, key);
        const liste = o.liste(neu);
        liste.splice(liste.findIndex((x, i) => schluessel(x, i) === key), 1);
      });
      if (!r.ok) { zeige('fehler', `${o.einzahl} „${name(z)}“ nicht gelöscht`, r.fehler.slice(0, 8)); return; }
      zeige('ok', `${o.einzahl} „${name(z)}“ gelöscht (rückgängig mit Strg+Z).`);
      render();
    }

    return { element: wurzel, render, zeige };
  }

  /** Standard-Übernahme nach Spaltenart. */
  function setzeStandard(z, s, roh) {
    if (s.art === 'bool') { z[s.feld] = !!roh; return; }
    if (s.art === 'wahl') { z[s.feld] = roh === '' ? null : roh; return; }
    if (s.art === 'zahl') {
      const t = String(roh).trim().replace(',', '.');
      const n = Number(t);
      if (t === '' || !Number.isFinite(n)) return `Bitte eine Zahl eingeben${s.min !== undefined ? ` (${s.min}–${s.max})` : ''}.`;
      if (s.ganz && !Number.isInteger(n)) return 'Bitte eine ganze Zahl eingeben.';
      if ((s.min !== undefined && n < s.min) || (s.max !== undefined && n > s.max)) return `Erlaubt sind Werte von ${s.min} bis ${s.max}.`;
      z[s.feld] = n;
      return;
    }
    const t = String(roh).trim();
    if (s.pflicht && !t) return `${s.titel} ist ein Pflichtfeld.`;
    if (s.max && t.length > s.max) return `${s.titel} darf höchstens ${s.max} Zeichen lang sein.`;
    z[s.feld] = t;
  }

  return { erstelle, Text };
})();
