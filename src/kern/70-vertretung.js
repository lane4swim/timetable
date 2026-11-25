/* ==========================================================================
 * Modul Vertretung
 * Datumsgenaue Vertretungsplanung (Spezifikation §5):
 *   - tagesplan(z, datum): Regelplan des Wochentags + bestätigte Vertretungen
 *   - betroffen(z, datum): Stunden/Aufsichten mit abwesender Lehrkraft bzw.
 *     nicht verfügbarem Raum
 *   - vorschlaege(z, von, bis): je betroffener Stunde die günstigste Lösung
 *     nach der Eskalationskette, dazu Alternativen. Die Stufen werden in
 *     fester Reihenfolge versucht; die erste Stufe mit einer zulässigen Lösung
 *     gewinnt, innerhalb der Stufe entscheidet der Kostenvektor (§3).
 *     „Zulässig“ heißt: die Lösung erzeugt in keinem betroffenen Tagesplan
 *     einen neuen Verstoß gegen harte Regeln und hält die Höchststunden ein.
 *   - uebernehmen(z, vorschlag): trägt die Einträge in plan.vertretungen bzw.
 *     plan.aufsichtsVertretungen ein (Bestätigung durch die Nutzerin, §5)
 * Der Regelplan wird nie verändert.
 * ========================================================================== */
const Vertretung = (() => {
  'use strict';

  /** Stufen der Eskalationskette je Art des Ausfalls. */
  const STUFEN = {
    lehrkraft: {
      0: 'Zweitbesetzung entfällt', 1: 'Zweitbesetzung rückt auf', 2: 'Umplanen in der Woche',
      3: 'Vertretung durch Lehrkraft der Klasse', 4: 'Vertretung durch andere Lehrkraft', 5: 'Doppelbetreuung',
      6: 'Aufteilung der Klasse', 7: 'Entfall, Nachrücken oder Aufsicht',
    },
    raum: { 1: 'Ersatzraum', 2: 'Umplanen in der Woche', 6: 'Aufteilung der Klasse', 7: 'Entfall, Nachrücken oder Aufsicht' },
    aufsicht: { 1: 'Aufsicht mit angrenzendem Unterricht', 2: 'Aufsicht durch anwesende Lehrkraft', 7: 'Aufsicht bleibt unbesetzt' },
  };

  const S = Index.schluessel;
  const kopie = (x) => JSON.parse(JSON.stringify(x));

  /* ------------------------------ Tagesplan ---------------------------- */

  /** Tagesplan eines Datums: Regelplan des Wochentags, überlagert von bestätigten Vertretungen. */
  function tagesplan(z, datum) {
    const tag = Hilfen.wochentag(datum);
    const je = new Map();
    for (const s of z.plan.regelplan) {
      if (s.tag === tag) je.set(S(s.klasse, s.stunde), { ...kopie(s), quelle: 'regel' });
    }
    for (const v of z.plan.vertretungen) {
      if (v.datum !== datum) continue;
      const alt = je.get(S(v.klasse, v.stunde));
      const e = { klasse: v.klasse, fach: v.fach ?? alt?.fach ?? null, lehrkraefte: v.lehrkraefte || [], raum: v.raum ?? null, tag, stunde: v.stunde, status: v.status, quelle: 'vertretung', grund: v.grund };
      if (v.mitKlasse) e.mitKlasse = v.mitKlasse;
      if (v.verteilung) e.verteilung = v.verteilung;
      je.set(S(v.klasse, v.stunde), e);
    }
    const aufsichten = z.plan.aufsichten.filter((a) => a.tag === tag).map((a) => ({ ...a }));
    for (const av of z.plan.aufsichtsVertretungen) {
      if (av.datum !== datum) continue;
      const i = aufsichten.findIndex((a) => a.vorStunde === av.vorStunde && a.lehrkraft === av.fuer);
      if (i >= 0) aufsichten.splice(i, 1);
      if (av.status === 'vertreten' && av.lehrkraft) aufsichten.push({ tag, vorStunde: av.vorStunde, lehrkraft: av.lehrkraft, quelle: 'vertretung' });
    }
    const stunden = [...je.values()].sort((a, b) => a.stunde - b.stunde || a.klasse.localeCompare(b.klasse));
    return { stunden, aufsichten };
  }

  const abwesend = (e, datum) => (e?.abwesenheiten || []).some((a) => a.von <= datum && datum <= a.bis);

  /** Betroffene Stunden und Aufsichten eines Datums (nach Stunde sortiert). */
  function betroffen(z, datum, tp = tagesplan(z, datum)) {
    const L = new Map(z.lehrkraefte.map((l) => [l.id, l]));
    const R = new Map(z.raeume.map((r) => [r.id, r]));
    const liste = [];
    for (const s of tp.stunden) {
      if (!Index.STATUS.belegt(s)) continue;
      const [haupt, zweit] = s.lehrkraefte;
      if (haupt && abwesend(L.get(haupt), datum)) liste.push({ art: 'lehrkraft', datum, klasse: s.klasse, stunde: s.stunde, lehrkraft: haupt });
      else if (zweit && abwesend(L.get(zweit), datum)) liste.push({ art: 'zweit', datum, klasse: s.klasse, stunde: s.stunde, lehrkraft: zweit });
      else if (s.raum && Index.STATUS.mitRaum(s) && abwesend(R.get(s.raum), datum)) liste.push({ art: 'raum', datum, klasse: s.klasse, stunde: s.stunde, raum: s.raum });
    }
    for (const a of tp.aufsichten) {
      if (abwesend(L.get(a.lehrkraft), datum)) liste.push({ art: 'aufsicht', datum, vorStunde: a.vorStunde, lehrkraft: a.lehrkraft });
    }
    return liste.sort((a, b) => (a.stunde ?? a.vorStunde - 0.5) - (b.stunde ?? b.vorStunde - 0.5));
  }

  /* ------------------------------ Kontext ------------------------------ */

  /** Arbeitskontext für ein Datum (wird nach jeder übernommenen Lösung neu gebildet). */
  function kontext(z, datum) {
    const ix = Index.erstelle(z);
    const tag = Hilfen.wochentag(datum);
    const tp = tagesplan(z, datum);
    const montag = Hilfen.wochenbeginn(datum);
    const wochentage = Array.from({ length: 7 }, (_, i) => Hilfen.plusTage(montag, i)).filter((d) => ix.tage.includes(Hilfen.wochentag(d)));
    // Wochenstunden je Lehrkraft (Tagespläne der ganzen Woche, inkl. bestätigter Vertretungen)
    const woche = new Map();
    const aufsichtenWoche = new Map();
    for (const d of wochentage) {
      const t = d === datum ? tp : tagesplan(z, d);
      for (const [l, info] of Regeln.lehrkraftStunden(t.stunden)) woche.set(l, (woche.get(l) || 0) + info.slots.size);
      for (const a of t.aufsichten) aufsichtenWoche.set(a.lehrkraft, (aufsichtenWoche.get(a.lehrkraft) || 0) + 1);
    }
    const belegtIm = (l, stunde) => tp.stunden.filter((s) => s.stunde === stunde && Index.STATUS.belegt(s) && s.lehrkraefte.includes(l));
    const frei = (l, stunde) => !abwesend(ix.lehrkraefte.get(l), datum) && !ix.lehrkraftGesperrt(l, tag, stunde) && !belegtIm(l, stunde).length;
    const stundenAmTag = (l) => new Set(tp.stunden.filter((s) => Index.STATUS.belegt(s) && s.lehrkraefte.includes(l)).map((s) => s.stunde));
    const reserveFrei = (l) => (woche.get(l) || 0) + 1 <= ix.lehrkraefte.get(l).maxStunden;
    return { z, ix, datum, tag, tp, wochentage, woche, aufsichtenWoche, belegtIm, frei, stundenAmTag, reserveFrei };
  }

  /* ------------------------- Bewertung von Lösungen --------------------- */

  /** Wendet eine Lösung auf eine Kopie an. */
  function mitLoesung(z, loesung) {
    const neu = kopie(z);
    eintragen(neu, loesung);
    return neu;
  }

  /** Trägt Einträge ein; gleiche Schlüssel (Datum, Klasse, Stunde bzw. Datum, Pause, Lehrkraft) werden ersetzt. */
  function eintragen(z, loesung) {
    for (const e of loesung.eintraege || []) {
      z.plan.vertretungen = z.plan.vertretungen.filter((v) => !(v.datum === e.datum && v.klasse === e.klasse && v.stunde === e.stunde));
      z.plan.vertretungen.push(e);
    }
    for (const e of loesung.aufsichtsEintraege || []) {
      z.plan.aufsichtsVertretungen = z.plan.aufsichtsVertretungen.filter((v) => !(v.datum === e.datum && v.vorStunde === e.vorStunde && v.fuer === e.fuer));
      z.plan.aufsichtsVertretungen.push(e);
    }
    const ordnung = (a, b) => a.datum.localeCompare(b.datum) || (a.stunde ?? a.vorStunde) - (b.stunde ?? b.vorStunde) || String(a.klasse ?? a.fuer).localeCompare(String(b.klasse ?? b.fuer));
    z.plan.vertretungen.sort(ordnung);
    z.plan.aufsichtsVertretungen.sort(ordnung);
  }

  const verstossSchluessel = (v) => v.regel + '|' + v.text;

  /**
   * Prüft eine Lösung: keine neuen Verstöße an den betroffenen Daten,
   * Höchststunden der Woche eingehalten. Liefert den Kostenvektor oder null.
   */
  function pruefe(z, loesung, vorherVerstoesse) {
    const neu = mitLoesung(z, loesung);
    const daten = [...new Set([...(loesung.eintraege || []), ...(loesung.aufsichtsEintraege || [])].map((e) => e.datum))];
    let vektor = null;
    for (const d of daten) {
      const tp = tagesplan(neu, d);
      const vorher = vorherVerstoesse(d);
      // Aufsichten abwesender Lehrkräfte werden ohnehin noch vertreten – ihre H13-Meldungen blockieren nicht
      const offeneAufsicht = (v) => v.regel === 'H13' && v.aufsichten.length
        && v.aufsichten.every((i) => abwesend(neu.lehrkraefte.find((l) => l.id === tp.aufsichten[i]?.lehrkraft), d));
      const nachher = Regeln.pruefeHart(neu, tp, { datum: d }).filter((v) => !offeneAufsicht(v));
      const zaehler = new Map();
      for (const v of vorher) zaehler.set(verstossSchluessel(v), (zaehler.get(verstossSchluessel(v)) || 0) + 1);
      for (const v of nachher) {
        const k = verstossSchluessel(v);
        if (!zaehler.get(k)) return null; // neuer Verstoß
        zaehler.set(k, zaehler.get(k) - 1);
      }
      const b = Kosten.bewerte(neu, tp, { datum: d, mitPosten: false }).vektor;
      vektor = vektor ? vektor.map((x, i) => x + b[i]) : b;
    }
    // Höchststunden der Woche (H7) für alle beteiligten Lehrkräfte
    const ix = Index.erstelle(neu);
    for (const e of loesung.eintraege || []) {
      for (const l of e.lehrkraefte || []) {
        const ctx = kontext(neu, e.datum);
        if ((ctx.woche.get(l) || 0) > ix.lehrkraefte.get(l).maxStunden) return null;
      }
    }
    return vektor || [0, 0, 0, 0, 0, 0, 0];
  }

  /* ------------------------------ Kandidaten --------------------------- */

  function eintrag(ctx, s, aenderung) {
    const e = { datum: ctx.datum, klasse: s.klasse, fach: s.fach, stunde: s.stunde, status: s.status, lehrkraefte: s.lehrkraefte.slice(), raum: s.raum, ...aenderung };
    for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
    return e;
  }

  /** Lösungskandidaten für eine Stunde mit abwesender Hauptlehrkraft (Stufen 1–7). */
  function kandidatenLehrkraft(ctx, s, abw) {
    const { ix, z } = ctx;
    const n = ix.name;
    const k = ix.klassen.get(s.klasse);
    const wo = `${n.klasse(s.klasse)} ${ctx.datum} ${s.stunde}. Stunde ${n.fach(s.fach)}`;
    const liste = [];
    const zweit = s.lehrkraefte[1];

    // Stufe 1: Zweitbesetzung rückt auf
    if (zweit && !abwesend(ix.lehrkraefte.get(zweit), ctx.datum)) {
      liste.push({ stufe: 1, text: `${n.lehrkraft(zweit)} (Zweitbesetzung) übernimmt; Raum und Zeit bleiben`, eintraege: [eintrag(ctx, s, { lehrkraefte: [zweit], status: 'vertreten', grund: 'zweitbesetzungRueckt' })] });
    }

    // Stufe 2: Umplanen – Tausch mit einer Stunde derselben Klasse an einem anderen Tag der Woche
    for (const d2 of ctx.wochentage) {
      if (d2 === ctx.datum || abwesend(ix.lehrkraefte.get(abw), d2)) continue;
      const tp2 = tagesplan(z, d2);
      for (const m of tp2.stunden) {
        if (m.klasse !== s.klasse || m.status !== 'regulaer' || m.quelle !== 'regel' || m.lehrkraefte.includes(abw)) continue;
        if (m.lehrkraefte.some((l) => abwesend(ix.lehrkraefte.get(l), ctx.datum))) continue;
        liste.push({
          stufe: 2,
          text: `Tausch mit ${n.fach(m.fach)} (${m.lehrkraefte.map(n.lehrkraft).join(', ')}) vom ${d2} ${m.stunde}. Stunde; ${n.lehrkraft(abw)} unterrichtet ${n.fach(s.fach)} dann am ${d2}`,
          eintraege: [
            eintrag(ctx, s, { fach: m.fach, lehrkraefte: m.lehrkraefte.slice(), raum: m.raum, status: 'regulaer', grund: 'umgeplant' }),
            { datum: d2, klasse: s.klasse, fach: s.fach, stunde: m.stunde, status: 'regulaer', lehrkraefte: [abw], raum: s.raum, grund: 'umgeplant' },
          ],
        });
      }
    }

    // Stufen 3 und 4: freie Lehrkräfte
    const eigene = new Set([k.klassenlehrkraft, ...(ix.lehrkraefteDerKlasse.get(s.klasse) || [])].filter(Boolean));
    const springer = new Set(Bearbeitung.freieKontingente(z).map((x) => x.lehrkraft));
    const angrenzend = (l) => { const st = ctx.stundenAmTag(l); return st.has(s.stunde - 1) || st.has(s.stunde + 1); };
    const kandidaten = [];
    for (const l of z.lehrkraefte) {
      if (l.id === abw || !ctx.reserveFrei(l.id)) continue;
      const qual = ix.istQualifiziert(l.id, s.fach, k.stufe);
      if (ctx.frei(l.id, s.stunde)) {
        const stufe = eigene.has(l.id) ? 3 : 4;
        const art = stufe === 3 ? (l.id === k.klassenlehrkraft ? 'Klassenlehrkraft' : 'Lehrkraft der Klasse') : qual ? (springer.has(l.id) ? 'Springerpool' : 'freie qualifizierte Lehrkraft') : 'Notfalleinsatz ohne Fachqualifikation';
        const rang = stufe === 3 ? (qual ? 0 : 1) : qual ? (springer.has(l.id) ? 0 : 1) : 3;
        kandidaten.push({ l, stufe, rang, art, qual });
      } else if (!abwesend(l, ctx.datum) && !ix.lehrkraftGesperrt(l.id, ctx.tag, s.stunde)) {
        // nur Zweitbesetzung im Slot → abziehen (Stufe 4)
        const dort = ctx.belegtIm(l.id, s.stunde);
        // (qualifiziert vor Notfalleinsatz; fachfremd nur, wenn niemand anderes frei ist)
        if (dort.length === 1 && dort[0].lehrkraefte[1] === l.id && dort[0].lehrkraefte[0] !== l.id) {
          kandidaten.push({ l, stufe: 4, rang: qual ? 2 : 4, art: `Zweitbesetzung in ${n.klasse(dort[0].klasse)} wird abgezogen${qual ? '' : ', Notfalleinsatz ohne Fachqualifikation'}`, qual, abzug: dort[0] });
        }
      }
    }
    kandidaten.sort((a, b) => a.stufe - b.stufe || a.rang - b.rang || angrenzend(b.l.id) - angrenzend(a.l.id) || (ctx.woche.get(a.l.id) || 0) - (ctx.woche.get(b.l.id) || 0) || a.l.id.localeCompare(b.l.id));
    const proStufe = { 3: 0, 4: 0 };
    for (const c of kandidaten) {
      if (proStufe[c.stufe]++ >= 8) continue; // je Stufe die aussichtsreichsten prüfen
      const eintraege = [eintrag(ctx, s, { lehrkraefte: [c.l.id], status: 'vertreten', grund: c.stufe === 3 ? 'vertretungEigeneLehrkraft' : c.abzug ? 'zweitbesetzungAbgezogen' : c.qual ? 'vertretungQualifiziert' : 'notfalleinsatz' })];
      if (c.abzug) eintraege.push(eintrag(ctx, c.abzug, { lehrkraefte: [c.abzug.lehrkraefte[0]], grund: 'zweitbesetzungAbgezogen' }));
      liste.push({ stufe: c.stufe, text: `${n.lehrkraft(c.l.id)} vertritt (${c.art}${c.qual || c.stufe === 4 ? '' : ', fachfremd'})`, eintraege, rang: c.rang });
      if (c.abzug && !c.qual) eintraege[0].grund = 'notfalleinsatz';
    }

    // Stufe 5: Doppelbetreuung durch eine Lehrkraft, die im Slot eine andere Klasse unterrichtet
    const raumVon = (id) => ix.raeume.get(id);
    const partner = ctx.tp.stunden
      .filter((p) => p.stunde === s.stunde && p.klasse !== s.klasse && Index.STATUS.fachunterricht(p) && p.lehrkraefte.length === 1 && p.raum)
      .map((p) => ({ p, k2: ix.klassen.get(p.klasse) }))
      // bevorzugt Parallelklassen derselben Stufe im Klassenraum
      .sort((a, b) => (raumVon(a.p.raum)?.typ !== 'klassenraum') - (raumVon(b.p.raum)?.typ !== 'klassenraum') || Math.abs(a.k2.stufe - k.stufe) - Math.abs(b.k2.stufe - k.stufe));
    let zahl5 = 0;
    for (const { p, k2 } of partner) {
      if (zahl5 >= 6) break;
      const t = p.lehrkraefte[0];
      if (abwesend(ix.lehrkraefte.get(t), ctx.datum)) continue;
      const r2 = raumVon(p.raum);
      const eigenerRaum = s.raum && raumVon(s.raum);
      let raum = null;
      if (r2 && r2.kapazitaet >= k.schueler + k2.schueler) raum = p.raum;
      else if (eigenerRaum && eigenerRaum.typ === 'klassenraum' && (r2?.nahe || []).includes(s.raum)) raum = s.raum;
      if (!raum) continue;
      zahl5++;
      liste.push({
        stufe: 5,
        text: `${n.lehrkraft(t)} betreut zusätzlich zu ${n.klasse(p.klasse)} (${raum === p.raum ? 'gemeinsam in ' + n.raum(raum) : 'Räume nebeneinander'})`,
        eintraege: [eintrag(ctx, s, { lehrkraefte: [t], raum, status: 'doppeltBetreut', mitKlasse: p.klasse, grund: 'doppelbetreuung' })],
      });
    }

    liste.push(...kandidatenAufteilung(ctx, s), ...kandidatenEntfall(ctx, s, abw));
    return liste.map((c) => ({ ...c, wo }));
  }

  /** Stufe 6: Aufteilung auf Klassen, die im Slot Unterricht haben (Kapazität, H6). */
  function kandidatenAufteilung(ctx, s) {
    const { ix } = ctx;
    const n = ix.name;
    const k = ix.klassen.get(s.klasse);
    const gaeste = new Map();
    for (const x of ctx.tp.stunden) {
      if (x.stunde !== s.stunde || x.status !== 'aufgeteilt') continue;
      for (const v of x.verteilung || []) gaeste.set(v.zielKlasse, (gaeste.get(v.zielKlasse) || 0) + v.anzahl);
    }
    const ziele = ctx.tp.stunden
      .filter((x) => x.stunde === s.stunde && x.klasse !== s.klasse && Index.STATUS.mitRaum(x) && x.raum && x.status !== 'aufgeteilt')
      .map((x) => {
        const k2 = ix.klassen.get(x.klasse);
        const raum = ix.raeume.get(x.raum);
        const belegt = ctx.tp.stunden.filter((y) => y.stunde === s.stunde && y.raum === x.raum && Index.STATUS.mitRaum(y)).reduce((sum, y) => sum + (ix.klassen.get(y.klasse)?.schueler || 0), 0);
        return { klasse: x.klasse, frei: (raum?.kapazitaet || 0) - belegt - (gaeste.get(x.klasse) || 0), abstand: Math.abs(k2.stufe - k.stufe) };
      })
      .filter((x) => x.frei > 0)
      .sort((a, b) => a.abstand - b.abstand || b.frei - a.frei || a.klasse.localeCompare(b.klasse));
    // möglichst wenige Zielklassen, gleichmäßig verteilt (Wasserstand)
    for (let anzahl = 1; anzahl <= ziele.length; anzahl++) {
      const auswahl = ziele.slice(0, anzahl);
      if (auswahl.reduce((sum, x) => sum + x.frei, 0) < k.schueler) continue;
      const verteilung = auswahl.map((x) => ({ zielKlasse: x.klasse, anzahl: 0, frei: x.frei }));
      let rest = k.schueler;
      while (rest > 0) {
        const offen = verteilung.filter((v) => v.anzahl < v.frei).sort((a, b) => a.anzahl - b.anzahl);
        offen[0].anzahl++;
        rest--;
      }
      const gruppen = verteilung.map((v, i) => ({ zielKlasse: v.zielKlasse, anzahl: v.anzahl, gruppe: String.fromCharCode(65 + i) }));
      return [{
        stufe: 6,
        text: `Aufteilung: ${gruppen.map((g) => `Gruppe ${g.gruppe} → ${n.klasse(g.zielKlasse)}: ${g.anzahl} Schüler:innen`).join('; ')}`,
        eintraege: [eintrag(ctx, s, { lehrkraefte: [], raum: null, status: 'aufgeteilt', verteilung: gruppen, grund: 'aufteilung' })],
      }];
    }
    return [];
  }

  /** Stufe 7: Entfall am Tagesrand, Nachrücken der folgenden Stunden oder Aufsicht. */
  function kandidatenEntfall(ctx, s, abw) {
    const { ix, z } = ctx;
    const n = ix.name;
    const tagesStunden = ctx.tp.stunden.filter((x) => x.klasse === s.klasse && Index.STATUS.belegt(x)).sort((a, b) => a.stunde - b.stunde);
    const erste = tagesStunden[0]?.stunde;
    const letzte = tagesStunden[tagesStunden.length - 1]?.stunde;
    const liste = [];
    const entfall = (x, grund) => eintrag(ctx, x, { lehrkraefte: [], raum: null, status: 'entfaellt', grund });
    if (s.stunde === erste || s.stunde === letzte) {
      liste.push({ stufe: 7, rang: 0, text: s.stunde === erste ? 'Entfall: späterer Unterrichtsbeginn' : 'Entfall: früherer Unterrichtsschluss', eintraege: [entfall(s, 'entfallRand')] });
      return liste;
    }
    // Nachrücken: alle folgenden Stunden eine Stunde nach vorn, die letzte entfällt
    const folgende = tagesStunden.filter((x) => x.stunde > s.stunde);
    const eintraege = [];
    let vorher = s.stunde;
    for (const x of folgende) {
      eintraege.push(eintrag(ctx, { ...x, stunde: vorher }, { fach: x.fach, lehrkraefte: x.lehrkraefte.filter((l) => l !== abw), raum: x.raum, status: x.status === 'regulaer' ? 'regulaer' : x.status, grund: 'nachgerueckt' }));
      vorher = x.stunde;
    }
    eintraege.push(entfall({ ...s, stunde: letzte }, 'nachgerueckt')); // es entfällt das Fach der ausgefallenen Stunde
    if (eintraege.every((e) => e.status === 'entfaellt' || e.lehrkraefte.length)) {
      liste.push({ stufe: 7, rang: 1, text: `Nachrücken: die folgenden ${folgende.length} Stunde(n) rücken vor, Unterrichtsschluss eine Stunde früher (${n.fach(s.fach)} entfällt)`, eintraege });
    }
    // Aufsicht durch eine freie Lehrkraft (zählt als Ausfall)
    const raum = s.raum && ix.raeume.get(s.raum)?.typ === 'klassenraum' ? s.raum : ix.klassen.get(s.klasse).heimatraum;
    const frei = z.lehrkraefte.filter((l) => l.id !== abw && ctx.frei(l.id, s.stunde) && ctx.reserveFrei(l.id))
      .sort((a, b) => {
        const nah = (l) => { const st = ctx.stundenAmTag(l.id); return st.has(s.stunde - 1) || st.has(s.stunde + 1) ? 0 : 1; };
        return nah(a) - nah(b) || (ctx.woche.get(a.id) || 0) - (ctx.woche.get(b.id) || 0) || a.id.localeCompare(b.id);
      }).slice(0, 4);
    for (const l of frei) {
      liste.push({ stufe: 7, rang: 2, text: `Aufsicht durch ${n.lehrkraft(l.id)} (ohne Fachunterricht)`, eintraege: [eintrag(ctx, s, { lehrkraefte: [l.id], raum, status: 'aufsicht', grund: 'aufsicht' })] });
    }
    return liste;
  }

  /** Lösungskandidaten bei Raumausfall. */
  function kandidatenRaum(ctx, s) {
    const { ix, z } = ctx;
    const n = ix.name;
    const k = ix.klassen.get(s.klasse);
    const liste = [];
    const typ = ix.faecher.get(s.fach)?.raumtyp || null;
    const belegt = new Set(ctx.tp.stunden.filter((x) => x.stunde === s.stunde && x.raum && Index.STATUS.mitRaum(x)).map((x) => x.raum));
    const passend = z.raeume.filter((r) => !belegt.has(r.id) && r.kapazitaet >= k.schueler && !abwesend(r, ctx.datum) && !ix.raumGesperrt(r.id, ctx.tag, s.stunde)
      && (typ ? ix.raumPasst(r.id, s.fach) : r.typ === 'klassenraum'))
      .sort((a, b) => ((ix.raeume.get(s.raum)?.nahe || []).includes(b.id) - (ix.raeume.get(s.raum)?.nahe || []).includes(a.id)) || a.kapazitaet - b.kapazitaet);
    for (const r of passend.slice(0, 6)) {
      liste.push({ stufe: 1, text: `Ersatzraum ${n.raum(r.id)} (${r.kapazitaet} Plätze)`, eintraege: [eintrag(ctx, s, { raum: r.id, grund: 'raumausfall' })] });
    }
    liste.push(...kandidatenAufteilung(ctx, s), ...kandidatenEntfall(ctx, s, null).filter((c) => c.rang !== 2));
    return liste.map((c) => ({ ...c, wo: `${n.klasse(s.klasse)} ${ctx.datum} ${s.stunde}. Stunde ${n.fach(s.fach)}` }));
  }

  /** Lösungskandidaten für eine Aufsicht der abwesenden Lehrkraft. */
  function kandidatenAufsicht(ctx, a) {
    const { ix, z } = ctx;
    const n = ix.name;
    const erste = a.vorStunde === ix.stunden[0];
    const angrenzendeStunden = erste ? [a.vorStunde] : [a.vorStunde - 1, a.vorStunde];
    const schonDa = new Set(ctx.tp.aufsichten.filter((x) => x.vorStunde === a.vorStunde).map((x) => x.lehrkraft));
    const liste = [];
    const kandidaten = z.lehrkraefte.filter((l) => l.id !== a.lehrkraft && !schonDa.has(l.id) && !abwesend(l, ctx.datum)
      && ctx.stundenAmTag(l.id).size > 0 && !angrenzendeStunden.some((st) => ix.lehrkraftGesperrt(l.id, ctx.tag, st)))
      .map((l) => ({ l, nah: angrenzendeStunden.some((st) => ctx.stundenAmTag(l.id).has(st)) }))
      .sort((x, y) => y.nah - x.nah || (ctx.aufsichtenWoche.get(x.l.id) || 0) - (ctx.aufsichtenWoche.get(y.l.id) || 0) || x.l.id.localeCompare(y.l.id))
      .slice(0, 6);
    for (const { l, nah } of kandidaten) {
      liste.push({
        stufe: nah ? 1 : 2,
        text: `${n.lehrkraft(l.id)} übernimmt die Aufsicht (${nah ? 'hat direkt davor/danach Unterricht' : 'am Tag anwesend'}; ${ctx.aufsichtenWoche.get(l.id) || 0} Aufsichten in dieser Woche)`,
        aufsichtsEintraege: [{ datum: ctx.datum, vorStunde: a.vorStunde, fuer: a.lehrkraft, lehrkraft: l.id, status: 'vertreten' }],
      });
    }
    liste.push({ stufe: 7, text: 'Aufsicht bleibt unbesetzt (keine anwesende Lehrkraft frei)', aufsichtsEintraege: [{ datum: ctx.datum, vorStunde: a.vorStunde, fuer: a.lehrkraft, lehrkraft: null, status: 'unbesetzt' }] });
    return liste.map((c) => ({ ...c, wo: n.pause(ctx.tag, a.vorStunde) + ' am ' + ctx.datum }));
  }

  /* ------------------------------ Vorschläge --------------------------- */

  /**
   * Berechnet Vorschläge für alle betroffenen Stunden und Aufsichten im Zeitraum.
   * Die Vorschläge werden der Reihe nach (Datum, Stunde) auf einer Arbeitskopie
   * angewandt, damit spätere Vorschläge frühere berücksichtigen.
   * @param {{ausgeschlossen?: Set<string>, maxAlternativen?: number}} [optionen]
   *        ausgeschlossen: Schlüssel verworfener Vorschläge (werden übersprungen)
   * @returns {object[]} Vorschläge mit { schluessel, art, datum, stufe, stufeText, text, eintraege, aufsichtsEintraege, vektor, alternativen }
   */
  function vorschlaege(z, von, bis, optionen = {}) {
    const ausgeschlossen = optionen.ausgeschlossen || new Set();
    const maxAlt = optionen.maxAlternativen ?? 6;
    let arbeit = kopie(z);
    const ergebnis = [];
    for (const datum of Hilfen.unterrichtstage(von, bis, z.zeitraster.tage)) {
      const erledigt = new Set();
      for (let schutz = 0; schutz < 500; schutz++) {
        const offen = betroffen(arbeit, datum).filter((b) => !erledigt.has(schluesselVon(b)) && !ausgeschlossen.has(schluesselVon(b)));
        if (!offen.length) break;
        const b = offen[0];
        erledigt.add(schluesselVon(b));
        const v = loese(arbeit, b, maxAlt);
        if (!v) continue;
        ergebnis.push(v);
        arbeit = mitLoesung(arbeit, v);
      }
    }
    return ergebnis;
  }

  const schluesselVon = (b) => [b.datum, b.art, b.klasse ?? b.lehrkraft, b.stunde ?? b.vorStunde].join('|');

  /** Löst einen betroffenen Eintrag nach der Eskalationskette. */
  function loese(z, b, maxAlt = 6) {
    const ctx = kontext(z, b.datum);
    const vorherCache = new Map();
    const vorherVerstoesse = (d) => {
      if (!vorherCache.has(d)) vorherCache.set(d, Regeln.pruefeHart(z, tagesplan(z, d), { datum: d }));
      return vorherCache.get(d);
    };
    let kandidaten;
    let art = b.art;
    if (b.art === 'aufsicht') {
      kandidaten = kandidatenAufsicht(ctx, b);
    } else {
      const s = ctx.tp.stunden.find((x) => x.klasse === b.klasse && x.stunde === b.stunde);
      if (!s) return null;
      if (b.art === 'zweit') {
        kandidaten = [{ stufe: 0, text: `Zweitbesetzung ${ctx.ix.name.lehrkraft(b.lehrkraft)} entfällt; ${ctx.ix.name.lehrkraft(s.lehrkraefte[0])} unterrichtet allein`, eintraege: [eintrag(ctx, s, { lehrkraefte: [s.lehrkraefte[0]], grund: 'zweitbesetzungAbwesend' })], wo: `${ctx.ix.name.klasse(s.klasse)} ${b.datum} ${s.stunde}. Stunde` }];
        art = 'lehrkraft';
      } else if (b.art === 'raum') {
        kandidaten = kandidatenRaum(ctx, s);
      } else {
        kandidaten = kandidatenLehrkraft(ctx, s, b.lehrkraft);
        // „Nicht zweimal hintereinander aufteilen, wenn es eine Alternative gibt“: Aufteilung hinter Stufe 7 einordnen
        const nachbarAufgeteilt = ctx.tp.stunden.some((x) => x.klasse === s.klasse && Math.abs(x.stunde - s.stunde) === 1 && x.status === 'aufgeteilt');
        if (nachbarAufgeteilt) kandidaten = kandidaten.map((c) => (c.stufe === 6 ? { ...c, stufe: 6.5, text: c.text + ' (Klasse war bereits in der Nachbarstunde aufgeteilt)' } : c));
      }
    }
    // Bewerten: Stufe für Stufe; zulässige Kandidaten mit Kostenvektor
    const bewertet = [];
    for (const c of kandidaten) {
      const vektor = pruefe(z, c, vorherVerstoesse);
      if (vektor) bewertet.push({ ...c, vektor });
    }
    if (!bewertet.length) {
      // keine zulässige Lösung: Entfall (ggf. mit Verstoß) als letzte Möglichkeit anbieten
      const s = ctx.tp.stunden.find((x) => x.klasse === b.klasse && x.stunde === b.stunde);
      if (!s) return null;
      const notfall = { stufe: 8, text: 'Keine Lösung ohne Regelverstoß – Stunde entfällt (prüfen!)', eintraege: [eintrag(ctx, s, { lehrkraefte: [], raum: null, status: 'entfaellt', grund: 'keineLoesung' })], wo: `${ctx.ix.name.klasse(s.klasse)} ${b.datum} ${s.stunde}. Stunde` };
      bewertet.push({ ...notfall, vektor: null });
    }
    bewertet.sort((x, y) => x.stufe - y.stufe || (x.vektor && y.vektor ? Kosten.vergleiche(x.vektor, y.vektor) : 0) || (x.rang ?? 0) - (y.rang ?? 0));
    const [beste, ...rest] = bewertet;
    // Alternativen: weitere der gleichen Stufe und die besten späteren Stufen
    const alternativen = [];
    const stufenGesehen = new Set([beste.stufe]);
    for (const c of rest) {
      if (alternativen.length >= maxAlt) break;
      if (c.stufe === beste.stufe || !stufenGesehen.has(c.stufe) || alternativen.filter((x) => x.stufe === c.stufe).length < 2) {
        alternativen.push(c);
        stufenGesehen.add(c.stufe);
      }
    }
    const stufenText = (st) => STUFEN[art][Math.floor(st)] || (st === 8 ? 'Keine regelkonforme Lösung' : '');
    const form = (c) => ({
      stufe: Math.floor(c.stufe), stufeText: stufenText(c.stufe), text: c.text, vektor: c.vektor,
      eintraege: c.eintraege || [], aufsichtsEintraege: c.aufsichtsEintraege || [],
    });
    return {
      schluessel: schluesselVon(b), art: b.art, datum: b.datum, klasse: b.klasse, stunde: b.stunde, vorStunde: b.vorStunde,
      lehrkraft: b.lehrkraft, raum: b.raum, wo: beste.wo, ...form(beste), alternativen: alternativen.map(form),
    };
  }

  /** Übernimmt einen (bestätigten) Vorschlag in den Zustand. */
  function uebernehmen(z, vorschlag) {
    eintragen(z, vorschlag);
  }

  /** Ausfallbericht (§5 Stufe 7): Entfall und Aufsicht im Zeitraum, mit Grund. */
  function ausfallbericht(z, von, bis) {
    const ix = Index.erstelle(z);
    return z.plan.vertretungen
      .filter((v) => v.datum >= von && v.datum <= bis && (v.status === 'entfaellt' || v.status === 'aufsicht'))
      .map((v) => ({ datum: v.datum, klasse: ix.name.klasse(v.klasse), stunde: v.stunde, fach: ix.name.fach(v.fach), status: v.status, grund: GRUENDE[v.grund] || v.grund || '' }));
  }

  /** Lesbare Gründe (Feld „grund“ der Vertretungen). */
  const GRUENDE = {
    zweitbesetzungRueckt: 'Zweitbesetzung rückt auf', zweitbesetzungAbwesend: 'Zweitbesetzung abwesend', umgeplant: 'Umgeplant (Tausch in der Woche)',
    vertretungEigeneLehrkraft: 'Vertretung durch Lehrkraft der Klasse', vertretungQualifiziert: 'Vertretung durch qualifizierte Lehrkraft',
    zweitbesetzungAbgezogen: 'Zweitbesetzung für Vertretung abgezogen', notfalleinsatz: 'Notfalleinsatz (fachfremd)', doppelbetreuung: 'Doppelbetreuung',
    aufteilung: 'Aufteilung der Klasse', entfallRand: 'Entfall am Tagesrand', nachgerueckt: 'Folgende Stunden nachgerückt', aufsicht: 'Aufsicht statt Unterricht',
    raumausfall: 'Raumausfall – Ersatzraum', keineLoesung: 'Keine regelkonforme Lösung gefunden',
  };

  return { STUFEN, GRUENDE, tagesplan, betroffen, vorschlaege, loese, uebernehmen, ausfallbericht };
})();
