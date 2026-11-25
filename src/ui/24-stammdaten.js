/* ==========================================================================
 * Modul StammdatenReiter (Oberfläche, Reiter „Stammdaten“)
 * Tabellen für Lehrkräfte, Fächer, Räume, Klassen, Zeitraster mit Pausen und
 * Schule (§7). Kompakte Eingaben:
 *   Qualifikationen „MA 1–4; DE 5–10“  (Fachkürzel, optional Stufenbereich)
 *   Sperrzeiten     „Fr 5–6; Mo 1“      (Tag, Stunden)
 *   Nachbarräume    „102, 103“          (Raumnamen)
 * Löschen ist gesperrt, solange die Entität referenziert wird (mit Liste).
 * ========================================================================== */
const StammdatenReiter = (() => {
  'use strict';
  let panel = null;
  let sichtbar = () => {};
  let aktiv = 'lehrkraefte';
  const tabellen = {};

  const BEREICHE = [
    ['lehrkraefte', 'Lehrkräfte'], ['faecher', 'Fächer'], ['raeume', 'Räume'], ['klassen', 'Klassen'],
    ['zeitraster', 'Zeitraster und Pausen'], ['schule', 'Schule'],
  ];

  /* ------------------------ Text ↔ Daten ------------------------------ */

  const kuerzelVon = (d, id) => d.faecher.find((f) => f.id === id)?.kuerzel || id;

  function qualiText(z, d) {
    return z.qualifikationen.map((q) => `${kuerzelVon(d, q.fach)} ${q.stufenVon === q.stufenBis ? q.stufenVon : q.stufenVon + '–' + q.stufenBis}`).join('; ');
  }
  function qualiLesen(text, d) {
    const ergebnis = [];
    for (const teil of text.split(';').map((t) => t.trim()).filter(Boolean)) {
      const m = /^(\S+)(?:\s+(\d+)(?:\s*[-–]\s*(\d+))?)?$/.exec(teil);
      if (!m) return `„${teil}“ verstehe ich nicht. Beispiel: MA 1–4; DE 5–10`;
      const fach = d.faecher.find((f) => f.kuerzel.toLowerCase() === m[1].toLowerCase());
      if (!fach) return `Fachkürzel „${m[1]}“ gibt es nicht. Vorhanden: ${d.faecher.map((f) => f.kuerzel).join(', ') || '–'}`;
      const von = m[2] ? Number(m[2]) : 1;
      const bis = m[3] ? Number(m[3]) : m[2] ? von : 13;
      if (von < 1 || bis > 13 || bis < von) return `Stufenbereich bei „${teil}“ muss zwischen 1 und 13 liegen.`;
      ergebnis.push({ fach: fach.id, stufenVon: von, stufenBis: bis });
    }
    return ergebnis;
  }
  function sperrText(z) {
    return (z.gesperrt || []).map((g) => `${g.tag} ${Tabelle.Text.bereiche(g.stunden)}`).join('; ');
  }
  function sperrLesen(text, d) {
    const ergebnis = new Map();
    for (const teil of text.split(';').map((t) => t.trim()).filter(Boolean)) {
      const m = /^(Mo|Di|Mi|Do|Fr)\s+(.+)$/i.exec(teil);
      if (!m) return `„${teil}“ verstehe ich nicht. Beispiel: Fr 5–6; Mo 1`;
      const tag = m[1][0].toUpperCase() + m[1][1].toLowerCase();
      if (!d.zeitraster.tage.includes(tag)) return `${tag} liegt nicht im Zeitraster.`;
      const stunden = Tabelle.Text.zahlen(m[2]);
      if (!stunden || !stunden.length) return `Stunden bei „${teil}“ verstehe ich nicht. Beispiel: 1–2, 5`;
      const nr = d.zeitraster.stunden.map((s) => s.nr);
      const fremd = stunden.filter((s) => !nr.includes(s));
      if (fremd.length) return `Stunde ${fremd.join(', ')} gibt es im Zeitraster nicht.`;
      ergebnis.set(tag, [...new Set([...(ergebnis.get(tag) || []), ...stunden])].sort((a, b) => a - b));
    }
    return [...ergebnis].map(([tag, stunden]) => ({ tag, stunden }));
  }
  const setzeMit = (leser, feld) => (z, roh, d) => {
    const r = leser(String(roh), d);
    if (typeof r === 'string') return r;
    z[feld] = r;
  };

  const eindeutigesKuerzel = (liste, stamm) => {
    for (let n = 1; ; n++) { const k = stamm + n; if (!liste.some((x) => (x.kuerzel || x.name).toLowerCase() === k.toLowerCase())) return k; }
  };
  const neueId = (liste, praefix, stamm) => Kern.Hilfen.neueId(praefix, new Set(liste.map((x) => x.id)), stamm);
  const verweiseAuf = (sammlung) => (d, z) => Kern.Verweise.finde(d, sammlung, z.id);

  /* ----------------------------- Tabellen ----------------------------- */

  function baueTabellen() {
    const lehrerOptionen = (d) => [['', '– keine –'], ...d.lehrkraefte.map((l) => [l.id, `${l.kuerzel} – ${l.name}`])];
    const raumOptionen = (d) => [['', '– keiner –'], ...d.raeume.map((r) => [r.id, `${r.name} (${r.kapazitaet})`])];

    tabellen.lehrkraefte = Tabelle.erstelle({
      id: 'tabelle-lehrkraefte', beschriftung: 'Lehrkräfte', einzahl: 'Lehrkraft', liste: (d) => d.lehrkraefte,
      spalten: [
        { feld: 'name', titel: 'Name', art: 'text', pflicht: true, breite: '12em' },
        { feld: 'kuerzel', titel: 'Kürzel', art: 'text', pflicht: true, max: 12, breite: '5em' },
        { feld: 'qualifikationen', titel: 'Qualifikationen (Fach Stufen)', art: 'text', breite: '14em', platzhalter: 'z. B. MA 1–4; DE 1–4', anzeigen: qualiText, setzen: setzeMit(qualiLesen, 'qualifikationen') },
        { feld: 'sollStunden', titel: 'Soll', art: 'zahl', min: 0, max: 40 },
        { feld: 'minStunden', titel: 'Min', art: 'zahl', min: 0, max: 40 },
        { feld: 'maxStunden', titel: 'Max', art: 'zahl', min: 0, max: 40 },
        { feld: 'aufsichtenProWoche', titel: 'Aufsichten/Woche', art: 'zahl', min: 0, max: 50, ganz: true },
        { feld: 'gesperrt', titel: 'Gesperrt (Tag Stunden)', art: 'text', breite: '10em', platzhalter: 'z. B. Fr 5–6', anzeigen: sperrText, setzen: setzeMit(sperrLesen, 'gesperrt') },
        { feld: 'abwesenheiten', titel: 'Abwesenheiten', art: 'anzeige', anzeigen: (z) => (z.abwesenheiten.length ? `${z.abwesenheiten.length} (Reiter Ausfall)` : '–') },
      ],
      neu: (d) => {
        const kuerzel = eindeutigesKuerzel(d.lehrkraefte, 'NEU');
        const l = { id: neueId(d.lehrkraefte, 'l', kuerzel), name: 'Neue Lehrkraft', kuerzel, qualifikationen: [], sollStunden: 0, minStunden: 0, maxStunden: 0, aufsichtenProWoche: 0, gesperrt: [], abwesenheiten: [] };
        d.lehrkraefte.push(l);
        return l;
      },
      verweise: verweiseAuf('lehrkraefte'),
    });

    tabellen.faecher = Tabelle.erstelle({
      id: 'tabelle-faecher', beschriftung: 'Fächer', einzahl: 'Fach', liste: (d) => d.faecher,
      spalten: [
        { feld: 'name', titel: 'Name', art: 'text', pflicht: true, breite: '12em' },
        { feld: 'kuerzel', titel: 'Kürzel', art: 'text', pflicht: true, max: 12, breite: '5em' },
        { feld: 'raumtyp', titel: 'Benötigter Raumtyp', art: 'text', liste: 'liste-raumtypen', platzhalter: 'Klassenraum', breite: '10em',
          setzen: (z, roh) => { const t = String(roh).trim(); z.raumtyp = t ? t : null; } },
        { feld: 'blockbar', titel: 'Doppelstunden erlaubt', art: 'bool' },
        { feld: 'hauptfach', titel: 'Hauptfach', art: 'bool' },
      ],
      neu: (d) => {
        const kuerzel = eindeutigesKuerzel(d.faecher, 'F');
        const f = { id: neueId(d.faecher, 'f', kuerzel), name: 'Neues Fach', kuerzel, raumtyp: null, blockbar: true, hauptfach: false };
        d.faecher.push(f);
        return f;
      },
      verweise: verweiseAuf('faecher'),
    });

    tabellen.raeume = Tabelle.erstelle({
      id: 'tabelle-raeume', beschriftung: 'Räume', einzahl: 'Raum', liste: (d) => d.raeume,
      spalten: [
        { feld: 'name', titel: 'Name', art: 'text', pflicht: true, breite: '8em' },
        { feld: 'typ', titel: 'Typ', art: 'wahl', optionen: () => [['klassenraum', 'Klassenraum'], ['fachraum', 'Fachraum'], ['turnhalle', 'Turnhalle'], ['schwimmhalle', 'Schwimmhalle']],
          setzen: (z, roh) => {
            z.typ = roh;
            if (roh === 'fachraum' && !z.fachraumtyp) z.fachraumtyp = 'fachraum';
            if (roh !== 'fachraum') delete z.fachraumtyp;
          } },
        { feld: 'fachraumtyp', titel: 'Fachraumtyp', art: 'text', liste: 'liste-raumtypen', breite: '8em',
          setzen: (z, roh) => {
            const t = String(roh).trim();
            if (z.typ !== 'fachraum') return t ? 'Ein Fachraumtyp gilt nur für Fachräume. Bitte zuerst den Typ „Fachraum“ wählen.' : undefined;
            if (!t) return 'Fachräume brauchen einen Fachraumtyp (z. B. nawi, musik).';
            z.fachraumtyp = t;
          } },
        { feld: 'kapazitaet', titel: 'Plätze', art: 'zahl', min: 1, max: 500, ganz: true },
        { feld: 'nahe', titel: 'Nachbarräume (Namen)', art: 'text', breite: '10em', platzhalter: 'z. B. 102, 103',
          anzeigen: (z, d) => z.nahe.map((id) => d.raeume.find((r) => r.id === id)?.name || id).join(', '),
          setzen: (z, roh, d) => {
            const namen = String(roh).split(',').map((t) => t.trim()).filter(Boolean);
            const ids = [];
            for (const n of namen) {
              const r = d.raeume.find((x) => x.name.toLowerCase() === n.toLowerCase());
              if (!r) return `Raum „${n}“ gibt es nicht.`;
              if (r.id === z.id) return 'Ein Raum kann nicht neben sich selbst liegen.';
              ids.push(r.id);
            }
            // „nahe“ ist symmetrisch: Gegenseite mitpflegen
            for (const r of d.raeume) {
              if (r.id === z.id) continue;
              const soll = ids.includes(r.id);
              const ist = r.nahe.includes(z.id);
              if (soll && !ist) r.nahe.push(z.id);
              if (!soll && ist) r.nahe = r.nahe.filter((x) => x !== z.id);
            }
            z.nahe = [...new Set(ids)];
          } },
        { feld: 'gesperrt', titel: 'Gesperrt (Tag Stunden)', art: 'text', breite: '10em', platzhalter: 'z. B. Mi 1–2', anzeigen: sperrText, setzen: setzeMit(sperrLesen, 'gesperrt') },
      ],
      neu: (d) => {
        const name = eindeutigesKuerzel(d.raeume, 'Raum ');
        const r = { id: neueId(d.raeume, 'r', name), name, typ: 'klassenraum', kapazitaet: 30, nahe: [], gesperrt: [], abwesenheiten: [] };
        d.raeume.push(r);
        return r;
      },
      verweise: verweiseAuf('raeume'),
    });

    tabellen.klassen = Tabelle.erstelle({
      id: 'tabelle-klassen', beschriftung: 'Klassen', einzahl: 'Klasse', liste: (d) => d.klassen,
      spalten: [
        { feld: 'name', titel: 'Name', art: 'text', pflicht: true, breite: '6em' },
        { feld: 'stufe', titel: 'Stufe', art: 'zahl', min: 1, max: 13, ganz: true },
        { feld: 'schueler', titel: 'Schüler:innen', art: 'zahl', min: 1, max: 60, ganz: true },
        { feld: 'klassenlehrkraft', titel: 'Klassenlehrkraft', art: 'wahl', optionen: lehrerOptionen },
        { feld: 'heimatraum', titel: 'Heimatraum', art: 'wahl', optionen: raumOptionen },
        { feld: 'stundentafel', titel: 'Wochenstunden (Reiter Zuordnung)', art: 'anzeige', anzeigen: (z) => z.stundentafel.reduce((s, e) => s + e.stunden, 0) },
      ],
      neu: (d) => {
        const name = eindeutigesKuerzel(d.klassen, 'Klasse ');
        const k = { id: neueId(d.klassen, 'k', name), name, stufe: 1, schueler: 20, klassenlehrkraft: null, heimatraum: null, stundentafel: [] };
        d.klassen.push(k);
        return k;
      },
      verweise: verweiseAuf('klassen'),
    });

    tabellen.zeitraster = Tabelle.erstelle({
      id: 'tabelle-zeitraster', beschriftung: 'Unterrichtsstunden und Pausen', einzahl: 'Stunde',
      liste: (d) => d.zeitraster.stunden, schluessel: (z) => String(z.nr), name: (z) => `${z.nr}. Stunde`,
      spalten: [
        { feld: 'nr', titel: 'Stunde', art: 'anzeige' },
        { feld: 'von', titel: 'Beginn', art: 'text', platzhalter: '08:00', setzen: zeit('von') },
        { feld: 'bis', titel: 'Ende', art: 'text', platzhalter: '08:45', setzen: zeit('bis') },
        { feld: 'doppel', titel: 'Doppelstunde kann hier beginnen', art: 'bool',
          anzeigen: (z, d) => d.zeitraster.doppelstundenStart.includes(z.nr),
          setzen: (z, an, d) => {
            const liste = d.zeitraster.doppelstundenStart.filter((n) => n !== z.nr);
            if (an) liste.push(z.nr);
            d.zeitraster.doppelstundenStart = liste.sort((a, b) => a - b);
          } },
        { feld: 'pause', titel: 'Pause davor', art: 'bool',
          anzeigen: (z, d) => d.zeitraster.pausen.some((p) => p.vorStunde === z.nr),
          setzen: (z, an, d) => {
            const ohne = d.zeitraster.pausen.filter((p) => p.vorStunde !== z.nr);
            if (an) ohne.push({ vorStunde: z.nr, name: z.nr === 1 ? 'Frühaufsicht' : 'Pause', aufsichten: 1 });
            d.zeitraster.pausen = ohne.sort((a, b) => a.vorStunde - b.vorStunde);
          } },
        { feld: 'pausenname', titel: 'Name der Pause', art: 'text',
          anzeigen: (z, d) => d.zeitraster.pausen.find((p) => p.vorStunde === z.nr)?.name ?? '',
          setzen: (z, roh, d) => {
            const p = d.zeitraster.pausen.find((x) => x.vorStunde === z.nr);
            if (!p) return 'Vor dieser Stunde ist keine Pause – zuerst „Pause davor“ ankreuzen.';
            p.name = String(roh).trim();
          } },
        { feld: 'aufsichten', titel: 'Aufsichten', art: 'zahl', min: 0, max: 50, ganz: true,
          anzeigen: (z, d) => d.zeitraster.pausen.find((p) => p.vorStunde === z.nr)?.aufsichten ?? '',
          setzen: (z, roh, d) => {
            const p = d.zeitraster.pausen.find((x) => x.vorStunde === z.nr);
            if (!p) return 'Vor dieser Stunde ist keine Pause – zuerst „Pause davor“ ankreuzen.';
            const n = Number(String(roh).trim());
            if (!Number.isInteger(n) || n < 0 || n > 50) return 'Bitte eine ganze Zahl von 0 bis 50 eingeben.';
            p.aufsichten = n;
          } },
      ],
      neu: (d) => {
        const st = d.zeitraster.stunden;
        if (st.length >= 10) return 'Höchstens 10 Stunden je Tag.';
        const letzte = st[st.length - 1];
        const minuten = letzte ? Number(letzte.bis.slice(0, 2)) * 60 + Number(letzte.bis.slice(3)) + 5 : 8 * 60;
        const fmt = (m) => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
        const s = { nr: st.length + 1, von: fmt(minuten), bis: fmt(minuten + 45) };
        st.push(s);
        return s;
      },
      entferne: (d, key) => {
        const st = d.zeitraster.stunden;
        if (String(st[st.length - 1]?.nr) !== key) return false; // nur die letzte Stunde
        const nr = st.pop().nr;
        d.zeitraster.pausen = d.zeitraster.pausen.filter((p) => p.vorStunde !== nr);
        d.zeitraster.doppelstundenStart = d.zeitraster.doppelstundenStart.filter((n) => n !== nr && n + 1 !== nr);
      },
      verweise: (d, z) => {
        if (z.nr !== d.zeitraster.stunden.length) return [{ text: 'Nur die letzte Stunde des Tages kann entfernt werden.' }];
        const treffer = [];
        d.plan.regelplan.forEach((s) => { if (s.stunde === z.nr) treffer.push({ text: `Regelplan ${d.klassen.find((k) => k.id === s.klasse)?.name} ${s.tag} ${s.stunde}. Stunde` }); });
        d.plan.vertretungen.forEach((s) => { if (s.stunde === z.nr) treffer.push({ text: `Vertretung ${s.datum} ${s.stunde}. Stunde` }); });
        for (const l of d.lehrkraefte) for (const g of l.gesperrt) if (g.stunden.includes(z.nr)) treffer.push({ text: `Lehrkraft ${l.kuerzel}: gesperrt ${g.tag}` });
        for (const r of d.raeume) for (const g of r.gesperrt) if (g.stunden.includes(z.nr)) treffer.push({ text: `Raum ${r.name}: gesperrt ${g.tag}` });
        return treffer;
      },
    });
  }

  function zeit(feld) {
    return (z, roh) => {
      const t = String(roh).trim().replace(/^(\d):/, '0$1:').replace('.', ':');
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return 'Bitte eine Uhrzeit im Format HH:MM eingeben, z. B. 08:00.';
      z[feld] = t;
    };
  }

  /* ----------------------------- Aufbau ------------------------------- */

  function baue(ziel) {
    panel = ziel;
    const el = App.el;
    baueTabellen();
    const auswahl = el('div', { class: 'umschalter', role: 'group', 'aria-label': 'Bereich der Stammdaten' },
      ...BEREICHE.map(([id, titel]) => el('button', { type: 'button', class: 'knopf', id: 'stamm-' + id, 'aria-pressed': String(id === aktiv), text: titel, onclick: () => wechsle(id) })));
    const tage = el('fieldset', { class: 'tage', id: 'stamm-tage' }, el('legend', { text: 'Unterrichtstage' }),
      ...Kern.Modell.TAGE.map((t) => el('label', { class: 'feld-haken' },
        el('input', { type: 'checkbox', 'data-tag': t, onchange: (e) => setzeTag(t, e.target.checked, e.target) }), el('span', { text: t }))));
    const meldungTage = el('div', { class: 'meldungen', id: 'stamm-tage-meldung', 'aria-live': 'polite' });
    const schule = el('div', { class: 'formular', id: 'stamm-schule-formular' },
      ...[['name', 'Name der Schule'], ['schuljahr', 'Schuljahr']].map(([feld, titel]) => el('label', { class: 'feld' },
        el('span', { text: titel }),
        el('input', { type: 'text', 'data-schulfeld': feld, onchange: (e) => App.aendere(`Schule: ${titel} geändert`, (d) => { d.schule[feld] = e.target.value.trim(); }) }))));
    const listen = el('datalist', { id: 'liste-raumtypen' });
    const bereiche = {
      lehrkraefte: el('div', {}, el('p', { class: 'hinweis', text: 'Qualifikationen als „Fachkürzel Stufen“, mehrere durch Semikolon: MA 1–4; DE 1–4. Sperrzeiten als „Tag Stunden“: Fr 5–6; Mo 1.' }), tabellen.lehrkraefte.element),
      faecher: el('div', {}, el('p', { class: 'hinweis', text: 'Raumtyp leer lassen für Unterricht im Klassenraum; sonst turnhalle, schwimmhalle oder ein Fachraumtyp wie nawi.' }), tabellen.faecher.element),
      raeume: el('div', {}, tabellen.raeume.element),
      klassen: el('div', {}, el('p', { class: 'hinweis', text: 'Stundentafeln und Lehrkräfte je Fach werden im Reiter „Zuordnung“ gepflegt.' }), tabellen.klassen.element),
      zeitraster: el('div', {}, tage, meldungTage, el('p', { class: 'hinweis', text: 'Neue Stunden werden am Tagesende angehängt; entfernt werden kann nur die letzte Stunde.' }), tabellen.zeitraster.element),
      schule: el('div', {}, schule),
    };
    for (const [id, b] of Object.entries(bereiche)) { b.id = 'stamm-bereich-' + id; b.hidden = id !== aktiv; }
    panel.append(auswahl, listen, ...Object.values(bereiche));
    sichtbar = App.beobachteSichtbar(panel, render);
    render();
  }

  function wechsle(id) {
    aktiv = id;
    for (const [b] of BEREICHE) {
      panel.querySelector('#stamm-' + b).setAttribute('aria-pressed', String(b === id));
      panel.querySelector('#stamm-bereich-' + b).hidden = b !== id;
    }
    render();
  }

  function setzeTag(tag, an, eingabe) {
    const r = App.aendere(`Unterrichtstag ${tag} ${an ? 'hinzugefügt' : 'entfernt'}`, (d) => {
      const tage = new Set(d.zeitraster.tage);
      if (an) tage.add(tag); else tage.delete(tag);
      d.zeitraster.tage = Kern.Modell.TAGE.filter((t) => tage.has(t));
    });
    const meldung = panel.querySelector('#stamm-tage-meldung');
    if (!r.ok) {
      eingabe.checked = !an;
      meldung.replaceChildren(App.el('div', { class: 'meldung meldung-fehler', role: 'alert' },
        App.el('p', { class: 'meldung-titel', text: `⚠ ${tag} kann nicht ${an ? 'hinzugefügt' : 'entfernt'} werden – der Tag wird noch verwendet:` }),
        App.el('ul', { class: 'pfadliste' }, ...r.fehler.slice(0, 8).map((f) => App.el('li', {}, App.el('code', { text: f.pfad }), ': ' + f.meldung)))));
    } else meldung.replaceChildren();
  }

  function render() {
    const d = App.zustand.daten;
    const typen = new Set(['turnhalle', 'schwimmhalle', ...d.raeume.map((r) => r.fachraumtyp).filter(Boolean), ...d.faecher.map((f) => f.raumtyp).filter(Boolean)]);
    panel.querySelector('#liste-raumtypen').replaceChildren(...[...typen].map((t) => App.el('option', { value: t })));
    for (const input of panel.querySelectorAll('#stamm-tage input')) input.checked = d.zeitraster.tage.includes(input.dataset.tag);
    for (const input of panel.querySelectorAll('[data-schulfeld]')) if (input !== document.activeElement) input.value = d.schule[input.dataset.schulfeld] || '';
    tabellen[aktiv]?.render();
  }

  return { sichtbar: () => sichtbar(), baue, wechsle, qualiLesen, sperrLesen };
})();
