/* ==========================================================================
 * Modul Index
 * Schnelle Nachschlagestrukturen über einem (gültigen) Zustand: Entitäten
 * nach ID, Zuordnungen je Klasse und Fach, Stundentafeln, Qualifikationen,
 * Sperrzeiten, Abwesenheiten, Raumtyp-Prüfung. Grundlage für Regeln, Kosten,
 * Planer und Vertretung.
 * ========================================================================== */
const Index = (() => {
  'use strict';

  const schluessel = (...teile) => teile.join('|');

  /** Erstellt den Index. Der Zustand muss die Schema-Prüfung bestanden haben. */
  function erstelle(z) {
    const zr = z.zeitraster;
    const tage = zr.tage.slice();
    const tagIndex = new Map(tage.map((t, i) => [t, i]));
    const stunden = zr.stunden.map((s) => s.nr);
    const stundeInfo = new Map(zr.stunden.map((s) => [s.nr, s]));
    const pausen = (zr.pausen || []).slice().sort((a, b) => a.vorStunde - b.vorStunde);
    const pauseVor = new Map(pausen.map((p) => [p.vorStunde, p]));
    const doppelstundenStart = new Set(zr.doppelstundenStart || []);

    const nachId = (liste) => new Map(liste.map((e) => [e.id, e]));
    const lehrkraefte = nachId(z.lehrkraefte);
    const klassen = nachId(z.klassen);
    const raeume = nachId(z.raeume);
    const faecher = nachId(z.faecher);
    const einstellungen = z.einstellungen;

    // Zuordnungen je Klasse und Fach: { haupt: id|null, zweit: id[] }
    const zuordnung = new Map();
    for (const zu of z.zuordnungen) {
      const k = schluessel(zu.klasse, zu.fach);
      if (!zuordnung.has(k)) zuordnung.set(k, { haupt: null, zweit: [] });
      if (zu.rolle === 'haupt') zuordnung.get(k).haupt = zu.lehrkraft;
      else zuordnung.get(k).zweit.push(zu.lehrkraft);
    }
    // Lehrkräfte, die eine Klasse laut Zuordnung unterrichten (für „eigene Lehrkraft“)
    const lehrkraefteDerKlasse = new Map();
    for (const zu of z.zuordnungen) {
      if (!lehrkraefteDerKlasse.has(zu.klasse)) lehrkraefteDerKlasse.set(zu.klasse, new Set());
      lehrkraefteDerKlasse.get(zu.klasse).add(zu.lehrkraft);
    }

    // Stundentafel je Klasse: Map fach → { stunden, doppelt }
    const tafel = new Map(z.klassen.map((k) => [k.id, new Map(k.stundentafel.map((e) => [e.fach, e]))]));

    // Sperrzeiten als Mengen „Tag|Stunde“
    const sperren = (liste) => {
      const m = new Set();
      for (const g of liste || []) for (const s of g.stunden) m.add(schluessel(g.tag, s));
      return m;
    };
    const gesperrtL = new Map(z.lehrkraefte.map((l) => [l.id, sperren(l.gesperrt)]));
    const gesperrtR = new Map(z.raeume.map((r) => [r.id, sperren(r.gesperrt)]));

    function istQualifiziert(lehrkraftId, fachId, stufe) {
      const l = lehrkraefte.get(lehrkraftId);
      return !!l && l.qualifikationen.some((q) => q.fach === fachId && q.stufenVon <= stufe && stufe <= q.stufenBis);
    }
    const anzahlQualifiziertCache = new Map();
    function anzahlQualifizierte(fachId, stufe) {
      const k = schluessel(fachId, stufe);
      if (!anzahlQualifiziertCache.has(k)) {
        anzahlQualifiziertCache.set(k, z.lehrkraefte.filter((l) => istQualifiziert(l.id, fachId, stufe)).length);
      }
      return anzahlQualifiziertCache.get(k);
    }
    const lehrkraftGesperrt = (id, tag, stunde) => !!gesperrtL.get(id)?.has(schluessel(tag, stunde));
    const raumGesperrt = (id, tag, stunde) => !!gesperrtR.get(id)?.has(schluessel(tag, stunde));
    const abwesend = (eintrag, datum) => !!datum && !!eintrag && (eintrag.abwesenheiten || []).some((a) => a.von <= datum && datum <= a.bis);
    const lehrkraftAbwesend = (id, datum) => abwesend(lehrkraefte.get(id), datum);
    const raumAbwesend = (id, datum) => abwesend(raeume.get(id), datum);

    /** Vertretungsreserve in Stunden (Annahme 11: aufgerundet). */
    const reserve = (l) => Modell.vertretungsreserve(l.sollStunden, einstellungen.vertretungsreserveProzent);

    /**
     * Passt der Raum zum Fach (H5)? Ein Fach mit Raumtyp braucht genau diesen Typ,
     * Fachräume, Turn- und Schwimmhallen sind Fächern mit passendem Raumtyp vorbehalten.
     */
    function raumPasst(raumId, fachId) {
      const r = raeume.get(raumId);
      const f = faecher.get(fachId);
      if (!r || !f) return true;
      return Modell.raumtypSchluessel(f.raumtyp) === Modell.raumtypDesRaums(r);
    }

    /** Ist die Stunde „Vormittag“ (Beginn vor 12:00)? Für W4. */
    const istVormittag = (stunde) => (stundeInfo.get(stunde)?.von || '00:00') < '12:00';

    /** Lesbare Namen für Meldungen. */
    const name = {
      lehrkraft: (id) => lehrkraefte.get(id)?.kuerzel || id,
      klasse: (id) => klassen.get(id)?.name || id,
      raum: (id) => raeume.get(id)?.name || id,
      fach: (id) => faecher.get(id)?.kuerzel || id || '–',
      slot: (tag, stunde) => `${tag} ${stunde}.`,
      pause: (tag, vor) => `${tag} ${pauseVor.get(vor)?.name || 'Pause'} (vor der ${vor}. Stunde)`,
    };

    return {
      z, tage, tagIndex, stunden, stundeInfo, pausen, pauseVor, doppelstundenStart,
      lehrkraefte, klassen, raeume, faecher, einstellungen, zuordnung, lehrkraefteDerKlasse, tafel,
      istQualifiziert, anzahlQualifizierte, lehrkraftGesperrt, raumGesperrt, lehrkraftAbwesend, raumAbwesend,
      reserve, raumPasst, istVormittag, name,
      zuordnungVon: (klasse, fach) => zuordnung.get(schluessel(klasse, fach)) || { haupt: null, zweit: [] },
    };
  }

  /**
   * Statusgruppen einer Unterrichtsstunde:
   *  - belegt:   die Klasse ist anwesend (H12) – alles außer „entfaellt“
   *  - abgedeckt: Stunde der Stundentafel findet statt (K1) – alles außer „entfaellt“ und „aufsicht“
   *  - fachunterricht: Hauptlehrkraft erteilt Fachunterricht (K2, K3) – „regulaer“ und „vertreten“
   *  - mitRaum:  braucht einen Raum – alles außer „entfaellt“ und „aufgeteilt“
   */
  const STATUS = {
    belegt: (s) => s.status !== 'entfaellt',
    abgedeckt: (s) => s.status !== 'entfaellt' && s.status !== 'aufsicht',
    fachunterricht: (s) => s.status === 'regulaer' || s.status === 'vertreten',
    mitRaum: (s) => s.status !== 'entfaellt' && s.status !== 'aufgeteilt',
  };

  return { erstelle, schluessel, STATUS };
})();
