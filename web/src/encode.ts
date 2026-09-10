import type { TreeNode } from "./api";

// Score brut du point de vue joueur : nulle = demi-succès.
// IMPORTANT (DECISIONS #6) : la COULEUR porte la performance BRUTE, l'OPACITÉ
// porte la confiance (taille d'échantillon). On ne mélange jamais les deux.
// -> on n'utilise PAS wilson_lower pour la couleur (il contient déjà l'effet
// de la taille d'échantillon) ; wilson_lower reste affiché au survol.
export function rawScore(n: Pick<TreeNode, "wins" | "draws" | "losses" | "n">): number {
  return n.n ? (n.wins + 0.5 * n.draws) / n.n : 0;
}

// SAN cumulés de la racine jusqu'au nœud (ex. ["e4","c5","Nf3"]).
export function sanLine(node: { data: TreeNode; parent: unknown } | null): string[] {
  const out: string[] = [];
  let cur: any = node;
  while (cur) {
    if (cur.data?.san) out.push(cur.data.san);
    cur = cur.parent;
  }
  return out.reverse();
}
