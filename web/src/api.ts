// Types miroir de la réponse de l'API FastAPI (atlas/aggregate.py) + fetch.

export interface TreeNode {
  san: string | null;
  to_fen: string;
  ply: number;
  n: number;
  wins: number;
  draws: number;
  losses: number;
  wilson_lower: number;
  is_my_move: boolean | null;
  dispersion: number | null;
  eco: string | null; // nul en lot 2, rempli au lot 3b (livre FEN)
  opening_name: string | null;
  transposition: boolean;
  children: TreeNode[];
}

export interface TreeResponse {
  meta: {
    color: string;
    total_games: number;
    cached: boolean;
    build_ms: number;
    elapsed_ms: number;
    min_games: number;
    max_depth: number;
  };
  tree: TreeNode;
}

export interface Meta {
  speeds: string[];
  sources: string[];
  date_from: string | null;
  date_to: string | null;
  counts_by_color: Record<string, number>;
  sync: Record<string, { username: string; last_synced: string | null }>;
}

export type Color = "white" | "black";
export type Source = "lichess" | "chesscom";

export interface IngestResult {
  seen: number;
  total: number;
  counts_by_color: Record<string, number>;
}

// Va chercher les parties d'un joueur (incrémental côté serveur). Peut être long
// au tout premier import : le serveur traite le flux avant de répondre.
export async function ingestGames(source: Source, username: string): Promise<IngestResult> {
  const r = await fetch("/api/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, username }),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => null);
    throw new Error(detail?.detail ? String(detail.detail) : `API ${r.status}`);
  }
  return r.json();
}

// On récupère l'arbre à un plancher bas ; le slider élague ensuite côté client
// (instantané, aucune requête réseau). On ne descend jamais sous ce plancher.
export const FLOOR = 2;

export async function fetchTree(color: Color): Promise<TreeResponse> {
  const r = await fetch(`/api/tree?color=${color}&min_games=${FLOOR}`);
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

export async function fetchMeta(): Promise<Meta> {
  const r = await fetch("/api/meta");
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}
