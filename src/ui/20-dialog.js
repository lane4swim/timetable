/* ==========================================================================
 * Modul Dialog (Oberfläche)
 * Modale Rückfrage auf Basis des <dialog>-Elements: Fokus bleibt im Dialog,
 * Esc bricht ab, Ergebnis als Promise.
 * ========================================================================== */
const Dialog = (() => {
  'use strict';
  let zaehler = 0;

  /**
   * @param {{titel: string, text: string, knoepfe: {text: string, wert: string, art?: 'primaer'|'gefahr', fokus?: boolean}[]}} o
   * @returns {Promise<string>} `wert` des gewählten Knopfs, „abbrechen“ bei Esc
   */
  function frage({ titel, text, knoepfe }) {
    return new Promise((erfuellen) => {
      const id = 'dialog-titel-' + (++zaehler);
      const d = document.createElement('dialog');
      d.className = 'dialog';
      d.setAttribute('aria-labelledby', id);
      const h = document.createElement('h2');
      h.id = id;
      h.textContent = titel;
      const p = document.createElement('p');
      p.textContent = text;
      const leiste = document.createElement('div');
      leiste.className = 'dialog-knoepfe';
      let fokus = null;
      for (const k of knoepfe) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = k.text;
        b.className = 'knopf' + (k.art ? ' knopf-' + k.art : '');
        b.dataset.wert = k.wert;
        b.addEventListener('click', () => d.close(k.wert));
        if (k.fokus) fokus = b;
        leiste.append(b);
      }
      d.append(h, p, leiste);
      d.addEventListener('close', () => {
        erfuellen(d.returnValue || 'abbrechen');
        d.remove();
      });
      document.body.append(d);
      d.showModal();
      (fokus || leiste.lastElementChild)?.focus();
    });
  }

  return { frage };
})();
