/* ==========================================================================
 * Modul Farben
 * Farben für die Plan-Ansicht: jedes Fach färbt den Hintergrund seiner Karten,
 * jede Lehrkraft einen seitlichen Balken. Ohne eigene Angabe (Feld `farbe` an
 * Fach bzw. Lehrkraft) werden Farben über den Goldenen Winkel verteilt, damit
 * benachbarte Einträge möglichst verschieden aussehen.
 * Kontraste (WCAG): Text (#1a1d23) und Nebentext (#4a5160) auf Fachfarben
 * mindestens 4,5 : 1; Lehrkraftbalken gegen jede Fachfarbe und Weiß
 * mindestens 3 : 1. Eigene Farben werden bei Bedarf aufgehellt bzw. abgedunkelt.
 * Farbe ist nie alleiniger Informationsträger: Kürzel stehen immer als Text.
 * ========================================================================== */
const Farben = (() => {
  'use strict';

  const TEXT = '#1a1d23';
  const NEBENTEXT = '#4a5160';
  const GOLDEN = 137.508;

  function hslZuHex(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(c * 255).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  function leuchtdichte(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function kontrast(a, b) {
    const [x, y] = [leuchtdichte(a), leuchtdichte(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }

  /** Mischt eine Farbe mit Weiß (anteil > 0) oder Schwarz (anteil < 0). */
  function mische(hex, anteil) {
    const ziel = anteil > 0 ? 255 : 0;
    const t = Math.abs(anteil);
    return '#' + [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16);
      return Math.round(c + (ziel - c) * t).toString(16).padStart(2, '0');
    }).join('');
  }

  const istHex = (x) => typeof x === 'string' && /^#[0-9a-fA-F]{6}$/.test(x);

  /** Hellt auf, bis Text und Nebentext mindestens 4,5 : 1 erreichen. */
  function lesbarerHintergrund(hex) {
    let f = hex.toLowerCase();
    for (let t = 0.05; kontrast(f, NEBENTEXT) < 4.5 && t <= 1; t += 0.05) f = mische(hex.toLowerCase(), t);
    return f;
  }

  /**
   * Dunkelt ab, bis der Balken gegen jede zulässige Fachfarbe ≥ 3 : 1 hat.
   * Fachfarben haben wegen ≥ 4,5 : 1 zum Nebentext eine Leuchtdichte ≥ 0,535;
   * ein Balken mit ≥ 5,5 : 1 gegen Weiß erfüllt damit (0,535 + 0,05) / (L + 0,05) ≥ 3.
   */
  function sichtbarerBalken(hex) {
    let f = hex.toLowerCase();
    for (let t = 0.05; kontrast(f, '#ffffff') < 5.5 && t <= 1; t += 0.05) f = mische(hex.toLowerCase(), -t);
    return f;
  }

  /** Farbtöne der ersten zwölf Fächer: möglichst weit auseinander (danach Goldener Winkel). */
  const FACH_TOENE = [205, 35, 125, 285, 0, 170, 55, 325, 90, 245, 18, 150];

  /** Standardfarbe eines Fachs (Hintergrund) nach Position in der Fachliste. */
  function fachStandard(index) {
    const ton = index < FACH_TOENE.length ? FACH_TOENE[index] : (index * GOLDEN + 200) % 360;
    return lesbarerHintergrund(hslZuHex(ton, 0.75, 0.88));
  }

  /** Standardfarbe einer Lehrkraft (Balken) nach Position in der Lehrkräfteliste. */
  function lehrkraftStandard(index) {
    return sichtbarerBalken(hslZuHex((index * GOLDEN + 20) % 360, 0.7, 0.38));
  }

  /** Effektive Farbe eines Fachs (eigene Angabe, sonst Standard). */
  function fach(z, fachId) {
    const i = z.faecher.findIndex((f) => f.id === fachId);
    if (i < 0) return '#eeeeee';
    const eigen = z.faecher[i].farbe;
    return istHex(eigen) ? lesbarerHintergrund(eigen) : fachStandard(i);
  }

  /** Effektive Farbe einer Lehrkraft (eigene Angabe, sonst Standard). */
  function lehrkraft(z, lehrkraftId) {
    const i = z.lehrkraefte.findIndex((l) => l.id === lehrkraftId);
    if (i < 0) return '#6b7280';
    const eigen = z.lehrkraefte[i].farbe;
    return istHex(eigen) ? sichtbarerBalken(eigen) : lehrkraftStandard(i);
  }

  return { TEXT, NEBENTEXT, hslZuHex, kontrast, mische, istHex, lesbarerHintergrund, sichtbarerBalken, fachStandard, lehrkraftStandard, fach, lehrkraft };
})();
