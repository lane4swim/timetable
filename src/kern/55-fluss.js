/* ==========================================================================
 * Modul Fluss
 * Minimalkosten-Maximalfluss (Successive Shortest Path mit SPFA). Genutzt für
 * die Lehrkräfte-Zuweisung (§6.3) und die Verteilung der Pausenaufsichten
 * (§6.5a): zuerst so viel Fluss wie möglich (= so wenig Ausfall wie möglich),
 * unter allen maximalen Flüssen der billigste.
 * ========================================================================== */
const Fluss = (() => {
  'use strict';

  /** Neuer Graph mit n Knoten (0 … n−1). */
  function graph(n) {
    return { n, von: [], nach: [], kap: [], fluss: [], kosten: [], adj: Array.from({ length: n }, () => []) };
  }

  /** Fügt eine gerichtete Kante hinzu; liefert ihre Nummer (für fluss()). */
  function kante(g, von, nach, kapazitaet, kosten = 0) {
    const i = g.von.length;
    g.von.push(von, nach);
    g.nach.push(nach, von);
    g.kap.push(kapazitaet, 0);
    g.fluss.push(0, 0);
    g.kosten.push(kosten, -kosten);
    g.adj[von].push(i);
    g.adj[nach].push(i + 1);
    return i;
  }

  /**
   * Berechnet einen Fluss maximaler Stärke mit minimalen Kosten.
   * @returns {{fluss: number, kosten: number}}
   */
  function minKostenMaxFluss(g, quelle, senke, grenze = Infinity) {
    const n = g.n;
    const dist = new Float64Array(n);
    const vor = new Int32Array(n);
    const inSchlange = new Uint8Array(n);
    let fluss = 0;
    let kosten = 0;
    while (fluss < grenze) {
      dist.fill(Infinity);
      vor.fill(-1);
      dist[quelle] = 0;
      const schlange = [quelle];
      inSchlange[quelle] = 1;
      for (let kopf = 0; kopf < schlange.length; kopf++) {
        const u = schlange[kopf];
        inSchlange[u] = 0;
        for (const e of g.adj[u]) {
          if (g.kap[e] - g.fluss[e] <= 0) continue;
          const v = g.nach[e];
          const d = dist[u] + g.kosten[e];
          if (d < dist[v] - 1e-12) {
            dist[v] = d;
            vor[v] = e;
            if (!inSchlange[v]) { inSchlange[v] = 1; schlange.push(v); }
          }
        }
      }
      if (dist[senke] === Infinity) break;
      let f = grenze - fluss;
      for (let v = senke; v !== quelle; v = g.von[vor[v]]) f = Math.min(f, g.kap[vor[v]] - g.fluss[vor[v]]);
      for (let v = senke; v !== quelle; v = g.von[vor[v]]) {
        g.fluss[vor[v]] += f;
        g.fluss[vor[v] ^ 1] -= f;
      }
      fluss += f;
      kosten += f * dist[senke];
    }
    return { fluss, kosten };
  }

  /** Fluss über Kante i. */
  const flussVon = (g, i) => g.fluss[i];

  return { graph, kante, minKostenMaxFluss, flussVon };
})();
