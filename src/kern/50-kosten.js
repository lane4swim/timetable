/* ==========================================================================
 * Modul Kosten
 * Bewertet einen Plan mit dem lexikografischen Kostenvektor
 * (K1, K1A, K2, K3, K4, K5, K6) aus Spezifikation §3. K6 ist die gewichtete
 * Summe der weichen Regeln W1–W13 (§4). Jeder Kostenanteil wird mit
 * Einzelposten begründet (§9 Nachvollziehbarkeit).
 * ========================================================================== */
const Kosten = (() => {
  'use strict';

  const ZIELE = Object.freeze(['K1', 'K1A', 'K2', 'K3', 'K4', 'K5', 'K6']);
  const ZIELTITEL = Object.freeze({
    K1: 'Unterrichtsausfall',
    K1A: 'unbesetzte Pausenaufsichten',
    K2: 'Stunden nicht durch die eigene Lehrkraft',
    K3: 'fachfremd erteilte Stunden',
    K4: 'Doppelbetreuung und Aufteilung',
    K5: 'ungenutztes Kontingent trotz möglicher Zweitbesetzung',
    K6: 'Planqualität (weiche Regeln)',
  });
  const WEICH = Object.freeze(['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12', 'W13']);
  const WTITEL = Object.freeze({
    W1: 'kompakter Schultag der Klassen',
    W2: 'Leerstunden bei Lehrkräften',
    W3: 'Doppelstunden wie gewünscht',
    W4: 'Hauptfächer vormittags, Sport nicht direkt nach der Pause',
    W5: 'gleichmäßige Verteilung eines Fachs',
    W6: 'wenige Raumwechsel, Heimatraum',
    W7: 'gleichmäßige Tageslast der Lehrkräfte',
    W8: 'Mindeststunden unterschritten',
    W9: 'Zweitbesetzung gezielt eingesetzt',
    W10: 'beständige Zweitbesetzung',
    W11: 'Aufsichtssoll erfüllt',
    W12: 'Aufsicht angrenzend an eigenen Unterricht',
    W13: 'Fach am Tagesende wie gewünscht',
  });

  const S = Index.schluessel;
  const rund = (x) => Math.round(x * 100) / 100;

  /**
   * @param {object} z Zustand
   * @param {{stunden?: object[], aufsichten?: object[]}} [plan] Standard: Regelplan
   * @param {{datum?: string, mitPosten?: boolean}} [optionen]
   *        datum: Tagesplan (Wochenziele K5, W7, W8, W11 entfallen)
   * @returns {{vektor: number[], ziele: object, weich: object}}
   */
  function bewerte(z, plan, optionen = {}) {
    const ix = Index.erstelle(z);
    const stunden = plan?.stunden ?? z.plan.regelplan;
    const aufsichten = plan?.aufsichten ?? z.plan.aufsichten;
    const woche = !optionen.datum;
    const mitPosten = optionen.mitPosten !== false;
    const n = ix.name;
    const e = ix.einstellungen;

    const ziele = Object.fromEntries(ZIELE.map((k) => [k, { titel: ZIELTITEL[k], wert: 0, posten: [] }]));
    const weich = Object.fromEntries(WEICH.map((w) => [w, { titel: WTITEL[w], anzahl: 0, gewicht: e.gewichte[w] ?? 0, beitrag: 0, posten: [] }]));
    const ziel = (k, menge, text) => {
      if (!menge) return;
      ziele[k].wert += menge;
      if (mitPosten) ziele[k].posten.push({ menge: rund(menge), text });
    };
    const w = (k, menge, text) => {
      if (!menge) return;
      weich[k].anzahl += menge;
      if (mitPosten) weich[k].posten.push({ menge: rund(menge), text });
    };

    const lehrer = Regeln.lehrkraftStunden(stunden);
    const proKlasseTag = Regeln.gruppiere(stunden, (s) => (Index.STATUS.belegt(s) ? S(s.klasse, s.tag) : null));
    const klassenSlot = new Set(stunden.filter(Index.STATUS.belegt).map((s) => S(s.tag, s.stunde)));

    /* ---------- K1: Unterrichtsausfall ---------- */
    const abgedeckt = new Map();
    for (const s of stunden) if (s.fach && Index.STATUS.abgedeckt(s)) abgedeckt.set(S(s.klasse, s.fach), (abgedeckt.get(S(s.klasse, s.fach)) || 0) + 1);
    for (const k of z.klassen) {
      for (const t of k.stundentafel) {
        const ist = abgedeckt.get(S(k.id, t.fach)) || 0;
        const fehlt = woche ? Math.max(0, t.stunden - ist) : 0;
        ziel('K1', fehlt, `${n.klasse(k.id)} ${n.fach(t.fach)}: ${fehlt} von ${t.stunden} Stunden fallen aus`);
      }
    }
    if (!woche) {
      // Im Tagesplan zählen ausdrücklich entfallene Stunden und Aufsichten
      for (const s of stunden) {
        if (!Index.STATUS.abgedeckt(s)) ziel('K1', 1, `${n.klasse(s.klasse)} ${n.slot(s.tag, s.stunde)} Stunde: ${s.status === 'aufsicht' ? 'nur Aufsicht' : 'entfällt'}`);
      }
    }

    /* ---------- K1A: unbesetzte Pausenaufsichten ---------- */
    const besetzt = new Map();
    for (const a of aufsichten) {
      const k = S(a.tag, a.vorStunde);
      if (!besetzt.has(k)) besetzt.set(k, new Set());
      besetzt.get(k).add(a.lehrkraft);
    }
    const tage = woche ? ix.tage : [...new Set(stunden.map((s) => s.tag))];
    for (const tag of tage) {
      for (const p of ix.pausen) {
        if (!p.aufsichten) continue;
        // Bedarf nur, wenn nach der Pause Schüler:innen da sind (Annahme: mindestens eine Klasse hat diese Stunde)
        if (!klassenSlot.has(S(tag, p.vorStunde))) continue;
        const fehlt = Math.max(0, p.aufsichten - (besetzt.get(S(tag, p.vorStunde))?.size || 0));
        ziel('K1A', fehlt, `${n.pause(tag, p.vorStunde)}: ${fehlt} von ${p.aufsichten} Aufsichten unbesetzt`);
      }
    }

    /* ---------- K2, K3, K4: je Stunde ---------- */
    for (const s of stunden) {
      const wo = `${n.klasse(s.klasse)} ${n.slot(s.tag, s.stunde)} Stunde ${n.fach(s.fach)}`;
      const haupt = s.lehrkraefte?.[0];
      if (haupt && s.fach && (Index.STATUS.fachunterricht(s) || s.status === 'doppeltBetreut')) {
        const zu = ix.zuordnungVon(s.klasse, s.fach);
        if (zu.haupt !== haupt && !zu.zweit.includes(haupt)) {
          const klasse = ix.klassen.get(s.klasse);
          const art = klasse?.klassenlehrkraft === haupt ? 'Klassenlehrkraft'
            : ix.lehrkraefteDerKlasse.get(s.klasse)?.has(haupt) ? 'Lehrkraft der Klasse'
              : ix.istQualifiziert(haupt, s.fach, klasse?.stufe) ? 'qualifizierte Lehrkraft' : 'Notfalleinsatz';
          ziel('K2', 1, `${wo}: ${n.lehrkraft(haupt)} (${art}) statt ${zu.haupt ? n.lehrkraft(zu.haupt) : 'ohne Festzuordnung'}`);
        }
      }
      if (haupt && s.fach && Index.STATUS.fachunterricht(s) && !ix.istQualifiziert(haupt, s.fach, ix.klassen.get(s.klasse)?.stufe)) {
        ziel('K3', 1, `${wo}: ${n.lehrkraft(haupt)} unterrichtet fachfremd`);
      }
      if (s.status === 'doppeltBetreut') ziel('K4', 1, `${wo}: Doppelbetreuung mit ${n.klasse(s.mitKlasse)}`);
      if (s.status === 'aufgeteilt') ziel('K4', e.gewichtAufteilung, `${wo}: Klasse aufgeteilt (Gewicht ${e.gewichtAufteilung})`);
    }

    /* ---------- K5: ungenutztes Kontingent trotz möglicher Zweitbesetzung ---------- */
    if (woche && e.zweitbesetzungErlaubt) {
      // Slots mit Unterricht, in denen noch eine Zweitbesetzung Platz hat (H10)
      const freiFuerZweit = new Set(stunden
        .filter((s) => Index.STATUS.fachunterricht(s) && (s.lehrkraefte?.length || 0) < e.maxLehrkraefteProKlasseUndSlot)
        .map((s) => S(s.tag, s.stunde)));
      for (const l of z.lehrkraefte) {
        const info = lehrer.get(l.id);
        const ist = info?.slots.size || 0;
        const luecke = Math.max(0, Math.min(l.sollStunden - ix.reserve(l), l.maxStunden) - ist);
        if (!luecke) continue;
        let moeglich = 0;
        for (const slot of freiFuerZweit) {
          const [tag, st] = slot.split('|');
          if (!info?.slots.has(slot) && !ix.lehrkraftGesperrt(l.id, tag, Number(st))) moeglich++;
        }
        const k5 = Math.min(luecke, moeglich);
        ziel('K5', k5, `${n.lehrkraft(l.id)}: ${ist} von ${l.sollStunden} Stunden (Reserve ${ix.reserve(l)}), ${k5} weitere als Zweitbesetzung möglich`);
      }
    }

    /* ---------- W1: kompakter Schultag ---------- */
    const erste = ix.stunden[0];
    const belegteWoche = new Map();
    for (const s of stunden) if (Index.STATUS.belegt(s)) belegteWoche.set(s.klasse, (belegteWoche.get(s.klasse) || 0) + 1);
    for (const [k, idx] of proKlasseTag) {
      const [klasse, tag] = k.split('|');
      const nr = idx.map((i) => stunden[i].stunde);
      const start = Math.min(...nr);
      const ende = Math.max(...nr);
      const spaet = start - erste;
      w('W1', spaet, `${n.klasse(klasse)} beginnt am ${tag} erst zur ${start}. Stunde`);
      if (woche) {
        const zielEnde = erste - 1 + Math.ceil(belegteWoche.get(klasse) / ix.tage.length);
        const lang = Math.max(0, ende - zielEnde);
        w('W1', lang, `${n.klasse(klasse)} endet am ${tag} erst nach der ${ende}. Stunde (Ziel: ${zielEnde}.)`);
      }
    }

    /* ---------- W2, W7, W8: Lehrkräfte ---------- */
    for (const l of z.lehrkraefte) {
      const info = lehrer.get(l.id);
      const ist = info?.slots.size || 0;
      for (const [tag, st] of info?.proTag || []) {
        const luecken = Math.max(...st) - Math.min(...st) + 1 - st.size;
        w('W2', luecken, `${n.lehrkraft(l.id)} hat am ${tag} ${luecken} Leerstunde(n)`);
      }
      if (woche && ist) {
        const proTag = ix.tage.map((t) => info.proTag.get(t)?.size || 0);
        const mittel = ist / ix.tage.length;
        const abweichung = rund(proTag.reduce((s, h) => s + Math.abs(h - mittel), 0));
        w('W7', abweichung, `${n.lehrkraft(l.id)}: Tageslast ${proTag.join('/')} (Mittel ${rund(mittel)})`);
      }
      if (woche) w('W8', Math.max(0, l.minStunden - ist), `${n.lehrkraft(l.id)}: ${ist} Stunden, Mindestens ${l.minStunden}`);
    }

    /* ---------- W3, W5: Doppelstunden und Verteilung ---------- */
    const proKlasseFachTag = Regeln.gruppiere(stunden, (s) => (s.fach && Index.STATUS.abgedeckt(s) ? S(s.klasse, s.fach, s.tag) : null));
    const paare = new Map(); // Klasse|Fach → Anzahl Doppelstunden
    for (const [k, idx] of proKlasseFachTag) {
      const [klasse, fach, tag] = k.split('|');
      const f = ix.faecher.get(fach);
      const folgen = Regeln.laeufe(idx.map((i) => stunden[i].stunde));
      // Doppelstunden: Paare (s, s+1) mit erlaubtem Beginn, nicht überlappend
      let p = 0;
      for (const folge of folgen) {
        for (let i = 0; i + 1 < folge.length;) {
          if (ix.doppelstundenStart.has(folge[i])) { p++; i += 2; } else i++;
        }
      }
      paare.set(S(klasse, fach), (paare.get(S(klasse, fach)) || 0) + p);
      const maxBlock = f?.blockbar ? 2 : 1;
      const zuviel = (folgen.length - 1) + folgen.reduce((s, folge) => s + Math.max(0, folge.length - maxBlock), 0);
      w('W5', zuviel, `${n.klasse(klasse)} hat am ${tag} ${idx.length} Stunden ${n.fach(fach)} in ${folgen.length} Block/Blöcken`);
    }
    if (woche) {
      for (const k of z.klassen) {
        for (const t of k.stundentafel) {
          if (!t.doppelt || !ix.faecher.get(t.fach)?.blockbar) continue;
          const gewuenscht = Math.floor(t.stunden / 2);
          const fehlt = Math.max(0, gewuenscht - (paare.get(S(k.id, t.fach)) || 0));
          w('W3', fehlt, `${n.klasse(k.id)} ${n.fach(t.fach)}: ${fehlt} von ${gewuenscht} gewünschten Doppelstunden fehlen`);
        }
      }
    }

    /* ---------- W13: Fach am Tagesende gewünscht ---------- */
    // Je Stunde eines solchen Fachs: Zahl der Stunden anderer Fächer, die an diesem Tag danach folgen
    for (const [k, idx] of proKlasseTag) {
      const [klasse, tag] = k.split('|');
      const tafel = ix.tafel.get(klasse);
      const folge = idx.map((i) => stunden[i]).sort((a, b) => a.stunde - b.stunde);
      folge.forEach((s, j) => {
        if (!s.fach || !Index.STATUS.abgedeckt(s) || !tafel?.get(s.fach)?.tagesende) return;
        const danach = folge.slice(j + 1).filter((x) => x.fach !== s.fach).length;
        w('W13', danach, `${n.klasse(klasse)} ${n.slot(tag, s.stunde)} Stunde ${n.fach(s.fach)}: ${danach} Stunde(n) danach (Tagesende gewünscht)`);
      });
    }

    /* ---------- W4: Hauptfächer vormittags, Sport nicht nach der Pause ---------- */
    for (const s of stunden) {
      if (!s.fach || !Index.STATUS.abgedeckt(s)) continue;
      const f = ix.faecher.get(s.fach);
      if (f?.hauptfach && !ix.istVormittag(s.stunde)) w('W4', 1, `${n.klasse(s.klasse)} ${n.slot(s.tag, s.stunde)} Stunde: Hauptfach ${n.fach(s.fach)} am Nachmittag`);
      if (Modell.SONDERRAUMTYPEN.includes(Modell.raumtypSchluessel(f?.raumtyp)) && s.stunde !== erste && ix.pauseVor.has(s.stunde)) {
        w('W4', 1, `${n.klasse(s.klasse)} ${n.slot(s.tag, s.stunde)} Stunde: ${n.fach(s.fach)} direkt nach der Pause`);
      }
    }

    /* ---------- W6: Raumwechsel und Heimatraum ---------- */
    for (const [k, idx] of proKlasseTag) {
      const [klasse, tag] = k.split('|');
      const heimat = ix.klassen.get(klasse)?.heimatraum;
      const folge = idx.map((i) => stunden[i]).filter((s) => s.raum && Index.STATUS.mitRaum(s)).sort((a, b) => a.stunde - b.stunde);
      let wechsel = 0;
      for (let i = 1; i < folge.length; i++) if (folge[i].raum !== folge[i - 1].raum) wechsel++;
      w('W6', wechsel, `${n.klasse(klasse)} wechselt am ${tag} ${wechsel}-mal den Raum`);
      for (const s of folge) {
        if (heimat && s.raum !== heimat && s.fach && !Modell.raumtypSchluessel(ix.faecher.get(s.fach)?.raumtyp)) {
          w('W6', 1, `${n.klasse(klasse)} ${n.slot(tag, s.stunde)} Stunde ${n.fach(s.fach)} in ${n.raum(s.raum)} statt im Heimatraum`);
        }
      }
    }

    /* ---------- W9, W10: Zweitbesetzung ---------- */
    const zweit = stunden.filter((s) => (s.lehrkraefte?.length || 0) > 1 && Index.STATUS.fachunterricht(s));
    if (zweit.length) {
      const sch = z.klassen.map((k) => k.schueler);
      const stu = z.klassen.map((k) => k.stufe);
      const norm = (x, min, max) => (max > min ? (x - min) / (max - min) : 0.5); // gleiche Werte: neutral
      const [sMin, sMax, tMin, tMax] = [Math.min(...sch), Math.max(...sch), Math.min(...stu), Math.max(...stu)];
      const jeKlasseFach = new Map();
      for (const s of zweit) {
        const k = ix.klassen.get(s.klasse);
        const knapp = s.fach ? 1 / Math.max(1, ix.anzahlQualifizierte(s.fach, k.stufe)) : 0;
        const prio = (norm(k.schueler, sMin, sMax) + (1 - norm(k.stufe, tMin, tMax)) + knapp) / 3;
        w('W9', rund(1 - prio), `${n.klasse(s.klasse)} ${n.slot(s.tag, s.stunde)} Stunde: Zweitbesetzung ${n.lehrkraft(s.lehrkraefte[1])} (Priorität ${rund(prio)})`);
        const kf = S(s.klasse, s.fach);
        if (!jeKlasseFach.has(kf)) jeKlasseFach.set(kf, new Set());
        jeKlasseFach.get(kf).add(s.lehrkraefte[1]);
      }
      for (const [kf, l] of jeKlasseFach) {
        const [klasse, fach] = kf.split('|');
        w('W10', l.size - 1, `${n.klasse(klasse)} ${n.fach(fach)}: ${l.size} verschiedene Zweitlehrkräfte`);
      }
    }

    /* ---------- W11, W12: Aufsichten ---------- */
    const aufsichtJe = Regeln.gruppiere(aufsichten, (a) => a.lehrkraft);
    if (woche) {
      for (const l of z.lehrkraefte) {
        const ist = aufsichtJe.get(l.id)?.length || 0;
        w('W11', Math.max(0, l.aufsichtenProWoche - ist), `${n.lehrkraft(l.id)}: ${ist} von ${l.aufsichtenProWoche} Aufsichten`);
      }
    }
    for (const a of aufsichten) {
      const st = lehrer.get(a.lehrkraft)?.proTag.get(a.tag) || new Set();
      const angrenzend = a.vorStunde === erste ? st.has(erste) : st.has(a.vorStunde - 1) || st.has(a.vorStunde);
      if (!angrenzend) w('W12', 1, `${n.lehrkraft(a.lehrkraft)}: ${n.pause(a.tag, a.vorStunde)} ohne angrenzenden eigenen Unterricht`);
    }
    for (const [k, idx] of Regeln.gruppiere(aufsichten, (a) => S(a.lehrkraft, a.tag))) {
      const [l, tag] = k.split('|');
      w('W12', idx.length - 1, `${n.lehrkraft(l)} hat am ${tag} ${idx.length} Aufsichten`);
    }

    /* ---------- K6 und Ergebnis ---------- */
    for (const k of WEICH) {
      weich[k].anzahl = rund(weich[k].anzahl);
      weich[k].beitrag = rund(weich[k].anzahl * weich[k].gewicht);
      ziele.K6.wert += weich[k].beitrag;
    }
    for (const k of ZIELE) ziele[k].wert = rund(ziele[k].wert);
    return { vektor: ZIELE.map((k) => ziele[k].wert), ziele, weich };
  }

  /** Lexikografischer Vergleich: < 0, wenn a besser (kleiner) ist als b. */
  function vergleiche(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (Math.abs(d) > 1e-9) return d;
    }
    return 0;
  }

  /** Lesbare Kurzform, z. B. „K1 0 · K1A 0 · K2 3 · … · K6 128.5“. */
  function formatiere(vektor) {
    return ZIELE.map((k, i) => `${k} ${vektor[i]}`).join(' · ');
  }

  return { ZIELE, ZIELTITEL, WEICH, WTITEL, bewerte, vergleiche, formatiere };
})();
