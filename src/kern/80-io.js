/* ==========================================================================
 * Modul Io (Import/Export)
 * Wandelt den Zustand in JSON-Text und zurück (Spezifikation §8).
 *   - exportiere(): vollständig oder als Teil („stammdaten“ / „plan“)
 *   - importiere(): prüft vollständig, bevor irgendetwas übernommen wird;
 *                   bei einem Fehler bleibt der aktuelle Zustand unverändert
 * Beide Funktionen sind rein (kein DOM, keine Seiteneffekte). Das
 * Herunterladen und das Lesen der Datei übernimmt die Oberfläche.
 * ========================================================================== */
const Io = (() => {
  'use strict';

  const TEILNAMEN = { gesamt: 'alle Daten', stammdaten: 'Stammdaten', plan: 'Plan' };

  /** Kanonischer JSON-Text (Schemareihenfolge, 2 Leerzeichen, Zeilenende). */
  function serialisiere(daten) {
    return JSON.stringify(Schema.ordne(daten), null, 2) + '\n';
  }

  /**
   * Erzeugt Dateiname und Inhalt für einen Export.
   * @param {object} zustand aktueller Zustand
   * @param {{teil?: 'gesamt'|'stammdaten'|'plan', jetzt?: Date}} [optionen]
   * @returns {{dateiname: string, text: string, daten: object}}
   */
  function exportiere(zustand, { teil = 'gesamt', jetzt = new Date() } = {}) {
    if (!(teil in TEILNAMEN)) throw new Error('Unbekannter Exportteil: ' + teil);
    const kopf = { schemaVersion: Modell.SCHEMA_VERSION, exportedAt: Hilfen.isoMitZeitzone(jetzt) };
    let daten;
    if (teil === 'gesamt') {
      daten = { ...Hilfen.tiefeKopie(zustand), ...kopf };
      delete daten.teil;
    } else if (teil === 'stammdaten') {
      // Alles außer dem Plan – auch unbekannte Felder der obersten Ebene bleiben so erhalten.
      daten = { ...Hilfen.tiefeKopie(zustand), ...kopf, teil };
      delete daten.plan;
    } else {
      daten = { ...kopf, teil, plan: Hilfen.tiefeKopie(zustand.plan) };
    }
    const geordnet = Schema.ordne(daten);
    return {
      dateiname: Hilfen.exportDateiname(jetzt, teil === 'gesamt' ? '' : teil),
      text: JSON.stringify(geordnet, null, 2) + '\n',
      daten: geordnet,
    };
  }

  /**
   * Liest eine Exportdatei ein. Verändert `aktuell` nicht.
   * @param {string} text Dateiinhalt
   * @param {object} aktuell aktueller Zustand (für Teil-Importe)
   * @param {{planVerwerfen?: boolean, migrationen?: object}} [optionen]
   *        planVerwerfen: beim Stammdaten-Import den bisherigen Plan nicht übernehmen
   * @returns {{ok: boolean, zustand?: object, teil: 'gesamt'|'stammdaten'|'plan',
   *            fehler: {pfad,meldung}[], warnungen: {pfad,meldung}[],
   *            planUnvertraeglich?: boolean, migriertVon?: number}}
   */
  function importiere(text, aktuell, { planVerwerfen = false, migrationen } = {}) {
    const abgelehnt = (fehler, teil = 'gesamt', extra = {}) => ({ ok: false, teil, fehler, warnungen: [], ...extra });

    // 1. JSON lesen
    let daten;
    try {
      daten = JSON.parse(typeof text === 'string' ? text.replace(/^﻿/, '') : text);
    } catch (e) {
      return abgelehnt([{ pfad: '', meldung: 'Die Datei ist keine gültige JSON-Datei (' + e.message + ')' }]);
    }
    if (daten === null || typeof daten !== 'object' || Array.isArray(daten)) {
      return abgelehnt([{ pfad: '', meldung: 'Die Datei muss ein JSON-Objekt enthalten' }]);
    }

    // 2. Version prüfen und ggf. migrieren
    const m = migrationen ? Schema.migriere(daten, migrationen) : Schema.migriere(daten);
    if (m.fehler.length) return abgelehnt(m.fehler);
    daten = m.daten;

    // 3. Teil bestimmen und mit dem aktuellen Zustand zusammenführen
    const teil = daten.teil === undefined ? 'gesamt' : daten.teil;
    if (!(teil in TEILNAMEN) || teil === 'gesamt' && daten.teil !== undefined) {
      return abgelehnt([{ pfad: 'teil', meldung: `unbekannter Teil „${daten.teil}“; erlaubt: stammdaten, plan` }]);
    }
    let kandidat;
    if (teil === 'gesamt') {
      kandidat = daten;
    } else if (teil === 'stammdaten') {
      if (daten.plan !== undefined) return abgelehnt([{ pfad: 'plan', meldung: 'eine Stammdaten-Datei darf keinen Plan enthalten' }], teil);
      kandidat = { ...daten, plan: planVerwerfen ? {} : Hilfen.tiefeKopie(aktuell.plan) };
    } else {
      if (daten.plan === undefined) return abgelehnt([{ pfad: 'plan', meldung: 'Pflichtfeld fehlt' }], teil);
      const unerwartet = Object.keys(daten).filter((k) => !['schemaVersion', 'exportedAt', 'teil', 'plan'].includes(k) && Schema.ZUSTAND.felder[k]);
      if (unerwartet.length) return abgelehnt(unerwartet.map((k) => ({ pfad: k, meldung: 'eine Plan-Datei darf keine Stammdaten enthalten' })), teil);
      kandidat = { ...Hilfen.tiefeKopie(aktuell), plan: daten.plan };
    }
    delete kandidat.teil;

    // 4. Standardwerte ergänzen und vollständig prüfen
    Schema.normalisiere(kandidat);
    const { fehler, warnungen } = Schema.validiere(kandidat);
    if (fehler.length) {
      const planBetroffen = teil === 'stammdaten' && !planVerwerfen && fehler.every((f) => f.pfad.startsWith('plan'));
      return { ok: false, teil, fehler, warnungen, planUnvertraeglich: planBetroffen };
    }
    if (teil === 'plan') kandidat.exportedAt = aktuell.exportedAt;
    if (kandidat.exportedAt === undefined) delete kandidat.exportedAt;
    return { ok: true, teil, zustand: Schema.ordne(kandidat), fehler: [], warnungen, migriertVon: m.migriertVon };
  }

  return { TEILNAMEN, serialisiere, exportiere, importiere };
})();
