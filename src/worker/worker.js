/* ==========================================================================
 * Worker-Anbindung
 * Wird nicht im Hauptthread ausgeführt: Der Build legt diesen Text in ein
 * <script type="text/plain">; die Oberfläche erzeugt daraus zusammen mit dem
 * Kern einen Blob-Worker (Spezifikation §6, nur eine HTML-Datei).
 *
 * Nachrichtenprotokoll (Hauptthread → Worker): { typ, id, ...daten }
 * Antworten (Worker → Hauptthread):           { typ, id, ...daten }
 *   ping                      → pong { version }
 *   planen { zustand, optionen } → fortschritt {…} (mehrfach), dann ergebnis { plan, bericht }
 *   abbrechen                 → (keine Antwort; der laufende Plan endet mit der besten Lösung)
 *   unbekannt                 → fehler { meldung }
 * ========================================================================== */
(() => {
  'use strict';
  let laufend = null;

  const behandler = {
    ping(nachricht) {
      return { typ: 'pong', id: nachricht.id, version: Kern.version };
    },

    planen(nachricht) {
      if (laufend) throw new Error('Es läuft bereits eine Planung');
      const lauf = Kern.Planer.starte(nachricht.zustand, nachricht.optionen || {});
      laufend = lauf;
      const id = nachricht.id;
      let letzteMeldung = 0;
      const takt = () => {
        try {
          const fertig = lauf.schritt(40);
          const jetzt = Date.now();
          if (fertig || jetzt - letzteMeldung > 150) {
            self.postMessage({ typ: 'fortschritt', id, ...lauf.fortschritt() });
            letzteMeldung = jetzt;
          }
          if (fertig) {
            laufend = null;
            self.postMessage({ typ: 'ergebnis', id, ...lauf.ergebnis() });
          } else {
            setTimeout(takt, 0); // Nachrichten (z. B. „abbrechen“) dazwischen zulassen
          }
        } catch (fehler) {
          laufend = null;
          self.postMessage({ typ: 'fehler', id, meldung: String(fehler && fehler.message || fehler) });
        }
      };
      setTimeout(takt, 0);
      return null; // Antwort folgt asynchron
    },

    abbrechen() {
      if (laufend) laufend.abbrechen();
      return null;
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
