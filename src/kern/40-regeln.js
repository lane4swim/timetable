/* ==========================================================================
 * Modul Regeln
 * Prüft einen Plan gegen die harten Regeln H1–H14 (Spezifikation §4).
 * Jeder Verstoß nennt Regel, lesbaren Text und die betroffenen Einträge
 * (Indizes in stunden[] bzw. aufsichten[]), damit die Oberfläche sie markieren
 * und erklären kann.
 *
 * Geprüft werden zwei Arten von Plänen:
 *  - Wochenplan (Regelplan): alle Tage, Wochenregeln H7, H11, H14 aktiv
 *  - Tagesplan (Vertretung, `datum` gesetzt): ein Datum, Abwesenheiten aktiv;
 *    Wochengrenzen prüft die Vertretungsplanung mit dem Wochenkontext
 * ========================================================================== */
const Regeln = (() => {
  'use strict';

  /** Kurztitel der harten Regeln (für Anzeige und Bericht). */
  const TITEL = Object.freeze({
    H1: 'Lehrkraft höchstens einmal je Zeitslot (außer genehmigter Doppelbetreuung)',
    H2: 'Klasse höchstens eine Veranstaltung je Zeitslot',
    H3: 'Raum höchstens einmal je Zeitslot belegt',
    H4: 'Lehrkraft nicht gesperrt oder abwesend',
    H5: 'Raum nicht gesperrt, passender Raumtyp',
    H6: 'Raumkapazität reicht',
    H7: 'Wochenstunden höchstens Höchstgrenze',
    H8: 'reguläre Fachstunde nur durch qualifizierte Hauptlehrkraft',
    H9: 'nicht mehr Stunden als in der Stundentafel',
    H10: 'höchstens zulässige Zahl an Lehrkräften je Klasse und Zeitslot',
    H11: 'Zweitbesetzung wahrt die Vertretungsreserve',
    H12: 'keine Leerstunden für Klassen',
    H13: 'Pausenaufsicht nur durch anwesende Lehrkräfte',
    H14: 'Aufsichten höchstens Aufsichtssoll',
  });

  const S = Index.schluessel;

  /**
   * @param {object} z Zustand (gültig nach Schema)
   * @param {{stunden?: object[], aufsichten?: object[]}} [plan] Standard: Regelplan des Zustands
   * @param {{datum?: string}} [optionen] datum: Tagesplan für dieses Datum prüfen
   * @returns {{regel: string, text: string, stunden: number[], aufsichten: number[]}[]}
   */
  function pruefeHart(z, plan, optionen = {}) {
    const ix = Index.erstelle(z);
    const stunden = plan?.stunden ?? z.plan.regelplan;
    const aufsichten = plan?.aufsichten ?? z.plan.aufsichten;
    const datum = optionen.datum;
    const woche = !datum;
    const n = ix.name;
    const verstoesse = [];
    const melde = (regel, text, betroffen = {}) => verstoesse.push({
      regel, text, stunden: betroffen.stunden || [], aufsichten: betroffen.aufsichten || [],
    });

    /* ---------- Gruppierungen ---------- */
    const proSlot = gruppiere(stunden, (s) => S(s.tag, s.stunde));
    const proKlasseSlot = gruppiere(stunden, (s) => S(s.klasse, s.tag, s.stunde));
    const lehrerSlot = new Map(); // Lehrkraft|Tag|Stunde → Indizes
    stunden.forEach((s, i) => {
      for (const l of s.lehrkraefte || []) {
        const k = S(l, s.tag, s.stunde);
        if (!lehrerSlot.has(k)) lehrerSlot.set(k, []);
        lehrerSlot.get(k).push(i);
      }
    });
    const verknuepft = (a, b) => (a.mitKlasse === b.klasse || b.mitKlasse === a.klasse)
      && (a.status === 'doppeltBetreut' || b.status === 'doppeltBetreut');

    /* ---------- H1: Lehrkraft je Slot ---------- */
    for (const [k, idx] of lehrerSlot) {
      if (idx.length < 2) continue;
      const [l, tag, stunde] = k.split('|');
      const [a, b] = idx.map((i) => stunden[i]);
      const erlaubt = idx.length === 2 && verknuepft(a, b) && a.lehrkraefte[0] === l && b.lehrkraefte[0] === l;
      if (!erlaubt) {
        melde('H1', `${n.lehrkraft(l)} ist ${n.slot(tag, stunde)} Stunde in ${idx.length} Klassen eingeplant (${idx.map((i) => n.klasse(stunden[i].klasse)).join(', ')})`, { stunden: idx });
      }
    }
    // Doppelbetreuung: Partnerklasse vorhanden, Grenzen je Tag
    const db = new Map(); // Lehrkraft|Tag → Stunden
    stunden.forEach((s, i) => {
      if (s.status !== 'doppeltBetreut') return;
      const l = s.lehrkraefte?.[0];
      const partner = (proKlasseSlot.get(S(s.mitKlasse, s.tag, s.stunde)) || []).map((j) => stunden[j]);
      if (!partner.some((p) => p.lehrkraefte?.includes(l))) {
        melde('H1', `Doppelbetreuung ${n.slot(s.tag, s.stunde)} Stunde: ${n.klasse(s.mitKlasse)} wird in diesem Slot nicht von ${n.lehrkraft(l)} betreut`, { stunden: [i] });
      }
      if (!l) return;
      const k = S(l, s.tag);
      if (!db.has(k)) db.set(k, new Map());
      db.get(k).set(s.stunde, [...(db.get(k).get(s.stunde) || []), i]);
    });
    const maxProTag = ix.einstellungen.maxDoppelbetreuungProTag;
    const maxAmStueck = ix.einstellungen.maxDoppelbetreuungStundenAmStueck;
    for (const [k, proStunde] of db) {
      const [l, tag] = k.split('|');
      const folgen = laeufe([...proStunde.keys()]);
      const alle = [...proStunde.values()].flat();
      if (folgen.length > maxProTag) {
        melde('H1', `${n.lehrkraft(l)} hat am ${tag} ${folgen.length} Doppelbetreuungen (erlaubt: ${maxProTag})`, { stunden: alle });
      }
      for (const f of folgen) {
        if (f.length > maxAmStueck) {
          melde('H1', `${n.lehrkraft(l)} betreut am ${tag} ${f.length} Stunden am Stück doppelt (erlaubt: ${maxAmStueck})`, { stunden: f.flatMap((st) => proStunde.get(st)) });
        }
      }
    }

    /* ---------- H2: Klasse je Slot ---------- */
    for (const [k, idx] of proKlasseSlot) {
      if (idx.length < 2) continue;
      const [klasse, tag, stunde] = k.split('|');
      melde('H2', `${n.klasse(klasse)} hat ${n.slot(tag, stunde)} Stunde ${idx.length} Veranstaltungen`, { stunden: idx });
    }

    /* ---------- H3: Raum je Slot ---------- */
    const raumSlot = gruppiere(stunden, (s) => (s.raum ? S(s.raum, s.tag, s.stunde) : null));
    for (const [k, idx] of raumSlot) {
      if (idx.length < 2) continue;
      const erlaubt = idx.length === 2 && verknuepft(stunden[idx[0]], stunden[idx[1]]);
      if (!erlaubt) {
        const [raum, tag, stunde] = k.split('|');
        melde('H3', `Raum ${n.raum(raum)} ist ${n.slot(tag, stunde)} Stunde ${idx.length}-fach belegt (${idx.map((i) => n.klasse(stunden[i].klasse)).join(', ')})`, { stunden: idx });
      }
    }

    /* ---------- H4, H5, H8, H10: je Eintrag ---------- */
    const maxL = ix.einstellungen.maxLehrkraefteProKlasseUndSlot;
    stunden.forEach((s, i) => {
      const nur = { stunden: [i] };
      const wo = `${n.klasse(s.klasse)} ${n.slot(s.tag, s.stunde)} Stunde`;
      for (const l of s.lehrkraefte || []) {
        if (ix.lehrkraftGesperrt(l, s.tag, s.stunde)) melde('H4', `${n.lehrkraft(l)} ist ${n.slot(s.tag, s.stunde)} Stunde gesperrt (${wo})`, nur);
        if (ix.lehrkraftAbwesend(l, datum)) melde('H4', `${n.lehrkraft(l)} ist am ${datum} abwesend (${wo})`, nur);
      }
      if (Index.STATUS.mitRaum(s)) {
        if (!s.raum) melde('H5', `${wo}: kein Raum zugewiesen`, nur);
        else {
          if (ix.raumGesperrt(s.raum, s.tag, s.stunde)) melde('H5', `Raum ${n.raum(s.raum)} ist ${n.slot(s.tag, s.stunde)} Stunde gesperrt (${wo})`, nur);
          if (ix.raumAbwesend(s.raum, datum)) melde('H5', `Raum ${n.raum(s.raum)} steht am ${datum} nicht zur Verfügung (${wo})`, nur);
          if (Index.STATUS.fachunterricht(s) && s.fach && !ix.raumPasst(s.raum, s.fach)) {
            const f = ix.faecher.get(s.fach);
            melde('H5', `${wo}: ${n.fach(s.fach)} ${f?.raumtyp ? 'braucht Raumtyp „' + f.raumtyp + '“' : 'gehört in einen Klassenraum'}, Raum ${n.raum(s.raum)} passt nicht`, nur);
          }
        }
      }
      if (s.status === 'regulaer' && s.fach && s.lehrkraefte?.length) {
        const stufe = ix.klassen.get(s.klasse)?.stufe;
        if (!ix.istQualifiziert(s.lehrkraefte[0], s.fach, stufe)) {
          melde('H8', `${wo}: ${n.lehrkraft(s.lehrkraefte[0])} ist für ${n.fach(s.fach)} in Stufe ${stufe} nicht qualifiziert`, nur);
        }
      }
      if ((s.lehrkraefte || []).length > maxL) melde('H10', `${wo}: ${s.lehrkraefte.length} Lehrkräfte (erlaubt: ${maxL})`, nur);
    });

    /* ---------- H6: Kapazität (inkl. Gäste aus Aufteilungen) ---------- */
    const last = new Map(); // Raum|Tag|Stunde → { schueler, idx }
    const addiere = (raum, tag, stunde, anzahl, i) => {
      const k = S(raum, tag, stunde);
      if (!last.has(k)) last.set(k, { schueler: 0, idx: new Set() });
      const e = last.get(k);
      e.schueler += anzahl;
      e.idx.add(i);
    };
    stunden.forEach((s, i) => {
      if (!Index.STATUS.mitRaum(s) || !s.raum) return;
      addiere(s.raum, s.tag, s.stunde, ix.klassen.get(s.klasse)?.schueler || 0, i);
    });
    stunden.forEach((s, i) => {
      if (s.status !== 'aufgeteilt') return;
      for (const v of s.verteilung || []) {
        const zielIdx = (proKlasseSlot.get(S(v.zielKlasse, s.tag, s.stunde)) || [])[0];
        const zielStunde = zielIdx !== undefined ? stunden[zielIdx] : null;
        if (!zielStunde || !Index.STATUS.mitRaum(zielStunde) || !zielStunde.raum) {
          melde('H6', `Aufteilung ${n.klasse(s.klasse)} ${n.slot(s.tag, s.stunde)} Stunde: Zielklasse ${n.klasse(v.zielKlasse)} hat in diesem Slot keinen Unterricht in einem Raum`, { stunden: [i] });
          continue;
        }
        addiere(zielStunde.raum, s.tag, s.stunde, v.anzahl, i);
      }
    });
    for (const [k, e] of last) {
      const [raum, tag, stunde] = k.split('|');
      const kap = ix.raeume.get(raum)?.kapazitaet ?? Infinity;
      if (e.schueler > kap) {
        melde('H6', `Raum ${n.raum(raum)} ${n.slot(tag, stunde)} Stunde: ${e.schueler} Schüler:innen bei Kapazität ${kap}`, { stunden: [...e.idx] });
      }
    }

    /* ---------- H7, H11: Wochenstunden und Reserve ---------- */
    if (woche) {
      for (const [l, info] of lehrkraftStunden(stunden)) {
        const lk = ix.lehrkraefte.get(l);
        if (!lk) continue;
        if (info.slots.size > lk.maxStunden) {
          melde('H7', `${n.lehrkraft(l)} hat ${info.slots.size} Wochenstunden (Höchstgrenze ${lk.maxStunden})`, { stunden: info.idx });
        }
        const grenze = lk.sollStunden - ix.reserve(lk);
        if (info.zweit.size > 0 && info.slots.size > grenze) {
          melde('H11', `${n.lehrkraft(l)} hat ${info.slots.size} Stunden davon ${info.zweit.size} als Zweitbesetzung; mit Zweitbesetzung höchstens ${grenze} (Soll ${lk.sollStunden} − Reserve ${ix.reserve(lk)})`, { stunden: info.zweitIdx });
        }
      }
    }

    /* ---------- H9: Stundentafel ---------- */
    const proKlasseFach = gruppiere(stunden, (s) => (s.fach ? S(s.klasse, s.fach) : null));
    for (const [k, idx] of proKlasseFach) {
      const [klasse, fach] = k.split('|');
      const soll = ix.tafel.get(klasse)?.get(fach)?.stunden;
      // Im Tagesplan gilt dieselbe Obergrenze: ein Tag hat nie mehr Stunden eines Fachs als die Woche.
      if (soll === undefined) melde('H9', `${n.klasse(klasse)}: ${n.fach(fach)} steht nicht in der Stundentafel`, { stunden: idx });
      else if (idx.length > soll) melde('H9', `${n.klasse(klasse)}: ${idx.length} Stunden ${n.fach(fach)}, Stundentafel sieht ${soll} vor`, { stunden: idx });
    }

    /* ---------- H12: keine Leerstunden ---------- */
    const proKlasseTag = gruppiere(stunden, (s) => (Index.STATUS.belegt(s) ? S(s.klasse, s.tag) : null));
    for (const [k, idx] of proKlasseTag) {
      const [klasse, tag] = k.split('|');
      const belegt = new Set(idx.map((i) => stunden[i].stunde));
      const reihe = ix.stunden.filter((st) => st >= Math.min(...belegt) && st <= Math.max(...belegt));
      const luecken = reihe.filter((st) => !belegt.has(st));
      if (luecken.length) {
        melde('H12', `${n.klasse(klasse)} hat am ${tag} ${luecken.length === 1 ? 'eine Leerstunde' : luecken.length + ' Leerstunden'} (${luecken.map((st) => st + '.').join(', ')} Stunde)`, { stunden: idx });
      }
    }

    /* ---------- H13, H14: Pausenaufsichten ---------- */
    const unterrichtetAm = new Set(); // Lehrkraft|Tag
    for (const s of stunden) if (Index.STATUS.belegt(s)) for (const l of s.lehrkraefte || []) unterrichtetAm.add(S(l, s.tag));
    const aufsichtDoppelt = gruppiere(aufsichten, (a) => S(a.tag, a.vorStunde, a.lehrkraft));
    for (const [k, idx] of aufsichtDoppelt) {
      if (idx.length > 1) {
        const [tag, vor, l] = k.split('|');
        melde('H13', `${n.lehrkraft(l)} ist für ${n.pause(tag, Number(vor))} mehrfach eingeteilt`, { aufsichten: idx });
      }
    }
    aufsichten.forEach((a, i) => {
      const nur = { aufsichten: [i] };
      const wo = n.pause(a.tag, a.vorStunde);
      const angrenzend = a.vorStunde === ix.stunden[0] ? [a.vorStunde] : [a.vorStunde - 1, a.vorStunde];
      const gesperrt = angrenzend.filter((st) => ix.lehrkraftGesperrt(a.lehrkraft, a.tag, st));
      if (gesperrt.length) melde('H13', `${n.lehrkraft(a.lehrkraft)}: Aufsicht ${wo}, aber ${gesperrt.map((st) => st + '.').join(' und ')} Stunde gesperrt`, nur);
      if (ix.lehrkraftAbwesend(a.lehrkraft, datum)) melde('H13', `${n.lehrkraft(a.lehrkraft)} ist am ${datum} abwesend (Aufsicht ${wo})`, nur);
      if (!unterrichtetAm.has(S(a.lehrkraft, a.tag))) melde('H13', `${n.lehrkraft(a.lehrkraft)} hat am ${a.tag} keinen Unterricht, ist aber für ${wo} eingeteilt`, nur);
    });
    if (woche) {
      const jeLehrkraft = gruppiere(aufsichten, (a) => a.lehrkraft);
      for (const [l, idx] of jeLehrkraft) {
        const soll = ix.lehrkraefte.get(l)?.aufsichtenProWoche ?? 0;
        if (idx.length > soll) melde('H14', `${n.lehrkraft(l)} hat ${idx.length} Aufsichten (Aufsichtssoll ${soll})`, { aufsichten: idx });
      }
    }

    const nr = (r) => Number(r.slice(1));
    return verstoesse.sort((a, b) => nr(a.regel) - nr(b.regel));
  }

  /* ------------------------------ Hilfen ---------------------------------- */

  /** Gruppiert Indizes nach Schlüssel; `null` als Schlüssel wird übersprungen. */
  function gruppiere(liste, schluesselFn) {
    const m = new Map();
    liste.forEach((e, i) => {
      const k = schluesselFn(e);
      if (k === null || k === undefined) return;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(i);
    });
    return m;
  }

  /** Zerlegt Stundennummern in Folgen aufeinanderfolgender Stunden. */
  function laeufe(nummern) {
    const sortiert = [...new Set(nummern)].sort((a, b) => a - b);
    const ergebnis = [];
    for (const x of sortiert) {
      const letzte = ergebnis[ergebnis.length - 1];
      if (letzte && x === letzte[letzte.length - 1] + 1) letzte.push(x);
      else ergebnis.push([x]);
    }
    return ergebnis;
  }

  /**
   * Belegte Zeitslots je Lehrkraft (Haupt, Zweit, Aufsicht, Doppelbetreuung
   * zählt je Slot einmal). Grundlage für H7, H11, K5, W2, W7, W8.
   * @returns {Map<string, {slots: Set<string>, zweit: Set<string>, idx: number[], zweitIdx: number[], proTag: Map<string, Set<number>>}>}
   */
  function lehrkraftStunden(stunden) {
    const m = new Map();
    stunden.forEach((s, i) => {
      if (!Index.STATUS.belegt(s)) return;
      (s.lehrkraefte || []).forEach((l, rolle) => {
        if (!m.has(l)) m.set(l, { slots: new Set(), zweit: new Set(), idx: [], zweitIdx: [], proTag: new Map() });
        const e = m.get(l);
        const slot = S(s.tag, s.stunde);
        e.slots.add(slot);
        e.idx.push(i);
        if (rolle > 0) { e.zweit.add(slot); e.zweitIdx.push(i); }
        if (!e.proTag.has(s.tag)) e.proTag.set(s.tag, new Set());
        e.proTag.get(s.tag).add(s.stunde);
      });
    });
    return m;
  }

  /** Anzahl Verstöße je Regel, z. B. { H1: 2, H12: 1 }. */
  function zaehle(verstoesse) {
    const m = {};
    for (const v of verstoesse) m[v.regel] = (m[v.regel] || 0) + 1;
    return m;
  }

  return { TITEL, pruefeHart, zaehle, lehrkraftStunden, laeufe, gruppiere };
})();
