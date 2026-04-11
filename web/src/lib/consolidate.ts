// Consolidation des factures d'équipe.
//
// À totaux par personne ET par projet préservés, rééquilibre la matrice
// (personne × projet) pour MINIMISER le nombre de cellules non-nulles —
// donc le nombre de factures d'équipe à générer.
//
// Algo : annulation de cycle 4+ sur la plus petite cellule.
// 1. Trouver la plus petite cellule ayant un cycle dans le graphe biparti
//    des cellules non-nulles.
// 2. Pivoter le long du cycle (alternance signes -/+) avec delta = valeur
//    de la cellule → elle devient 0, les totaux lignes/colonnes sont
//    préservés.
// 3. Répéter jusqu'à ce qu'aucune cellule n'ait de cycle (→ forêt biparti,
//    support minimum atteint).
//
// Projets "gelés" (frozenProjects) : leurs cellules ne sont jamais touchées.
// Utilisé pour exclure "__none__" (waves sans projet) — ces montants doivent
// rester visibles séparément pour que Fatou leur assigne un projet réel.

export const CONSOLIDATE_EPS = 1e-6;

export function findCycleThrough(
  cells: Map<string, Map<string, number>>,
  startP: string,
  startPr: string,
  frozenProjects: Set<string>,
): Array<[string, string]> | null {
  // BFS bipartite graph : rows ("P:<person>") + cols ("C:<project>").
  // Cherche un chemin de "C:startPr" à "P:startP" SANS utiliser l'arête
  // (startP, startPr) et en évitant toute arête touchant un frozen project.
  type Node = string;
  const startNode: Node = `C:${startPr}`;
  const target: Node = `P:${startP}`;

  const parentNode = new Map<Node, Node>();
  const parentEdge = new Map<Node, [string, string]>();
  const visited = new Set<Node>([startNode]);
  const queue: Node[] = [startNode];

  while (queue.length > 0) {
    const node = queue.shift()!;
    const neighbors: Array<{ next: Node; edge: [string, string] }> = [];
    if (node.startsWith("P:")) {
      const person = node.slice(2);
      const row = cells.get(person);
      if (row) {
        for (const [pr, v] of row) {
          if (v <= CONSOLIDATE_EPS) continue;
          if (frozenProjects.has(pr)) continue;
          if (person === startP && pr === startPr) continue;
          neighbors.push({ next: `C:${pr}`, edge: [person, pr] });
        }
      }
    } else {
      const pr = node.slice(2);
      if (frozenProjects.has(pr)) continue;
      for (const [p, row] of cells) {
        const v = row.get(pr);
        if (!v || v <= CONSOLIDATE_EPS) continue;
        if (p === startP && pr === startPr) continue;
        neighbors.push({ next: `P:${p}`, edge: [p, pr] });
      }
    }

    for (const { next, edge } of neighbors) {
      if (visited.has(next)) continue;
      visited.add(next);
      parentNode.set(next, node);
      parentEdge.set(next, edge);
      if (next === target) {
        // Reconstruire le chemin target → startNode, puis inverser
        const rev: Array<[string, string]> = [];
        let cur: Node = next;
        while (parentNode.has(cur)) {
          rev.push(parentEdge.get(cur)!);
          cur = parentNode.get(cur)!;
        }
        rev.reverse();
        // Préfixer l'arête directe pour fermer le cycle
        return [[startP, startPr], ...rev];
      }
      queue.push(next);
    }
  }
  return null;
}

export function consolidateFactures(
  inputCells: Map<string, Map<string, number>>,
  frozenProjects: Set<string> = new Set(),
): Map<string, Map<string, number>> {
  // Clone profond (pas de mutation du caller)
  const cells = new Map<string, Map<string, number>>();
  for (const [p, row] of inputCells) {
    const newRow = new Map<string, number>();
    for (const [pr, v] of row) {
      if (v > CONSOLIDATE_EPS) newRow.set(pr, v);
    }
    if (newRow.size > 0) cells.set(p, newRow);
  }

  const MAX_ITER = 10_000;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    // Collecter les cellules non-gelées triées par valeur croissante
    const sorted: Array<{ p: string; pr: string; v: number }> = [];
    for (const [p, row] of cells) {
      for (const [pr, v] of row) {
        if (v > CONSOLIDATE_EPS && !frozenProjects.has(pr)) {
          sorted.push({ p, pr, v });
        }
      }
    }
    if (sorted.length === 0) break;
    sorted.sort((a, b) => a.v - b.v);

    // Chercher la plus petite cellule qui admet un cycle
    let pivoted = false;
    for (const { p, pr } of sorted) {
      const cycle = findCycleThrough(cells, p, pr, frozenProjects);
      if (!cycle) continue;

      // delta = min des positions "-" (indices pairs) du cycle
      let delta = Infinity;
      for (let i = 0; i < cycle.length; i += 2) {
        const [cp, cpr] = cycle[i];
        const v = cells.get(cp)?.get(cpr) || 0;
        if (v < delta) delta = v;
      }
      if (delta <= CONSOLIDATE_EPS) continue; // sécurité

      // Appliquer le pivot : signes alternés en partant du - sur cycle[0]
      for (let i = 0; i < cycle.length; i++) {
        const [cp, cpr] = cycle[i];
        const sign = i % 2 === 0 ? -1 : +1;
        const row = cells.get(cp)!;
        const newVal = (row.get(cpr) || 0) + sign * delta;
        if (newVal <= CONSOLIDATE_EPS) row.delete(cpr);
        else row.set(cpr, newVal);
        if (row.size === 0) cells.delete(cp);
      }
      pivoted = true;
      break;
    }
    if (!pivoted) break; // forêt atteinte → support minimum
  }

  return cells;
}
