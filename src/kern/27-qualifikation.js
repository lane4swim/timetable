/* ==========================================================================
 * Modul Qualifikation
 * Qualifikationen werden in der Oberfläche als Stufengruppen gepflegt
 * (Primarstufe 1–4, Sekundarstufe I 5–10, Sekundarstufe II 11–13). Im
 * Datenmodell bleiben sie Stufenbereiche (stufenVon/stufenBis); dieses Modul
 * übersetzt in beide Richtungen. Bereiche, die eine Gruppe nur teilweise
 * abdecken (z. B. 3–4 aus einer Importdatei), werden als „teilweise“ erkannt.
 * ========================================================================== */
const Qualifikation = (() => {
  'use strict';

  const GRUPPEN = Object.freeze([
    { id: 'P', kurz: 'P', name: 'Primarstufe', von: 1, bis: 4 },
    { id: 'SI', kurz: 'SI', name: 'Sekundarstufe I', von: 5, bis: 10 },
    { id: 'SII', kurz: 'SII', name: 'Sekundarstufe II', von: 11, bis: 13 },
  ]);

  /** Menge der Stufen, für die die Lehrkraft das Fach unterrichten darf. */
  function stufen(lehrkraft, fachId) {
    const m = new Set();
    for (const q of lehrkraft.qualifikationen || []) {
      if (q.fach !== fachId) continue;
      for (let s = q.stufenVon; s <= q.stufenBis; s++) m.add(s);
    }
    return m;
  }

  /** Zustand einer Gruppe: 'ja' (ganz), 'teilweise' oder 'nein'. */
  function status(lehrkraft, fachId, gruppenId) {
    const g = GRUPPEN.find((x) => x.id === gruppenId);
    const m = stufen(lehrkraft, fachId);
    let n = 0;
    for (let s = g.von; s <= g.bis; s++) if (m.has(s)) n++;
    return n === 0 ? 'nein' : n === g.bis - g.von + 1 ? 'ja' : 'teilweise';
  }

  /** Abgedeckte Stufen einer teilweise gesetzten Gruppe als Text, z. B. „3–4“. */
  function teilText(lehrkraft, fachId, gruppenId) {
    const g = GRUPPEN.find((x) => x.id === gruppenId);
    const m = stufen(lehrkraft, fachId);
    return bereiche([...m].filter((s) => s >= g.von && s <= g.bis)).map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(', ');
  }

  /** Zusammenhängende Bereiche einer Zahlenmenge: [1,2,3,5] → [[1,3],[5,5]]. */
  function bereiche(zahlen) {
    const s = [...new Set(zahlen)].sort((a, b) => a - b);
    const ergebnis = [];
    for (const x of s) {
      const letzter = ergebnis[ergebnis.length - 1];
      if (letzter && x === letzter[1] + 1) letzter[1] = x; else ergebnis.push([x, x]);
    }
    return ergebnis;
  }

  /**
   * Setzt oder entfernt eine Stufengruppe für ein Fach (verändert die Lehrkraft).
   * Die Einträge dieses Fachs werden zu möglichst wenigen Bereichen zusammengefasst;
   * andere Fächer bleiben unverändert und in ihrer Reihenfolge.
   */
  function setze(lehrkraft, fachId, gruppenId, an) {
    const g = GRUPPEN.find((x) => x.id === gruppenId);
    const m = stufen(lehrkraft, fachId);
    for (let s = g.von; s <= g.bis; s++) { if (an) m.add(s); else m.delete(s); }
    const liste = lehrkraft.qualifikationen || [];
    const pos = liste.findIndex((q) => q.fach === fachId);
    const neu = bereiche([...m]).map(([von, bis]) => ({ fach: fachId, stufenVon: von, stufenBis: bis }));
    const ohne = liste.filter((q) => q.fach !== fachId);
    const einfuegen = pos < 0 ? ohne.length : liste.slice(0, pos).filter((q) => q.fach !== fachId).length;
    ohne.splice(einfuegen, 0, ...neu);
    lehrkraft.qualifikationen = ohne;
  }

  /**
   * Kurze Zusammenfassung, Fächer mit gleichen Gruppen zusammengefasst:
   * „DE, MA, SU (P) · EN (P, SI) · KU (3–4)“. Gilt eine Angabe für alle
   * (mindestens zwei) Fächer, heißt es „alle Fächer (P)“.
   */
  function zusammenfassung(lehrkraft, faecher) {
    const je = new Map();
    for (const f of faecher) {
      const teile = GRUPPEN.map((g) => {
        const st = status(lehrkraft, f.id, g.id);
        return st === 'ja' ? g.kurz : st === 'teilweise' ? teilText(lehrkraft, f.id, g.id) : null;
      }).filter(Boolean);
      if (!teile.length) continue;
      const k = teile.join(', ');
      if (!je.has(k)) je.set(k, []);
      je.get(k).push(f.kuerzel);
    }
    return [...je].map(([gruppen, kuerzel]) => `${kuerzel.length === faecher.length && kuerzel.length > 1 ? 'alle Fächer' : kuerzel.join(', ')} (${gruppen})`).join(' · ');
  }

  /** Gruppen, in denen es Klassen gibt (für die Anzeige); ohne Klassen alle. */
  function genutzteGruppen(z) {
    const g = GRUPPEN.filter((x) => z.klassen.some((k) => k.stufe >= x.von && k.stufe <= x.bis)).map((x) => x.id);
    return g.length ? g : GRUPPEN.map((x) => x.id);
  }

  return { GRUPPEN, stufen, status, teilText, setze, zusammenfassung, genutzteGruppen };
})();
