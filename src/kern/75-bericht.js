/* ==========================================================================
 * Modul Bericht
 * Kennzahlen für den Reiter „Bericht“ (Spezifikation §7):
 *   - Regelplan: Kostenvektor, harte Verstöße, Ausfall je Klasse und Fach
 *   - Vertretungen im Zeitraum: Fälle, Ausfall je Klasse und Fach,
 *     Vertretungsquote, offene (noch nicht vertretene) Fälle
 *   - Auslastung je Lehrkraft: Soll, Haupt- und Zweitbesetzungsstunden,
 *     ungenutztes Kontingent, Vertretungen, Aufsichten (Soll, Ist, Mehraufsichten)
 *   - Pausenaufsichten: unbesetzt im Regelplan und im Zeitraum
 *   - weiche Regeln mit Einzelposten
 * ========================================================================== */
const Bericht = (() => {
  'use strict';

  /**
   * @param {object} z Zustand
   * @param {string} von  ISO-Datum (Beginn des Auswertungszeitraums)
   * @param {string} bis  ISO-Datum (Ende)
   */
  function erstelle(z, von, bis) {
    const ix = Index.erstelle(z);
    const n = ix.name;
    const bewertung = Kosten.bewerte(z);
    const verstoesse = Regeln.pruefeHart(z);

    // Ausfall im Regelplan je Klasse und Fach (Stundentafel gegen Plan)
    const imPlan = new Map();
    for (const s of z.plan.regelplan) if (s.fach && Index.STATUS.abgedeckt(s)) imPlan.set(s.klasse + '|' + s.fach, (imPlan.get(s.klasse + '|' + s.fach) || 0) + 1);
    const ausfallRegel = [];
    for (const k of z.klassen) {
      for (const e of k.stundentafel) {
        const ist = imPlan.get(k.id + '|' + e.fach) || 0;
        if (ist < e.stunden) ausfallRegel.push({ klasse: k.id, fach: e.fach, soll: e.stunden, ist, ausfall: e.stunden - ist });
      }
    }

    // Vertretungen im Zeitraum
    const imZeitraum = (d) => d >= von && d <= bis;
    const faelle = z.plan.vertretungen.filter((v) => imZeitraum(v.datum));
    const nachStatus = {};
    for (const v of faelle) nachStatus[v.status] = (nachStatus[v.status] || 0) + 1;
    const ausfallZeitraum = new Map();
    for (const v of faelle) {
      if (v.status !== 'entfaellt' && v.status !== 'aufsicht') continue;
      const fach = v.fach ?? z.plan.regelplan.find((s) => s.klasse === v.klasse && s.tag === Hilfen.wochentag(v.datum) && s.stunde === v.stunde)?.fach ?? null;
      const k = v.klasse + '|' + fach;
      ausfallZeitraum.set(k, (ausfallZeitraum.get(k) || 0) + 1);
    }
    const ausfallStunden = (nachStatus.entfaellt || 0) + (nachStatus.aufsicht || 0);
    const offen = [];
    const tage = Hilfen.istIsoDatum(von) && Hilfen.istIsoDatum(bis) && von <= bis ? Hilfen.unterrichtstage(von, bis, z.zeitraster.tage) : [];
    for (const d of tage) offen.push(...Vertretung.betroffen(z, d));

    // Auslastung je Lehrkraft
    const stunden = Regeln.lehrkraftStunden(z.plan.regelplan);
    const aufsichtenRegel = new Map();
    for (const a of z.plan.aufsichten) aufsichtenRegel.set(a.lehrkraft, (aufsichtenRegel.get(a.lehrkraft) || 0) + 1);
    const vertretungenJe = new Map();
    for (const v of faelle) {
      if (!['vertreten', 'doppeltBetreut', 'aufsicht'].includes(v.status)) continue;
      const l = v.lehrkraefte?.[0];
      if (l) vertretungenJe.set(l, (vertretungenJe.get(l) || 0) + 1);
    }
    const mehrAufsichten = new Map();
    for (const a of z.plan.aufsichtsVertretungen) if (imZeitraum(a.datum) && a.status === 'vertreten' && a.lehrkraft) mehrAufsichten.set(a.lehrkraft, (mehrAufsichten.get(a.lehrkraft) || 0) + 1);
    const auslastung = z.lehrkraefte.map((l) => {
      const info = stunden.get(l.id);
      const gesamt = info?.slots.size || 0;
      const zweit = info?.zweit.size || 0;
      const reserve = ix.reserve(l);
      return {
        lehrkraft: l.id, kuerzel: l.kuerzel, name: l.name, soll: l.sollStunden, min: l.minStunden, max: l.maxStunden, reserve,
        haupt: gesamt - zweit, zweit, gesamt, ungenutzt: Math.max(0, Math.min(l.sollStunden - reserve, l.maxStunden) - gesamt),
        vertretungen: vertretungenJe.get(l.id) || 0,
        aufsichtenSoll: l.aufsichtenProWoche, aufsichtenIst: aufsichtenRegel.get(l.id) || 0, mehrAufsichten: mehrAufsichten.get(l.id) || 0,
      };
    });

    // Aufsichten
    const unbesetztRegel = bewertung.ziele.K1A.posten.map((p) => ({ text: p.text, anzahl: p.menge }));
    const unbesetztZeitraum = z.plan.aufsichtsVertretungen.filter((a) => imZeitraum(a.datum) && a.status === 'unbesetzt')
      .map((a) => ({ datum: a.datum, vorStunde: a.vorStunde, fuer: a.fuer, text: `${a.datum} ${n.pause(Hilfen.wochentag(a.datum), a.vorStunde)} (für ${n.lehrkraft(a.fuer)})` }));

    return {
      zeitraum: { von, bis, unterrichtstage: tage.length },
      regelplan: {
        vektor: bewertung.vektor, ziele: bewertung.ziele, weich: bewertung.weich,
        verstoesse: verstoesse.length, verstoesseJeRegel: Regeln.zaehle(verstoesse),
        stunden: z.plan.regelplan.length, ausfall: ausfallRegel,
      },
      vertretung: {
        faelle: faelle.length, nachStatus, ausfallStunden,
        quote: faelle.length ? (faelle.length - ausfallStunden) / faelle.length : null,
        ausfall: [...ausfallZeitraum].map(([k, anzahl]) => { const [klasse, fach] = k.split('|'); return { klasse, fach: fach === 'null' ? null : fach, anzahl }; })
          .sort((a, b) => b.anzahl - a.anzahl || a.klasse.localeCompare(b.klasse)),
        offen: offen.length, offeneFaelle: offen,
      },
      auslastung,
      aufsichten: { unbesetztRegel, unbesetztZeitraum },
    };
  }

  return { erstelle };
})();
