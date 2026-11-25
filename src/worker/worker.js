/* ==========================================================================
 * Worker-Anbindung
 * Wird nicht im Hauptthread ausgeführt: Der Build legt diesen Text in ein
 * <script type="text/plain">; die Oberfläche erzeugt daraus zusammen mit dem
 * Kern einen Blob-Worker (Spezifikation §6, nur eine HTML-Datei).
 *
 * Nachrichtenprotokoll (Hauptthread → Worker): { typ, id, ...daten }
 * Antworten (Worker → Hauptthread):           { typ, id, ...daten }
 *   ping          → pong { version }
 *   (ab M4) planen, abbrechen → fortschritt / ergebnis
 *   unbekannt     → fehler { meldung }
 * ========================================================================== */
(() => {
  'use strict';
  const behandler = {
    ping(nachricht) {
      return { typ: 'pong', id: nachricht.id, version: Kern.version };
    },
  };

  self.onmessage = (ereignis) => {
    const nachricht = ereignis.data || {};
    const fn = behandler[nachricht.typ];
    try {
      if (!fn) throw new Error('Unbekannte Nachricht: ' + nachricht.typ);
      const antwort = fn(nachricht);
      if (antwort) self.postMessage(antwort);
    } catch (fehler) {
      self.postMessage({ typ: 'fehler', id: nachricht.id, meldung: String(fehler && fehler.message || fehler) });
    }
  };
})();
