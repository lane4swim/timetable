/* ==========================================================================
 * Modul Planer
 * Erstellt einen Regelplan (Spezifikation §6):
 *   1. Bedarf: Stundentafeln → Unterrichtsstunden je Klasse und Fach
 *   2. Vorprüfung: Bedarf gegen Kontingente, Aufsichtsbedarf gegen Aufsichtssoll
 *   3. Lehrkräfte-Zuweisung: Festzuordnungen, Rest als Minimalkosten-Fluss
 *      (Ausfall minimal, dann eigene Lehrkräfte bevorzugt); liefert untere
 *      Schranke für den Ausfall (K1)
 *   4. Konstruktion: je Klasse und Tag ein lückenloser Block ab der 1. Stunde
 *      (H12 gilt per Konstruktion); Stunden werden in diese Blöcke gesetzt und
 *      Konflikte (H1, H3–H5) per Tabu-Suche mit Tauschzügen beseitigt; was
 *      sich nicht konfliktfrei setzen lässt, bekommt eine andere qualifizierte
 *      Lehrkraft oder entfällt am Tagesende
 *   5. Nachoptimierung: Simulated Annealing über die weichen Regeln (K6) mit
 *      Zügen, die harte Regeln und H12 nie verletzen
 *   6. Abschluss: Räume, Zweitbesetzungen (W9/W10), Pausenaufsichten (Fluss),
 *      Prüfung aller harten Regeln, Kostenvektor
 * Die Arbeit läuft in Zeitscheiben (schritt), damit der Web Worker Fortschritt
 * melden und abbrechen kann. Gleicher Startwert ⇒ gleiches Ergebnis, solange
 * das Zeitbudget nicht greift.
 * ========================================================================== */
const Planer = (() => {
  'use strict';

  const jetzt = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  /**
   * Startet einen Planungslauf.
   * @param {object} z gültiger Zustand
   * @param {{zeitbudgetMs?: number, startwert?: number, iterationen?: number, uhr?: () => number}} [optionen]
   */
  function starte(z, optionen = {}) {
    const uhr = optionen.uhr || jetzt;
    const beginn = uhr();
    const budget = optionen.zeitbudgetMs ?? z.einstellungen.zeitbudgetSekunden * 1000;
    const zufall = Hilfen.erzeugeZufall(optionen.startwert ?? z.einstellungen.zufallsStartwert);
    const p = vorbereite(z);
    const statistik = { iterationenKonflikte: 0, iterationenOptimierung: 0, abgebrochen: false, zeitbudgetErreicht: false };
    let phase = 'konflikte';
    let abbruch = false;
    let ergebnis = null;

    zuweisen(p);
    profileUndStart(p, zufall);
    const konflikt = konfliktSuche(p, zufall, statistik);
    let optimierung = null;

    function restMs() { return budget - (uhr() - beginn); }

    /** Arbeitet höchstens `maxMs` Millisekunden; liefert true, wenn fertig. */
    function schritt(maxMs = 50) {
      const ende = uhr() + maxMs;
      while (!ergebnis && uhr() < ende) {
        if (phase === 'konflikte') {
          // Höchstens die Hälfte des Budgets für die Konfliktsuche, dann erzwungene Reparatur
          const zuLang = uhr() - beginn > budget * 0.5;
          const erzwingen = abbruch || zuLang || konflikt.erschoepft();
          if (erzwingen) {
            if (zuLang && !abbruch) statistik.zeitbudgetErreicht = true;
            repariere(p, statistik);
          }
          if (p.konflikte === 0 || erzwingen) {
            phase = 'optimierung';
            optimierung = annealing(p, zufall, optionen.iterationen, statistik);
            continue;
          }
          konflikt.lauf(2000);
        } else if (phase === 'optimierung') {
          if (abbruch || restMs() <= 0 || optimierung.fertig()) {
            if (!abbruch && restMs() <= 0 && !optimierung.fertig()) statistik.zeitbudgetErreicht = true;
            optimierung.beste();
            phase = 'abschluss';
            continue;
          }
          optimierung.lauf(4000);
        } else {
          ergebnis = abschluss(z, p, zufall, statistik);
          statistik.dauerMs = Math.round(uhr() - beginn);
          ergebnis.bericht.statistik = statistik;
        }
      }
      return !!ergebnis;
    }

    function fortschritt() {
      const anteil = ergebnis ? 1
        : phase === 'konflikte' ? 0.05 + 0.25 * konflikt.anteil()
          : phase === 'optimierung' ? 0.3 + 0.65 * optimierung.anteil() : 0.97;
      return {
        phase, anteil, konflikte: p.konflikte, weich: optimierung ? Math.round(optimierung.aktuell() * 100) / 100 : null,
        ausfall: p.ausfall.reduce((s, a) => s + a.stunden, 0), restMs: Math.max(0, Math.round(restMs())),
      };
    }

    return {
      schritt,
      fortschritt,
      abbrechen() { abbruch = true; statistik.abgebrochen = true; },
      get fertig() { return !!ergebnis; },
      ergebnis: () => ergebnis,
    };
  }

  /** Plant vollständig (synchron) – für Tests und Werkzeuge. */
  function plane(z, optionen = {}) {
    const lauf = starte(z, optionen);
    while (!lauf.schritt(1000));
    return lauf.ergebnis();
  }

  /* =========================== Vorbereitung =========================== */

  function vorbereite(z) {
    const ix = Index.erstelle(z);
    const e = z.einstellungen;
    const T = ix.tage.length;
    const H = ix.stunden.length;
    const NS = T * H;
    const L = z.lehrkraefte;
    const K = z.klassen;
    const F = z.faecher;
    const lIdx = new Map(L.map((l, i) => [l.id, i]));
    const fIdx = new Map(F.map((f, i) => [f.id, i]));

    const gesperrt = new Uint8Array(L.length * NS);
    L.forEach((l, t) => {
      for (let d = 0; d < T; d++) for (let h = 0; h < H; h++) if (ix.lehrkraftGesperrt(l.id, ix.tage[d], ix.stunden[h])) gesperrt[t * NS + d * H + h] = 1;
    });
    const freieSlots = L.map((_, t) => NS - gesperrt.subarray(t * NS, (t + 1) * NS).reduce((a, b) => a + b, 0));

    // Raumtypen der Fächer und verfügbare Räume je Typ und Slot
    // Raumtypen ohne Groß-/Kleinschreibung (Modell.raumtypSchluessel)
    const typen = [...new Set(F.map((f) => Modell.raumtypSchluessel(f.raumtyp)).filter(Boolean))];
    const typIdx = new Map(typen.map((t, i) => [t, i]));
    const fachTyp = F.map((f) => (Modell.raumtypSchluessel(f.raumtyp) ? typIdx.get(Modell.raumtypSchluessel(f.raumtyp)) : -1));
    const raeumeJeTyp = typen.map((ty) => z.raeume.filter((r) => Modell.raumtypDesRaums(r) === ty).sort((a, b) => a.kapazitaet - b.kapazitaet || a.id.localeCompare(b.id)));
    const kapTyp = new Int16Array(Math.max(1, typen.length) * NS);
    typen.forEach((_, ty) => {
      for (let d = 0; d < T; d++) {
        for (let h = 0; h < H; h++) {
          kapTyp[ty * NS + d * H + h] = raeumeJeTyp[ty].filter((r) => !ix.raumGesperrt(r.id, ix.tage[d], ix.stunden[h])).length;
        }
      }
    });
    // Heimatraum gesperrt → normale Stunden der Klasse dort nicht möglich
    const heimatGesperrt = new Uint8Array(K.length * NS);
    K.forEach((k, c) => {
      if (!k.heimatraum) return;
      for (let d = 0; d < T; d++) for (let h = 0; h < H; h++) if (ix.raumGesperrt(k.heimatraum, ix.tage[d], ix.stunden[h])) heimatGesperrt[c * NS + d * H + h] = 1;
    });

    // Gewichte und weitere Konstanten für die weichen Regeln
    const g = e.gewichte;
    const hauptfach = F.map((f) => !!f.hauptfach);
    const sport = F.map((f) => Modell.SONDERRAUMTYPEN.includes(Modell.raumtypSchluessel(f.raumtyp)));
    const blockMax = F.map((f) => (f.blockbar ? 2 : 1));
    const nachmittag = ix.stunden.map((nr) => !ix.istVormittag(nr));
    const nachPause = ix.stunden.map((nr, h) => h > 0 && ix.pauseVor.has(nr));
    const doppelStart = ix.stunden.map((nr) => ix.doppelstundenStart.has(nr));

    return {
      z, ix, e, T, H, NS, L, K, F, lIdx, fIdx, gesperrt, freieSlots, typen, fachTyp, raeumeJeTyp, kapTyp, heimatGesperrt,
      g, hauptfach, sport, blockMax, nachmittag, nachPause, doppelStart, typen,
      // werden in den folgenden Schritten gefüllt:
      items: [], ausfall: [], warnungen: [], vorpruefung: null, untereSchrankeK1: 0,
      itemsJeKlasse: K.map(() => []), laenge: new Int16Array(K.length * T), pos: null, grid: null,
      occT: new Int16Array(L.length * NS), useTyp: new Int16Array(Math.max(1, typen.length) * NS), konflikte: 0,
      stundenJeLehrkraft: new Int16Array(L.length),
    };
  }

  /* ======================= Bedarf und Zuweisung ======================= */

  function zuweisen(p) {
    const { z, ix, L, K, lIdx, fIdx } = p;
    const reserve = L.map((l) => ix.reserve(l));
    const nutzbar = L.map((l, t) => Math.min(l.sollStunden - reserve[t], p.freieSlots[t]));
    const grenze = L.map((l, t) => Math.min(l.maxStunden, p.freieSlots[t]));
    const belegt = new Float64Array(L.length);
    const auftraege = []; // { c, f, stunden, zuteilung: [{t, n}] }

    // 0. Fächer, für die es keinen passenden Raum gibt, können nicht stattfinden – vorab herausnehmen,
    //    damit sie die übrigen Stunden nicht verdrängen
    const ohneRaum = [];
    // 1. Festzuordnungen (nur qualifizierte Hauptlehrkräfte, bis zur Höchstgrenze)
    K.forEach((k, c) => {
      for (const eintrag of k.stundentafel) {
        const a = { c, f: fIdx.get(eintrag.fach), stunden: eintrag.stunden, rest: eintrag.stunden, zuteilung: [] };
        auftraege.push(a);
        const ty = p.fachTyp[a.f];
        if (ty >= 0) {
          const raumtyp = p.typen[ty];
          const grund = !p.raeumeJeTyp[ty].length ? `kein Raum vom Typ „${raumtyp}“ vorhanden`
            : !p.raeumeJeTyp[ty].some((r) => r.kapazitaet >= k.schueler) ? `kein Raum vom Typ „${raumtyp}“ mit ${k.schueler} Plätzen` : null;
          if (grund) {
            p.ausfall.push({ klasse: k.id, fach: eintrag.fach, stunden: eintrag.stunden, grund });
            ohneRaum.push(`${k.name} ${ix.name.fach(eintrag.fach)}: ${grund} – ${eintrag.stunden} Stunde(n) können nicht geplant werden`);
            a.rest = 0;
            a.ohneRaum = true;
            continue;
          }
        }
        const id = ix.zuordnungVon(k.id, eintrag.fach).haupt;
        if (!id) continue;
        const t = lIdx.get(id);
        if (!ix.istQualifiziert(id, eintrag.fach, k.stufe)) {
          p.warnungen.push(`${k.name} ${ix.name.fach(eintrag.fach)}: festgelegte Lehrkraft ${ix.name.lehrkraft(id)} ist nicht qualifiziert – die Stunden werden neu zugewiesen`);
          continue;
        }
        const n = Math.max(0, Math.min(a.rest, grenze[t] - belegt[t]));
        if (n < a.rest) p.warnungen.push(`${k.name} ${ix.name.fach(eintrag.fach)}: ${ix.name.lehrkraft(id)} erreicht die Höchstgrenze – ${a.rest - n} Stunde(n) werden anders zugewiesen`);
        if (n > 0) { a.zuteilung.push({ t, n }); a.rest -= n; belegt[t] += n; }
      }
    });

    // 2. Rest als Minimalkosten-Fluss: Auftrag → qualifizierte Lehrkraft → Senke
    const offen = auftraege.filter((a) => a.rest > 0);
    let flussErgebnis = { fluss: 0 };
    if (offen.length) {
      const q = 0;
      const s = 1;
      const g = Fluss.graph(2 + offen.length + L.length);
      const knotenL = (t) => 2 + offen.length + t;
      const kanten = [];
      offen.forEach((a, i) => {
        Fluss.kante(g, q, 2 + i, a.rest, 0);
        const k = K[a.c];
        const fachId = p.F[a.f].id;
        L.forEach((l, t) => {
          if (!ix.istQualifiziert(l.id, fachId, k.stufe)) return;
          const kosten = k.klassenlehrkraft === l.id ? 1 : ix.lehrkraefteDerKlasse.get(k.id)?.has(l.id) ? 2 : 3;
          kanten.push({ a, t, e: Fluss.kante(g, 2 + i, knotenL(t), a.rest, kosten) });
        });
      });
      L.forEach((_, t) => {
        const stufe1 = Math.max(0, nutzbar[t] - belegt[t]);
        const stufe2 = Math.max(0, grenze[t] - Math.max(belegt[t], nutzbar[t]));
        if (stufe1) Fluss.kante(g, knotenL(t), s, stufe1, 0);
        if (stufe2) Fluss.kante(g, knotenL(t), s, stufe2, 100); // Reserve/Mehrarbeit nur, wenn sonst Ausfall
      });
      flussErgebnis = Fluss.minKostenMaxFluss(g, q, s);
      for (const { a, t, e } of kanten) {
        const n = Fluss.flussVon(g, e);
        if (n > 0) { a.zuteilung.push({ t, n }); a.rest -= n; belegt[t] += n; }
      }
    }

    p.warnungen.unshift(...ohneRaum);
    // 3. Ausfall aus der Zuweisung, Stunden erzeugen
    for (const a of auftraege) {
      const k = K[a.c];
      if (a.rest > 0) {
        p.ausfall.push({ klasse: k.id, fach: p.F[a.f].id, stunden: a.rest, grund: 'keine qualifizierte Lehrkraft mit freiem Kontingent' });
      }
      for (const { t, n } of a.zuteilung) {
        for (let i = 0; i < n; i++) p.items.push({ c: a.c, f: a.f, t, typ: p.fachTyp[a.f], ersatz: ix.zuordnungVon(k.id, p.F[a.f].id).haupt !== L[t].id });
      }
    }
    p.untereSchrankeK1 = p.ausfall.reduce((s, x) => s + x.stunden, 0);

    // Vorprüfung (§6.2)
    const jeFach = p.F.map((f, fi) => {
      const bedarf = auftraege.filter((a) => a.f === fi).reduce((s, a) => s + a.stunden, 0);
      if (!bedarf) return null;
      const stufen = new Set(auftraege.filter((a) => a.f === fi).map((a) => K[a.c].stufe));
      const kapazitaet = L.reduce((s, l, t) => s + ([...stufen].some((st) => ix.istQualifiziert(l.id, f.id, st)) ? Math.max(0, nutzbar[t]) : 0), 0);
      const erwarteterAusfall = p.ausfall.filter((x) => x.fach === f.id).reduce((s, x) => s + x.stunden, 0);
      const ausfallPersonal = p.ausfall.filter((x) => x.fach === f.id && x.grund.startsWith('keine qualifizierte')).reduce((s, x) => s + x.stunden, 0);
      return { fach: f.id, bedarf, kapazitaet, erwarteterAusfall, ausfallPersonal };
    }).filter(Boolean);
    const aufsichtBedarf = p.T * p.ix.pausen.reduce((s, pa) => s + pa.aufsichten, 0);
    p.vorpruefung = {
      jeFach,
      freieKapazitaet: L.map((l, t) => ({ lehrkraft: l.id, frei: Math.max(0, l.sollStunden - reserve[t] - belegt[t]) })),
      aufsichten: { bedarf: aufsichtBedarf, soll: L.reduce((s, l) => s + l.aufsichtenProWoche, 0) },
      ausfallMindestens: p.untereSchrankeK1,
    };
    if (p.vorpruefung.aufsichten.soll < aufsichtBedarf) {
      p.warnungen.push(`Aufsichtssoll (${p.vorpruefung.aufsichten.soll}) reicht nicht für den Wochenbedarf (${aufsichtBedarf}) – Aufsichten bleiben unbesetzt`);
    }
    for (const x of jeFach) {
      if (x.ausfallPersonal) p.warnungen.push(`${ix.name.fach(x.fach)}: Bedarf ${x.bedarf}, Kapazität qualifizierter Lehrkräfte ${x.kapazitaet} – mindestens ${x.ausfallPersonal} Stunde(n) Ausfall`);
    }
  }

  /* ================= Tagesprofile und Startbelegung =================== */

  function profileUndStart(p, zufall) {
    const { T, H, NS, K, items } = p;
    p.pos = new Int32Array(items.length).fill(-1);
    p.grid = new Int32Array(K.length * NS).fill(-1);
    items.forEach((it, i) => p.itemsJeKlasse[it.c].push(i));
    const lastGesamt = new Int32Array(p.L.length);
    for (const it of items) lastGesamt[it.t]++;

    K.forEach((k, c) => {
      let liste = p.itemsJeKlasse[c];
      // Mehr Stunden als Zeitslots: Nebenfächer zuerst streichen
      if (liste.length > NS) {
        const sortiert = liste.slice().sort((a, b) => p.hauptfach[items[a].f] - p.hauptfach[items[b].f]);
        for (const i of sortiert.slice(0, liste.length - NS)) {
          items[i].entfernt = true;
          ausfallEintragen(p, i, 'passt nicht ins Zeitraster');
        }
        liste = p.itemsJeKlasse[c] = liste.filter((i) => !items[i].entfernt);
      }
      // Gleichmäßige Tageslängen; längere Tage vorn
      const basis = Math.floor(liste.length / T);
      const rest = liste.length % T;
      for (let d = 0; d < T; d++) p.laenge[c * T + d] = basis + (d < rest ? 1 : 0);
      const slots = [];
      for (let d = 0; d < T; d++) for (let h = 0; h < p.laenge[c * T + d]; h++) slots.push(d * H + h);
      // Schwierige Stunden zuerst: Fachraum, dann Lehrkräfte mit wenig Spielraum (Stunden / freie Slots)
      const enge = (i) => lastGesamt[items[i].t] / Math.max(1, p.freieSlots[items[i].t]);
      const reihenfolge = zufall.gemischt(liste).sort((a, b) => (items[b].typ >= 0) - (items[a].typ >= 0) || enge(b) - enge(a));
      const frei = new Set(slots);
      for (const i of reihenfolge) {
        let beste = [];
        let besteKosten = Infinity;
        for (const s of frei) {
          const k = startKosten(p, i, s);
          if (k < besteKosten) { besteKosten = k; beste = [s]; } else if (k === besteKosten) beste.push(s);
        }
        const s = zufall.auswahl(beste);
        frei.delete(s);
        setze(p, i, s);
      }
    });
    p.konflikte = gesamtKonflikte(p);
  }

  function startKosten(p, i, s) {
    const it = p.items[i];
    let k = p.occT[it.t * p.NS + s] * 2 + gesperrtWert(p, i, s) * 3;
    if (it.typ >= 0 && p.useTyp[it.typ * p.NS + s] >= p.kapTyp[it.typ * p.NS + s]) k += 2;
    return k;
  }

  /* ================== Konfliktzählung und Züge ======================== */

  function gesperrtWert(p, i, s) {
    const it = p.items[i];
    return p.gesperrt[it.t * p.NS + s] + (it.typ < 0 ? p.heimatGesperrt[it.c * p.NS + s] : 0);
  }

  function setze(p, i, s) {
    const it = p.items[i];
    p.pos[i] = s;
    p.grid[it.c * p.NS + s] = i;
    p.occT[it.t * p.NS + s]++;
    if (it.typ >= 0) p.useTyp[it.typ * p.NS + s]++;
    p.stundenJeLehrkraft[it.t]++;
  }

  function loese(p, i) {
    const it = p.items[i];
    const s = p.pos[i];
    if (p.grid[it.c * p.NS + s] === i) p.grid[it.c * p.NS + s] = -1;
    p.occT[it.t * p.NS + s]--;
    if (it.typ >= 0) p.useTyp[it.typ * p.NS + s]--;
    p.stundenJeLehrkraft[it.t]--;
    p.pos[i] = -1;
  }

  function gesamtKonflikte(p) {
    let k = 0;
    for (let x = 0; x < p.occT.length; x++) if (p.occT[x] > 1) k += p.occT[x] - 1;
    for (let x = 0; x < p.typen.length * p.NS; x++) if (p.useTyp[x] > p.kapTyp[x]) k += p.useTyp[x] - p.kapTyp[x];
    p.items.forEach((it, i) => { if (p.pos[i] >= 0) k += gesperrtWert(p, i, p.pos[i]); });
    return k;
  }

  /** Konfliktbeitrag rund um die Stunden `idx` an ihren aktuellen Positionen plus Slots `extra`. */
  function lokal(p, idx, slots) {
    const tKeys = [];
    const yKeys = [];
    for (const i of idx) {
      const it = p.items[i];
      for (const s of slots) {
        const kt = it.t * p.NS + s;
        if (!tKeys.includes(kt)) tKeys.push(kt);
        if (it.typ >= 0) { const ky = it.typ * p.NS + s; if (!yKeys.includes(ky)) yKeys.push(ky); }
      }
    }
    let k = 0;
    for (const kt of tKeys) if (p.occT[kt] > 1) k += p.occT[kt] - 1;
    for (const ky of yKeys) if (p.useTyp[ky] > p.kapTyp[ky]) k += p.useTyp[ky] - p.kapTyp[ky];
    for (const i of idx) if (p.pos[i] >= 0) k += gesperrtWert(p, i, p.pos[i]);
    return k;
  }

  /** Tauscht die Plätze zweier Stunden derselben Klasse. */
  function tausche(p, i, j) {
    const si = p.pos[i];
    const sj = p.pos[j];
    loese(p, i);
    loese(p, j);
    setze(p, i, sj);
    setze(p, j, si);
  }

  /** Verschiebt die letzte Stunde eines Tages ans Ende eines anderen Tages der Klasse. */
  function verschiebeProfil(p, i, zielTag) {
    const it = p.items[i];
    const quelleTag = Math.floor(p.pos[i] / p.H);
    loese(p, i);
    p.laenge[it.c * p.T + quelleTag]--;
    const s = zielTag * p.H + p.laenge[it.c * p.T + zielTag];
    p.laenge[it.c * p.T + zielTag]++;
    setze(p, i, s);
    return quelleTag;
  }

  const istLetzte = (p, i) => {
    const s = p.pos[i];
    const d = Math.floor(s / p.H);
    return s % p.H === p.laenge[p.items[i].c * p.T + d] - 1;
  };

  /** Mögliche Züge für Stunde i: Tausch mit jeder anderen Stunde der Klasse, Profilverschiebung. */
  function zuege(p, i) {
    const it = p.items[i];
    const liste = [];
    for (const j of p.itemsJeKlasse[it.c]) {
      if (j === i || p.pos[j] < 0) continue;
      const jt = p.items[j];
      if (jt.t === it.t && jt.f === it.f) continue;
      liste.push({ art: 't', j });
    }
    if (istLetzte(p, i)) {
      const dQ = Math.floor(p.pos[i] / p.H);
      for (let d = 0; d < p.T; d++) if (d !== dQ && p.laenge[it.c * p.T + d] < p.H) liste.push({ art: 'p', d });
    }
    return liste;
  }

  /** Führt einen Zug aus und liefert eine Rücknahmefunktion sowie die betroffenen Slots. */
  function fuehreAus(p, i, zug) {
    if (zug.art === 't') {
      const si = p.pos[i];
      const sj = p.pos[zug.j];
      tausche(p, i, zug.j);
      return { slots: [si, sj], idx: [i, zug.j], zurueck: () => tausche(p, i, zug.j) };
    }
    const si = p.pos[i];
    const quelle = verschiebeProfil(p, i, zug.d);
    const neu = p.pos[i];
    return { slots: [si, neu], idx: [i], zurueck: () => verschiebeProfil(p, i, quelle) };
  }

  /** Konflikt-Delta eines Zugs (führt ihn aus, misst, nimmt ihn zurück, wenn `behalten` false). */
  function konfliktDelta(p, i, zug) {
    const vorherIdx = zug.art === 't' ? [i, zug.j] : [i];
    const vorherSlots = zug.art === 't' ? [p.pos[i], p.pos[zug.j]] : [p.pos[i], zug.d * p.H + p.laenge[p.items[i].c * p.T + zug.d]];
    const vorher = lokal(p, vorherIdx, vorherSlots);
    const r = fuehreAus(p, i, zug);
    const nachher = lokal(p, r.idx, vorherSlots);
    return { delta: nachher - vorher, r };
  }

  /* ======================= Konfliktsuche (Tabu) ======================= */

  function konfliktSuche(p, zufall, statistik) {
    const n = p.items.length;
    const maxIter = Math.max(20000, 300 * n);
    const tabu = new Int32Array(n * p.NS);
    let iter = 0;
    let besteKonflikte = p.konflikte;
    let ohneVerbesserung = 0;

    function konfliktbehaftet(i) {
      const s = p.pos[i];
      if (s < 0) return false;
      const it = p.items[i];
      return p.occT[it.t * p.NS + s] > 1 || gesperrtWert(p, i, s) > 0
        || (it.typ >= 0 && p.useTyp[it.typ * p.NS + s] > p.kapTyp[it.typ * p.NS + s]);
    }

    function lauf(schritte) {
      for (let x = 0; x < schritte && p.konflikte > 0 && iter < maxIter; x++, iter++) {
        // zufällige konfliktbehaftete Stunde suchen
        const start = Math.floor(zufall.naechste() * n);
        let i = -1;
        for (let k = 0; k < n; k++) { const c = (start + k) % n; if (konfliktbehaftet(c)) { i = c; break; } }
        if (i < 0) { p.konflikte = gesamtKonflikte(p); break; }
        const kandidaten = zuege(p, i);
        if (!kandidaten.length) continue;
        let beste = [];
        let besteDelta = Infinity;
        const rauschen = zufall.naechste() < 0.03;
        for (const zug of kandidaten) {
          const zielSlot = zug.art === 't' ? p.pos[zug.j] : zug.d * p.H + p.laenge[p.items[i].c * p.T + zug.d];
          const { delta, r } = konfliktDelta(p, i, zug);
          r.zurueck();
          const istTabu = tabu[i * p.NS + zielSlot] > iter && p.konflikte + delta >= besteKonflikte;
          if (istTabu && !rauschen) continue;
          if (delta < besteDelta) { besteDelta = delta; beste = [zug]; } else if (delta === besteDelta) beste.push(zug);
        }
        if (rauschen) { beste = [zufall.auswahl(kandidaten)]; }
        if (!beste.length) continue;
        const zug = zufall.auswahl(beste);
        const alterSlot = p.pos[i];
        const { delta } = konfliktDelta(p, i, zug);
        p.konflikte += delta;
        tabu[i * p.NS + alterSlot] = iter + 7 + Math.floor(zufall.naechste() * 5);
        if (p.konflikte < besteKonflikte) { besteKonflikte = p.konflikte; ohneVerbesserung = 0; } else ohneVerbesserung++;
      }
      statistik.iterationenKonflikte = iter;
    }

    return {
      lauf,
      erschoepft: () => iter >= maxIter || (ohneVerbesserung > 50 * n && p.konflikte > 0),
      anteil: () => Math.min(1, iter / maxIter),
    };
  }

  /**
   * Erzwingt Konfliktfreiheit: konfliktbehaftete Stunden bekommen eine andere
   * qualifizierte, freie Lehrkraft (zählt in K2) oder entfallen; die letzte
   * Stunde des Tages rückt in die Lücke (H12 bleibt gewahrt).
   */
  function repariere(p, statistik) {
    const { items, NS, ix } = p;
    p.konflikte = gesamtKonflikte(p);
    let schutz = items.length * 4 + 100;
    while (p.konflikte > 0 && schutz-- > 0) {
      const i = items.findIndex((it, k) => p.pos[k] >= 0 && (p.occT[it.t * NS + p.pos[k]] > 1 || gesperrtWert(p, k, p.pos[k]) > 0
        || (it.typ >= 0 && p.useTyp[it.typ * NS + p.pos[k]] > p.kapTyp[it.typ * NS + p.pos[k]])));
      if (i < 0) break;
      const it = items[i];
      const s = p.pos[i];
      const k = p.K[it.c];
      const fachId = p.F[it.f].id;
      // Raumproblem lässt sich nicht durch eine andere Lehrkraft lösen
      const raumProblem = it.typ >= 0 && p.useTyp[it.typ * NS + s] > p.kapTyp[it.typ * NS + s];
      let ersatz = -1;
      if (!raumProblem && p.heimatGesperrt[it.c * NS + s] === 0) {
        p.L.forEach((l, t) => {
          if (ersatz >= 0 || t === it.t) return;
          if (p.occT[t * NS + s] === 0 && !p.gesperrt[t * NS + s] && ix.istQualifiziert(l.id, fachId, k.stufe)
            && p.stundenJeLehrkraft[t] < Math.min(l.maxStunden, p.freieSlots[t])) ersatz = t;
        });
      }
      if (ersatz >= 0) {
        loese(p, i);
        it.t = ersatz;
        it.ersatz = ix.zuordnungVon(k.id, fachId).haupt !== p.L[ersatz].id;
        setze(p, i, s);
        statistik.ersetzt = (statistik.ersetzt || 0) + 1;
      } else {
        entferne(p, i, raumProblem ? 'kein passender Raum frei' : 'keine konfliktfreie Platzierung (Lehrkraft belegt oder gesperrt)');
      }
      p.konflikte = gesamtKonflikte(p);
    }
  }

  /** Entfernt Stunde i; die letzte Stunde ihres Tages rückt in die Lücke. */
  function entferne(p, i, grund) {
    const it = p.items[i];
    const s = p.pos[i];
    const d = Math.floor(s / p.H);
    const letzterSlot = d * p.H + p.laenge[it.c * p.T + d] - 1;
    loese(p, i);
    it.entfernt = true;
    if (s !== letzterSlot) {
      const j = p.grid[it.c * p.NS + letzterSlot];
      loese(p, j);
      setze(p, j, s);
    }
    p.laenge[it.c * p.T + d]--;
    ausfallEintragen(p, i, grund);
  }

  function ausfallEintragen(p, i, grund) {
    const it = p.items[i];
    const klasse = p.K[it.c].id;
    const fach = p.F[it.f].id;
    const vorhanden = p.ausfall.find((a) => a.klasse === klasse && a.fach === fach && a.grund === grund);
    if (vorhanden) vorhanden.stunden++;
    else p.ausfall.push({ klasse, fach, stunden: 1, grund });
  }

  /* ================= Nachoptimierung (Simulated Annealing) ============= */

  function annealing(p, zufall, iterationenVorgabe, statistik) {
    const { T, H, K, L, F, g, items } = p;
    const nF = F.length;
    const aktiv = items.map((it, i) => (it.entfernt ? -1 : i)).filter((i) => i >= 0);
    const n = aktiv.length;
    const maxIter = iterationenVorgabe ?? Math.min(4000000, Math.max(50000, n * 3000)); // fest ⇒ reproduzierbar
    const gesamtJeLehrkraft = new Float64Array(L.length);
    for (const i of aktiv) gesamtJeLehrkraft[items[i].t]++;
    const zielEnde = K.map((_, c) => Math.ceil(p.itemsJeKlasse[c].filter((i) => !items[i].entfernt).length / T));
    // Gewünschte Doppelstunden je Klasse und Fach
    const gewuenscht = new Int16Array(K.length * nF);
    K.forEach((k, c) => k.stundentafel.forEach((e) => {
      const f = p.fIdx.get(e.fach);
      if (e.doppelt && F[f].blockbar) gewuenscht[c * nF + f] = Math.floor(e.stunden / 2);
    }));
    const paare = new Int16Array(K.length * nF * T);
    const cd = new Float64Array(K.length * T);
    const w3 = new Float64Array(K.length);
    const td = new Float64Array(L.length * T);

    /** Kosten eines Klassentags (W1, W4, W5, W6) und Doppelstunden-Paare des Tages. */
    function klassentag(c, d) {
      const len = p.laenge[c * T + d];
      const basis = c * p.NS + d * H;
      let k = g.W1 * Math.max(0, len - zielEnde[c]);
      let w4 = 0;
      let w5 = 0;
      let w6 = 0;
      let letzterRaum = -2;
      for (let f = 0; f < nF; f++) paare[(c * nF + f) * T + d] = 0;
      for (let h = 0; h < len; h++) {
        const it = items[p.grid[basis + h]];
        if (p.hauptfach[it.f] && p.nachmittag[h]) w4++;
        if (p.sport[it.f] && p.nachPause[h]) w4++;
        const raum = it.typ;
        if (h > 0 && raum !== letzterRaum) w6++;
        letzterRaum = raum;
        // Läufe desselben Fachs
        const vorher = h > 0 ? items[p.grid[basis + h - 1]].f : -1;
        if (vorher !== it.f) {
          let laenge = 1;
          while (h + laenge < len && items[p.grid[basis + h + laenge]].f === it.f) laenge++;
          w5 += Math.max(0, laenge - p.blockMax[it.f]);
          // Doppelstunden in diesem Lauf (ab erlaubtem Beginn, nicht überlappend)
          for (let x = h; x + 1 < h + laenge;) {
            if (p.doppelStart[x]) { paare[(c * nF + it.f) * T + d]++; x += 2; } else x++;
          }
        }
      }
      // weitere Blöcke desselben Fachs am Tag
      const bloecke = new Map();
      for (let h = 0; h < len; h++) {
        const f = items[p.grid[basis + h]].f;
        if (h === 0 || items[p.grid[basis + h - 1]].f !== f) bloecke.set(f, (bloecke.get(f) || 0) + 1);
      }
      for (const b of bloecke.values()) w5 += b - 1;
      return k + g.W4 * w4 + g.W5 * w5 + g.W6 * w6;
    }
    function w3Klasse(c) {
      let fehlt = 0;
      for (let f = 0; f < nF; f++) {
        const wunsch = gewuenscht[c * nF + f];
        if (!wunsch) continue;
        let ist = 0;
        for (let d = 0; d < T; d++) ist += paare[(c * nF + f) * T + d];
        fehlt += Math.max(0, wunsch - ist);
      }
      return g.W3 * fehlt;
    }
    function lehrertag(t, d) {
      const basis = t * p.NS + d * H;
      let erste = -1;
      let letzte = -1;
      let anzahl = 0;
      for (let h = 0; h < H; h++) if (p.occT[basis + h] > 0) { if (erste < 0) erste = h; letzte = h; anzahl++; }
      const luecken = anzahl ? letzte - erste + 1 - anzahl : 0;
      return g.W2 * luecken + g.W7 * Math.abs(anzahl - gesamtJeLehrkraft[t] / T);
    }

    let summe = 0;
    for (let c = 0; c < K.length; c++) { for (let d = 0; d < T; d++) { cd[c * T + d] = klassentag(c, d); summe += cd[c * T + d]; } }
    for (let c = 0; c < K.length; c++) { w3[c] = w3Klasse(c); summe += w3[c]; }
    for (let t = 0; t < L.length; t++) for (let d = 0; d < T; d++) { td[t * T + d] = lehrertag(t, d); summe += td[t * T + d]; }

    let iter = 0;
    let beste = summe;
    let besteStand = sichere();
    // Starttemperatur aus der mittleren Verschlechterung zufälliger Züge
    let t0 = 1;
    {
      let s = 0;
      let m = 0;
      for (let x = 0; x < 300 && n > 1; x++) {
        const r = versuch(true);
        if (r > 0) { s += r; m++; }
      }
      t0 = m ? (s / m) * 0.6 : 1;
    }
    const tEnde = 0.02;

    function sichere() {
      return { pos: p.pos.slice(), laenge: p.laenge.slice(), lehrer: items.map((it) => it.t) };
    }

    /** Ein zufälliger Zug; mit nurMessen wird er immer zurückgenommen. Liefert das Kosten-Delta (oder NaN). */
    function versuch(nurMessen, temperatur = 1) {
      const i = aktiv[Math.floor(zufall.naechste() * n)];
      const it = items[i];
      let zug;
      if (istLetzte(p, i) && zufall.naechste() < 0.15) {
        const d = Math.floor(zufall.naechste() * T);
        if (d === Math.floor(p.pos[i] / H) || p.laenge[it.c * T + d] >= H) return NaN;
        zug = { art: 'p', d };
      } else {
        const liste = p.itemsJeKlasse[it.c];
        const j = liste[Math.floor(zufall.naechste() * liste.length)];
        if (j === i || p.pos[j] < 0) return NaN;
        if (items[j].t === it.t && items[j].f === it.f) return NaN;
        zug = { art: 't', j };
      }
      const tageVorher = [Math.floor(p.pos[i] / H)];
      if (zug.art === 't') tageVorher.push(Math.floor(p.pos[zug.j] / H));
      else tageVorher.push(zug.d);
      const { delta: dk, r } = konfliktDelta(p, i, zug);
      if (dk > 0) { r.zurueck(); return NaN; }
      // betroffene Klassentage und Lehrertage
      const c = it.c;
      const tage = [...new Set(tageVorher)];
      const lehrer = [...new Set(r.idx.map((x) => items[x].t))];
      const alt = [];
      let neu = 0;
      let vorher = 0;
      for (const d of tage) { alt.push(['cd', c * T + d, cd[c * T + d]]); vorher += cd[c * T + d]; cd[c * T + d] = klassentag(c, d); neu += cd[c * T + d]; }
      alt.push(['w3', c, w3[c]]); vorher += w3[c]; w3[c] = w3Klasse(c); neu += w3[c];
      for (const t of lehrer) for (const d of tage) { alt.push(['td', t * T + d, td[t * T + d]]); vorher += td[t * T + d]; td[t * T + d] = lehrertag(t, d); neu += td[t * T + d]; }
      const delta = neu - vorher;
      const annehmen = !nurMessen && (delta <= 1e-9 || zufall.naechste() < Math.exp(-delta / temperatur));
      if (!annehmen) {
        r.zurueck();
        for (const [art, k, v] of alt) (art === 'cd' ? cd : art === 'w3' ? w3 : td)[k] = v;
        // Paare der betroffenen Tage wiederherstellen
        for (const d of tage) klassentag(c, d);
        return delta;
      }
      summe += delta;
      if (summe < beste - 1e-9) { beste = summe; besteStand = sichere(); }
      return delta;
    }

    function lauf(schritte) {
      for (let x = 0; x < schritte && iter < maxIter && n > 1; x++, iter++) {
        const temperatur = t0 * Math.pow(tEnde / t0, iter / maxIter);
        versuch(false, temperatur);
      }
      statistik.iterationenOptimierung = iter;
    }

    /** Stellt den besten gefundenen Stand wieder her. */
    function stelleBesteHer() {
      // alles lösen, dann besten Stand setzen
      for (const i of aktiv) if (p.pos[i] >= 0) loese(p, i);
      p.laenge.set(besteStand.laenge);
      items.forEach((it, i) => { it.t = besteStand.lehrer[i]; });
      for (const i of aktiv) setze(p, i, besteStand.pos[i]);
      p.konflikte = gesamtKonflikte(p);
    }

    return {
      lauf,
      fertig: () => iter >= maxIter || n <= 1,
      anteil: () => (maxIter ? Math.min(1, iter / maxIter) : 1),
      aktuell: () => summe,
      beste: stelleBesteHer,
    };
  }

  /* ============================ Abschluss ============================= */

  function abschluss(z, p, zufall, statistik) {
    const { ix, T, H, NS, K, L, F, items } = p;
    // Sicherheitsnetz: Konflikte (sollten 0 sein) erzwungen beseitigen
    if (gesamtKonflikte(p) > 0) repariere(p, statistik);

    // 1. Räume je Slot: Fachräume per Zuordnung (größte Klasse → kleinster passender Raum)
    const raumVon = new Array(items.length).fill(null);
    let raumFehler = true;
    let schutz = items.length + 10;
    while (raumFehler && schutz-- > 0) {
      raumFehler = false;
      for (let s = 0; s < NS && !raumFehler; s++) {
        const d = Math.floor(s / H);
        const h = s % H;
        const belegt = new Set();
        const hier = [];
        for (let c = 0; c < K.length; c++) { const i = p.grid[c * NS + s]; if (i >= 0) hier.push(i); }
        // Heimaträume zuerst
        for (const i of hier) {
          const it = items[i];
          if (it.typ < 0 && K[it.c].heimatraum) { raumVon[i] = K[it.c].heimatraum; belegt.add(K[it.c].heimatraum); }
        }
        const sortiert = hier.filter((i) => items[i].typ >= 0 || !K[items[i].c].heimatraum)
          .sort((a, b) => K[items[b].c].schueler - K[items[a].c].schueler);
        for (const i of sortiert) {
          const it = items[i];
          const kandidaten = it.typ >= 0 ? p.raeumeJeTyp[it.typ]
            : z.raeume.filter((r) => r.typ === 'klassenraum').sort((a, b) => a.kapazitaet - b.kapazitaet);
          const raum = kandidaten.find((r) => !belegt.has(r.id) && r.kapazitaet >= K[it.c].schueler && !ix.raumGesperrt(r.id, ix.tage[d], ix.stunden[h]));
          if (raum) { raumVon[i] = raum.id; belegt.add(raum.id); } else {
            entferne(p, i, 'kein passender Raum frei');
            raumFehler = true;
            break;
          }
        }
      }
      if (raumFehler) {
        if (gesamtKonflikte(p) > 0) repariere(p, statistik);
        raumVon.fill(null);
      }
    }

    // 2. Einträge des Regelplans
    const eintraege = [];
    const eintragVon = new Int32Array(items.length).fill(-1);
    K.forEach((k, c) => {
      for (let d = 0; d < T; d++) {
        for (let h = 0; h < p.laenge[c * T + d]; h++) {
          const i = p.grid[c * NS + d * H + h];
          const it = items[i];
          eintragVon[i] = eintraege.length;
          eintraege.push({ klasse: k.id, fach: F[it.f].id, lehrkraefte: [L[it.t].id], raum: raumVon[i], tag: ix.tage[d], stunde: ix.stunden[h], status: 'regulaer' });
        }
      }
    });

    // 3. Zweitbesetzungen
    if (p.e.zweitbesetzungErlaubt) zweitbesetzung(p, eintraege, zufall);

    // 4. Pausenaufsichten
    const aufsichten = verteileAufsichten(p, eintraege);

    const plan = { stunden: eintraege, aufsichten };
    const verstoesse = Regeln.pruefeHart(z, plan);
    const bewertung = Kosten.bewerte(z, plan);
    return {
      plan: { regelplan: eintraege, aufsichten },
      bericht: {
        vektor: bewertung.vektor,
        bewertung,
        verstoesse,
        vorpruefung: p.vorpruefung,
        untereSchrankeK1: p.untereSchrankeK1,
        ausfallMinimalNachgewiesen: bewertung.vektor[0] === p.untereSchrankeK1,
        ausfall: p.ausfall,
        warnungen: p.warnungen,
      },
    };
  }

  /** Vergibt freie Kontingente als Zweitbesetzung (§6.5): Festzuordnungen zuerst, dann nach W9/W10. */
  function zweitbesetzung(p, eintraege, zufall) {
    const { ix, L, K, NS, H, z } = p;
    const maxL = p.e.maxLehrkraefteProKlasseUndSlot;
    if (maxL < 2) return;
    const slotVon = (e) => ix.tagIndex.get(e.tag) * H + ix.stunden.indexOf(e.stunde);
    const occ = p.occT; // Hauptunterricht ist bereits eingetragen
    const rest = L.map((l, t) => Math.max(0, Math.min(l.sollStunden - ix.reserve(l), l.maxStunden) - p.stundenJeLehrkraft[t]));
    const frei = (t, s) => occ[t * NS + s] === 0 && !p.gesperrt[t * NS + s];
    const kandidat = (e) => Index.STATUS.fachunterricht(e) && e.lehrkraefte.length < maxL;
    const vergib = (t, e) => {
      e.lehrkraefte.push(L[t].id);
      occ[t * NS + slotVon(e)]++;
      rest[t]--;
    };

    // a) feste Zweit-Zuordnungen
    for (const zu of z.zuordnungen) {
      if (zu.rolle !== 'zweit') continue;
      const t = p.lIdx.get(zu.lehrkraft);
      for (const e of eintraege) {
        if (rest[t] <= 0) break;
        if (e.klasse === zu.klasse && e.fach === zu.fach && kandidat(e) && frei(t, slotVon(e)) && !e.lehrkraefte.includes(L[t].id)) vergib(t, e);
      }
    }

    // b) übrige freie Kontingente nach Priorität (W9) und Beständigkeit (W10)
    const sch = K.map((k) => k.schueler);
    const stu = K.map((k) => k.stufe);
    const norm = (x, a, b) => (b > a ? (x - a) / (b - a) : 0.5);
    const [sMin, sMax, tMin, tMax] = [Math.min(...sch), Math.max(...sch), Math.min(...stu), Math.max(...stu)];
    const klasseVon = new Map(K.map((k) => [k.id, k]));
    const prio = (e) => {
      const k = klasseVon.get(e.klasse);
      return (norm(k.schueler, sMin, sMax) + (1 - norm(k.stufe, tMin, tMax)) + 1 / Math.max(1, ix.anzahlQualifizierte(e.fach, k.stufe))) / 3;
    };
    const prioVon = eintraege.map(prio);
    const reihenfolge = L.map((_, t) => t).filter((t) => rest[t] > 0).sort((a, b) => rest[b] - rest[a] || a - b);
    for (const t of reihenfolge) {
      const schonBei = new Set(); // Klasse|Fach, in denen t bereits Zweitbesetzung ist
      eintraege.forEach((e) => { if (e.lehrkraefte[1] === L[t].id) schonBei.add(e.klasse + '|' + e.fach); });
      while (rest[t] > 0) {
        let beste = -1;
        let besterWert = -Infinity;
        eintraege.forEach((e, k) => {
          if (!kandidat(e) || e.lehrkraefte.includes(L[t].id)) return;
          const s = slotVon(e);
          if (!frei(t, s)) return;
          const d = Math.floor(s / H);
          const h = s % H;
          // angrenzend an eigene Stunden desselben Tags (weniger Leerstunden, W2)
          const angrenzend = (h > 0 && occ[t * NS + d * H + h - 1] > 0) || (h + 1 < H && occ[t * NS + d * H + h + 1] > 0);
          const wert = prioVon[k] + (schonBei.has(e.klasse + '|' + e.fach) ? 1 : 0) + (angrenzend ? 0.3 : 0) + zufall.naechste() * 1e-6;
          if (wert > besterWert) { besterWert = wert; beste = k; }
        });
        if (beste < 0) break;
        vergib(t, eintraege[beste]);
        schonBei.add(eintraege[beste].klasse + '|' + eintraege[beste].fach);
      }
    }
  }

  /** Verteilt die Pausenaufsichten als Minimalkosten-Fluss (K1A, dann W12). */
  function verteileAufsichten(p, eintraege) {
    const { ix, L, T, H } = p;
    const pausen = ix.pausen.filter((pa) => pa.aufsichten > 0);
    if (!pausen.length) return [];
    const P = pausen.length;
    // Anwesenheit und Stunden je Lehrkraft und Tag; Bedarf je Tag und Pause
    const stundenVon = L.map(() => Array.from({ length: T }, () => new Set()));
    const klassenStunde = new Set();
    for (const e of eintraege) {
      const d = ix.tagIndex.get(e.tag);
      klassenStunde.add(d + '|' + e.stunde);
      for (const id of e.lehrkraefte) stundenVon[p.lIdx.get(id)][d].add(e.stunde);
    }
    const q = 0;
    const s = 1;
    const kL = (t) => 2 + t;
    const kLT = (t, d) => 2 + L.length + t * T + d;
    const kTP = (d, x) => 2 + L.length + L.length * T + d * P + x;
    const g = Fluss.graph(2 + L.length + L.length * T + T * P);
    const kanten = [];
    L.forEach((l, t) => {
      if (l.aufsichtenProWoche > 0) Fluss.kante(g, q, kL(t), l.aufsichtenProWoche, 0);
      for (let d = 0; d < T; d++) {
        if (!stundenVon[t][d].size) continue; // H13: nur an Unterrichtstagen
        Fluss.kante(g, kL(t), kLT(t, d), 1, 0);
        Fluss.kante(g, kL(t), kLT(t, d), P, p.g.W12 || 1); // weitere Aufsichten am selben Tag
        pausen.forEach((pa, x) => {
          const erste = pa.vorStunde === ix.stunden[0];
          const angrenzendeStunden = erste ? [pa.vorStunde] : [pa.vorStunde - 1, pa.vorStunde];
          if (angrenzendeStunden.some((st) => ix.lehrkraftGesperrt(l.id, ix.tage[d], st))) return; // H13
          const angrenzend = angrenzendeStunden.some((st) => stundenVon[t][d].has(st));
          kanten.push({ t, d, pa, e: Fluss.kante(g, kLT(t, d), kTP(d, x), 1, angrenzend ? 0 : (p.g.W12 || 1)) });
        });
      }
    });
    for (let d = 0; d < T; d++) {
      pausen.forEach((pa, x) => {
        if (klassenStunde.has(d + '|' + pa.vorStunde)) Fluss.kante(g, kTP(d, x), s, pa.aufsichten, 0);
      });
    }
    Fluss.minKostenMaxFluss(g, q, s);
    return kanten.filter((k) => Fluss.flussVon(g, k.e) > 0)
      .map((k) => ({ tag: ix.tage[k.d], vorStunde: k.pa.vorStunde, lehrkraft: L[k.t].id }))
      .sort((a, b) => ix.tagIndex.get(a.tag) - ix.tagIndex.get(b.tag) || a.vorStunde - b.vorStunde || a.lehrkraft.localeCompare(b.lehrkraft));
  }

  return { starte, plane };
})();
