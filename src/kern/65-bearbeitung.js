/* ==========================================================================
 * Modul Bearbeitung
 * Manuelle Änderungen am Regelplan (§7 Plan-Ansicht): Stunden verschieben,
 * Zweitbesetzung setzen/entfernen, Aufsichten verschieben/hinzufügen/entfernen.
 * Alle Funktionen verändern den übergebenen Zustand (in der Oberfläche eine
 * Kopie innerhalb von App.aendere) und liefern eine Beschreibung für den
 * Verlauf oder einen Fehlertext. Harte Regeln werden NICHT erzwungen: Die
 * Oberfläche zeigt Verstöße an und markiert den Plan als ungültig (§4).
 * ========================================================================== */
const Bearbeitung = (() => {
  'use strict';

  const name = (z, sammlung, id, feld = 'name') => z[sammlung].find((x) => x.id === id)?.[feld] || id;

  /**
   * Verschiebt Stunde `index` der Klasse auf (tag, stunde). Hat die Klasse dort
   * bereits eine Stunde, tauschen beide ihre Plätze.
   * @returns {{text: string}|{fehler: string}}
   */
  function verschiebeStunde(z, index, tag, stunde) {
    const plan = z.plan.regelplan;
    const s = plan[index];
    if (!s) return { fehler: 'Diese Stunde gibt es nicht mehr.' };
    if (!z.zeitraster.tage.includes(tag) || !z.zeitraster.stunden.some((x) => x.nr === stunde)) return { fehler: 'Dieser Zeitslot liegt nicht im Zeitraster.' };
    if (s.tag === tag && s.stunde === stunde) return { fehler: 'Die Stunde liegt bereits dort.' };
    const andere = plan.findIndex((x, i) => i !== index && x.klasse === s.klasse && x.tag === tag && x.stunde === stunde);
    const text = `${name(z, 'klassen', s.klasse)} ${name(z, 'faecher', s.fach, 'kuerzel')} ${s.tag} ${s.stunde}. → ${tag} ${stunde}.`;
    if (andere >= 0) {
      plan[andere].tag = s.tag;
      plan[andere].stunde = s.stunde;
    }
    s.tag = tag;
    s.stunde = stunde;
    return { text: andere >= 0 ? `${text} (getauscht mit ${name(z, 'faecher', plan[andere].fach, 'kuerzel')})` : text };
  }

  /** Setzt (oder entfernt mit null) die Zweitbesetzung einer Stunde. */
  function setzeZweit(z, index, lehrkraft) {
    const s = z.plan.regelplan[index];
    if (!s) return { fehler: 'Diese Stunde gibt es nicht mehr.' };
    const wo = `${name(z, 'klassen', s.klasse)} ${s.tag} ${s.stunde}.`;
    if (lehrkraft === null) {
      if (s.lehrkraefte.length < 2) return { fehler: 'Die Stunde hat keine Zweitbesetzung.' };
      const alt = s.lehrkraefte[1];
      s.lehrkraefte = s.lehrkraefte.slice(0, 1);
      return { text: `Zweitbesetzung ${name(z, 'lehrkraefte', alt, 'kuerzel')} aus ${wo} entfernt` };
    }
    if (!(s.status === 'regulaer' || s.status === 'vertreten') || !s.lehrkraefte.length) return { fehler: 'Eine Zweitbesetzung ist nur in Unterrichtsstunden mit Hauptlehrkraft möglich.' };
    if (s.lehrkraefte[0] === lehrkraft) return { fehler: 'Die Lehrkraft ist bereits Hauptlehrkraft dieser Stunde.' };
    if (z.einstellungen.maxLehrkraefteProKlasseUndSlot < 2) return { fehler: 'Laut Einstellung ist nur eine Lehrkraft je Klasse und Stunde erlaubt.' };
    s.lehrkraefte = [s.lehrkraefte[0], lehrkraft];
    return { text: `${name(z, 'lehrkraefte', lehrkraft, 'kuerzel')} als Zweitbesetzung in ${wo}` };
  }

  function verschiebeAufsicht(z, index, tag, vorStunde) {
    const a = z.plan.aufsichten[index];
    if (!a) return { fehler: 'Diese Aufsicht gibt es nicht mehr.' };
    if (a.tag === tag && a.vorStunde === vorStunde) return { fehler: 'Die Aufsicht liegt bereits dort.' };
    if (z.plan.aufsichten.some((x, i) => i !== index && x.tag === tag && x.vorStunde === vorStunde && x.lehrkraft === a.lehrkraft)) return { fehler: 'Die Lehrkraft hat in dieser Pause bereits Aufsicht.' };
    const text = `Aufsicht ${name(z, 'lehrkraefte', a.lehrkraft, 'kuerzel')} ${a.tag} vor ${a.vorStunde}. → ${tag} vor ${vorStunde}.`;
    a.tag = tag;
    a.vorStunde = vorStunde;
    return { text };
  }

  function neueAufsicht(z, tag, vorStunde, lehrkraft) {
    if (z.plan.aufsichten.some((x) => x.tag === tag && x.vorStunde === vorStunde && x.lehrkraft === lehrkraft)) return { fehler: 'Die Lehrkraft hat in dieser Pause bereits Aufsicht.' };
    z.plan.aufsichten.push({ tag, vorStunde, lehrkraft });
    return { text: `Aufsicht ${name(z, 'lehrkraefte', lehrkraft, 'kuerzel')} ${tag} vor ${vorStunde}. eingeteilt` };
  }

  function entferneAufsicht(z, index) {
    const a = z.plan.aufsichten[index];
    if (!a) return { fehler: 'Diese Aufsicht gibt es nicht mehr.' };
    z.plan.aufsichten.splice(index, 1);
    return { text: `Aufsicht ${name(z, 'lehrkraefte', a.lehrkraft, 'kuerzel')} ${a.tag} vor ${a.vorStunde}. entfernt` };
  }

  /**
   * Lehrkräfte mit ungenutztem Kontingent für Zweitbesetzung (§7):
   * min(Soll − Reserve, Höchstgrenze) − Ist > 0.
   */
  function freieKontingente(z) {
    const ix = Index.erstelle(z);
    const stunden = Regeln.lehrkraftStunden(z.plan.regelplan);
    return z.lehrkraefte.map((l) => {
      const ist = stunden.get(l.id)?.slots.size || 0;
      return { lehrkraft: l.id, ist, frei: Math.min(l.sollStunden - ix.reserve(l), l.maxStunden) - ist };
    }).filter((x) => x.frei > 0);
  }

  /** Lehrkräfte, deren Aufsichtssoll noch nicht erfüllt ist. */
  function offeneAufsichten(z) {
    const zahl = new Map();
    for (const a of z.plan.aufsichten) zahl.set(a.lehrkraft, (zahl.get(a.lehrkraft) || 0) + 1);
    return z.lehrkraefte.map((l) => ({ lehrkraft: l.id, offen: l.aufsichtenProWoche - (zahl.get(l.id) || 0) })).filter((x) => x.offen > 0);
  }

  return { verschiebeStunde, setzeZweit, verschiebeAufsicht, neueAufsicht, entferneAufsicht, freieKontingente, offeneAufsichten };
})();
