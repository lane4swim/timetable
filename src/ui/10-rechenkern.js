/* ==========================================================================
 * Modul Rechenkern (Oberfläche)
 * Erzeugt den Web Worker aus Kern- und Worker-Quelltext der Seite (Blob)
 * und bietet eine Promise-basierte Anfrage-Schnittstelle.
 * ========================================================================== */
const Rechenkern = (() => {
  'use strict';
  let worker = null;
  let naechsteId = 1;
  const offen = new Map();

  /** Startet den Worker. Liefert false, wenn der Browser es nicht erlaubt. */
  function starte() {
    if (worker) return true;
    const kern = document.getElementById('kern');
    const glue = document.getElementById('worker-quelle');
    if (!kern || !glue || typeof Worker === 'undefined') return false;
    const blob = new Blob([kern.textContent, '\n', glue.textContent], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      worker = new Worker(url);
    } catch (e) {
      console.error('Worker konnte nicht gestartet werden', e);
      worker = null;
      return false;
    } finally {
      // Der Worker hat das Skript beim Start geladen; die URL wird nicht mehr gebraucht.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    worker.onmessage = (e) => {
      const antwort = e.data || {};
      const eintrag = offen.get(antwort.id);
      if (!eintrag) return;
      if (antwort.typ === 'fortschritt') { eintrag.beiFortschritt?.(antwort); return; }
      offen.delete(antwort.id);
      if (antwort.typ === 'fehler') eintrag.ablehnen(new Error(antwort.meldung));
      else eintrag.erfuellen(antwort);
    };
    worker.onerror = (e) => {
      for (const eintrag of offen.values()) eintrag.ablehnen(new Error(e.message || 'Worker-Fehler'));
      offen.clear();
    };
    return true;
  }

  /** Sendet eine Anfrage und wartet auf die Antwort mit derselben id. */
  function anfrage(typ, daten = {}, beiFortschritt) {
    if (!starte()) return Promise.reject(new Error('Rechenkern nicht verfügbar'));
    const id = naechsteId++;
    return new Promise((erfuellen, ablehnen) => {
      offen.set(id, { erfuellen, ablehnen, beiFortschritt });
      worker.postMessage({ ...daten, typ, id });
    });
  }

  return { starte, anfrage };
})();
