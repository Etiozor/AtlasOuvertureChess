import { useMemo } from "react";
import * as d3 from "d3";
import type { TreeNode } from "./api";
import { rawScore } from "./encode";

export type LaidNode = d3.HierarchyRectangularNode<TreeNode>;

interface Props {
  tree: TreeNode; // arbre récupéré au plancher FLOOR
  minGames: number; // seuil du slider (>= FLOOR) : élagage côté client
  width: number;
  height: number;
  onHover: (node: LaidNode | null) => void;
}

// Élagage : on retire les enfants sous le seuil. Copie (pas de mutation).
function pruneTree(node: TreeNode, minGames: number): TreeNode {
  const children = node.children
    .filter((c) => c.n >= minGames)
    .map((c) => pruneTree(c, minGames));
  return { ...node, children };
}

export function Icicle({ tree, minGames, width, height, onHover }: Props) {
  const { nodes, color, opacity, maxDepth } = useMemo(() => {
    const pruned = pruneTree(tree, minGames);

    // Poids "propre" d'un nœud = parties qui passent ici mais ne descendent pas
    // dans un enfant affiché (partie terminée, ou branche élaguée). Ainsi la
    // valeur agrégée d'un nœud = son n exact -> hauteur ∝ parties, additif.
    const root = d3
      .hierarchy<TreeNode>(pruned)
      .sum((d) => d.n - d.children.reduce((s, c) => s + c.n, 0)) as LaidNode;

    // -16 px réservés en haut pour l'axe des numéros de coup.
    d3.partition<TreeNode>().size([height - 16, width]).padding(0)(root);

    // COULEUR = perf brute, centrée sur ma moyenne globale (racine) : au-dessus
    // de ma moyenne = vert, en-dessous = rouge. OPACITÉ = confiance (taille).
    const mid = rawScore(tree);
    const color = d3
      .scaleDiverging<string>((t) => d3.interpolateRdYlGn(t))
      .domain([Math.max(0, mid - 0.3), mid, Math.min(1, mid + 0.3)]);
    const opacity = d3.scaleSqrt().domain([1, 150]).range([0.25, 1]).clamp(true);

    return {
      nodes: root.descendants().filter((d) => d.depth >= 1),
      color,
      opacity,
      maxDepth: root.height,
    };
  }, [tree, minGames, width, height]);

  const colW = width / (maxDepth + 1);

  return (
    <svg width={width} height={height} onMouseLeave={() => onHover(null)}>
      {/* Repères de numéro de coup en haut (l'axe X encode le coup). */}
      {Array.from({ length: maxDepth }, (_, i) => {
        const ply = i; // profondeur i+1 = demi-coup d'indice i
        const moveNo = Math.floor(ply / 2) + 1;
        const side = ply % 2 === 0 ? "" : "…";
        return (
          <text
            key={i}
            className="axis"
            x={(i + 1) * colW + 3}
            y={11}
          >
            {side}{moveNo}
          </text>
        );
      })}

      {nodes.map((d, i) => {
        const w = d.y1 - d.y0;
        const h = d.x1 - d.x0;
        const mine = d.data.is_my_move;
        return (
          <g key={i}>
            <rect
              className="node"
              x={d.y0}
              y={d.x0 + 16}
              width={Math.max(0, w - 0.5)}
              height={Math.max(0, h - 0.4)}
              fill={color(rawScore(d.data))}
              fillOpacity={opacity(d.data.n)}
              stroke={mine ? "#1b1b1b" : "#b9b9b9"}
              strokeWidth={mine ? 0.8 : 0.4}
              strokeDasharray={mine ? undefined : "2,2"}
              onMouseEnter={() => onHover(d)}
            />
            {/* Transposition : petit repère si le nœud est assez grand. */}
            {d.data.transposition && w > 7 && h > 7 && (
              <circle
                cx={d.y0 + 4}
                cy={d.x0 + 16 + 4}
                r={2}
                fill="#6a3d9a"
                pointerEvents="none"
              />
            )}
            {/* SAN si la case est assez grande pour être lisible. */}
            {w > 22 && h > 11 && (
              <text className="san" x={d.y0 + 3} y={d.x0 + 16 + h / 2 + 3} pointerEvents="none">
                {d.data.san}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
