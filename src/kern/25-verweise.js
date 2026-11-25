/* ==========================================================================
 * Modul Verweise
 * Findet alle Stellen im Zustand, die auf eine Entität verweisen. Durchläuft
 * dazu das Schema, sodass jedes Referenzfeld erfasst ist – auch künftige.
 * Grundlage für „Löschen blockiert, solange die Entität referenziert wird“ (§7).
 * ========================================================================== */
const Verweise = (() => {
  'use strict';

  const BEREICH = {
    faecher: 'Fach', lehrkraefte: 'Lehrkraft', raeume: 'Raum', klassen: 'Klasse', zuordnungen: 'Zuordnung',
    'plan.regelplan': 'Regelplan', 'plan.aufsichten': 'Pausenaufsicht', 'plan.vertretungen': 'Vertretung',
    'plan.aufsichtsVertretungen': 'Aufsichtsvertretung',
  };

  /**
   * @param {object} z Zustand
   * @param {'faecher'|'lehrkraefte'|'raeume'|'klassen'} sammlung
   * @param {string} id
   * @returns {{pfad: string, text: string}[]}
   */
  function finde(z, sammlung, id) {
    const treffer = [];
    const besuche = (wert, s, pfad) => {
      if (wert === null || wert === undefined || !s) return;
      if (s.art === 'ref') {
        if (s.ziel === sammlung && wert === id) treffer.push(pfad);
      } else if (s.art === 'objekt' && typeof wert === 'object' && !Array.isArray(wert)) {
        for (const [name, fs] of Object.entries(s.felder)) besuche(wert[name], fs, pfad ? pfad + '.' + name : name);
      } else if (s.art === 'liste' && Array.isArray(wert)) {
        wert.forEach((el, i) => besuche(el, s.element, `${pfad}[${i}]`));
      }
    };
    besuche(z, Schema.ZUSTAND, '');
    // Die Entität selbst (z. B. Raum „nahe“ sich selbst) zählt nicht als fremder Verweis
    const eigenerIndex = (z[sammlung] || []).findIndex((e) => e.id === id);
    const eigen = `${sammlung}[${eigenerIndex}]`;
    return treffer.filter((p) => !p.startsWith(eigen + '.')).map((pfad) => ({ pfad, text: beschreibe(z, pfad) }));
  }

  /** Lesbare Beschreibung eines Pfads, z. B. „Klasse 1a: klassenlehrkraft“. */
  function beschreibe(z, pfad) {
    const m = /^((?:plan\.)?[a-zA-Z]+)\[(\d+)\]\.?(.*)$/.exec(pfad);
    if (!m) return pfad;
    const [, bereich, index, rest] = m;
    const liste = bereich.startsWith('plan.') ? z.plan[bereich.slice(5)] : z[bereich];
    const e = liste?.[Number(index)] || {};
    const name = (id, sammlung) => (z[sammlung] || []).find((x) => x.id === id);
    const klasse = name(e.klasse, 'klassen')?.name;
    let wer;
    if (bereich === 'zuordnungen') wer = `${klasse} ${name(e.fach, 'faecher')?.kuerzel} (${e.rolle})`;
    else if (bereich === 'plan.regelplan') wer = `${klasse} ${e.tag} ${e.stunde}. Stunde`;
    else if (bereich === 'plan.vertretungen') wer = `${klasse} ${e.datum} ${e.stunde}. Stunde`;
    else if (bereich === 'plan.aufsichten') wer = `${e.tag} vor der ${e.vorStunde}. Stunde`;
    else if (bereich === 'plan.aufsichtsVertretungen') wer = `${e.datum} vor der ${e.vorStunde}. Stunde`;
    else wer = e.name || e.kuerzel || e.id || '#' + index;
    return `${BEREICH[bereich] || bereich} ${wer}${rest ? ': ' + rest.replace(/\[\d+\]/g, '') : ''}`;
  }

  return { finde };
})();
