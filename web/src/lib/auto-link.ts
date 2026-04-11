import type { WaveTransaction } from "../types/khalis";

// Auto-link Wave → Facture d'équipe (étape 3)
//
// Algo : chaque wave flagué RFE est auto-lié à UNE personne cible.
// Résolution :
//   1) counterparty startsWith match vs personnes ayant des factures
//   2) sinon, 1ère personne du chevron si elle a des factures
//   3) sinon, 1ère personne arbitraire avec capacité restante
// Le wave entier est ensuite distribué sur TOUTES les factures de
// cette personne, dans l'ordre alphabétique de la clé projet. Waves
// traités par date croissante pour que la date facture = date du 1er
// wave lié (priorité #4).
// Prend en entrée la matrice consolidée (person × project), donc le
// nombre de factures à combler est déjà minimisé.

export type LinkedWaveEntry = {
  waveId: string;
  date: string;
  counterparty: string | null;
  amount: number;
};

export type AutoLinksResult = {
  linkedByFactureKey: Map<string, LinkedWaveEntry[]>;
  totalWaveUnlinked: number;
};

export function computeAutoLinks(
  wavesWithMeta: WaveTransaction[],
  factureMatrix: Map<string, Map<string, number>>,
): AutoLinksResult {
  const linkedByFactureKey = new Map<string, LinkedWaveEntry[]>();
  let totalWaveUnlinked = 0;

  // Construction de l'index des factures par personne depuis la matrice
  // consolidée. La capacité d'une facture = valeur de la cellule (person,
  // project) dans la matrice. Un wave peut remplir jusqu'à cette capacité.
  const personFactureIndex = new Map<
    string,
    Array<{ factureKey: string; remaining: number }>
  >();
  for (const [personName, row] of factureMatrix) {
    for (const [projectId, amount] of row) {
      if (amount <= 0) continue;
      const factureKey = `${projectId}|${personName}`;
      if (!personFactureIndex.has(personName)) {
        personFactureIndex.set(personName, []);
      }
      personFactureIndex.get(personName)!.push({ factureKey, remaining: amount });
    }
  }

  const linkToFacture = (
    factureKey: string,
    wave: WaveTransaction,
    desired: number,
  ): number => {
    for (const arr of personFactureIndex.values()) {
      for (const f of arr) {
        if (f.factureKey === factureKey) {
          const linkAmount = Math.min(desired, f.remaining);
          if (linkAmount <= 0) return 0;
          f.remaining -= linkAmount;
          if (!linkedByFactureKey.has(factureKey)) {
            linkedByFactureKey.set(factureKey, []);
          }
          linkedByFactureKey.get(factureKey)!.push({
            waveId: wave.id,
            date: wave.transactionDate,
            counterparty: wave.counterpartyName,
            amount: linkAmount,
          });
          return linkAmount;
        }
      }
    }
    return 0;
  };

  const sortedWaves = wavesWithMeta
    .filter((w) => w.allocations && w.allocations.length > 0)
    .slice()
    .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

  const capacityOf = (personName: string): number => {
    const factures = personFactureIndex.get(personName);
    if (!factures) return 0;
    return factures.reduce((sum, f) => sum + f.remaining, 0);
  };

  for (const wave of sortedWaves) {
    const waveAmount = Number(wave.amount);

    // Construction de la cascade de candidats dans l'ordre de priorité :
    //   1) counterparty startsWith match
    //   2) 1ère personne du chevron
    //   3) toutes les autres personnes (ordre alpha)
    // On retient le PREMIER candidat dont la capacité restante est
    // >= wave.amount. Règle métier : un RFE ne peut pas être attribué
    // à une personne dont le total facture < au montant du wave.
    const candidates: string[] = [];

    if (wave.counterpartyName) {
      const firstToken = wave.counterpartyName.trim().split(/\s+/)[0] || "";
      if (firstToken.length >= 2) {
        for (const personName of personFactureIndex.keys()) {
          if (personName.toLowerCase().startsWith(firstToken.toLowerCase())) {
            if (!candidates.includes(personName)) candidates.push(personName);
            break;
          }
        }
      }
    }

    if (wave.allocations && wave.allocations[0]) {
      const firstChev = wave.allocations[0].name;
      if (
        personFactureIndex.has(firstChev) &&
        !candidates.includes(firstChev)
      ) {
        candidates.push(firstChev);
      }
    }

    for (const personName of personFactureIndex.keys()) {
      if (!candidates.includes(personName)) candidates.push(personName);
    }

    let targetPerson: string | null = null;
    for (const candidate of candidates) {
      if (capacityOf(candidate) >= waveAmount) {
        targetPerson = candidate;
        break;
      }
    }

    if (!targetPerson) {
      // Aucune personne n'a une capacité suffisante pour absorber ce
      // wave entier → non lié (signalé dans le bandeau récap)
      totalWaveUnlinked += waveAmount;
      continue;
    }

    const factures = personFactureIndex.get(targetPerson)!;
    const ordered = factures
      .slice()
      .sort((a, b) => a.factureKey.localeCompare(b.factureKey));

    let waveRemaining = waveAmount;
    for (const f of ordered) {
      if (waveRemaining <= 0) break;
      const linked = linkToFacture(f.factureKey, wave, waveRemaining);
      waveRemaining -= linked;
    }

    if (waveRemaining > 0) totalWaveUnlinked += waveRemaining;
  }

  return { linkedByFactureKey, totalWaveUnlinked };
}
