// Arbre d'affichage + barème de couleur + données du cahier (mock local).
//
// Deux sources produisent la MÊME forme de nœud :
//  - "Mes parties" : adapté de l'API (/api/tree) -> board dérivé de to_fen.
//  - "Mon cahier"  : trie construit depuis des lignes écrites à la main (ucis).
import type { TreeNode } from "./api";
import { START, applyUcis, fenToBoard, splitPgnMoves, parseLineToFree } from "./chess";

export interface Node {
  san: string | null;
  key: string;            // chemin SAN cumulé, "" à la racine
  ply: number;
  n: number;
  score: number;          // (V + 0,5·N) / parties
  board: string[];        // position 64 cases APRÈS ce coup
  children: Node[];
  opening_name?: string | null;
  transposition?: boolean;
  // champs transitoires posés par le layout du graphe :
  depth?: number;
  ux?: number;
}

// --- API -> Node ------------------------------------------------------------
function rawScore(n: TreeNode): number {
  return n.n ? (n.wins + 0.5 * n.draws) / n.n : 0;
}
export function adaptApiTree(api: TreeNode, parentKey = ""): Node {
  const key = api.san ? (parentKey ? parentKey + " " + api.san : api.san) : "";
  return {
    san: api.san,
    key,
    ply: api.ply,
    n: api.n,
    score: rawScore(api),
    board: fenToBoard(api.to_fen),
    opening_name: api.opening_name,
    transposition: api.transposition,
    children: api.children.map((c) => adaptApiTree(c, key)),
  };
}

export const EMPTY_ROOT: Node = {
  san: null, key: "", ply: -1, n: 0, score: 0, board: START.slice(), children: [],
};

// --- Lignes écrites à la main -> trie (le cahier) ---------------------------
export interface Line { s: string; u: string; n: number; sc: number }

export function buildTrie(lines: Line[]): Node {
  const root: any = { san: null, key: "", ply: -1, n: 0, sc: 0, children: [], ucis: [] };
  for (const L of lines) {
    const sans = L.s.split(" "), ucis = L.u.split(" ");
    let node = root; node.n += L.n; node.sc += L.sc * L.n;
    for (let i = 0; i < sans.length; i++) {
      let c = node.children.find((x: any) => x.san === sans[i]);
      if (!c) {
        c = { san: sans[i], key: (node.key ? node.key + " " : "") + sans[i], ply: i, n: 0, sc: 0, children: [], ucis: ucis.slice(0, i + 1) };
        node.children.push(c);
      }
      c.n += L.n; c.sc += L.sc * L.n;
      node = c;
    }
  }
  const norm = (nd: any) => {
    nd.score = nd.n ? nd.sc / nd.n : 0;
    nd.board = applyUcis(nd.ucis).b;
    nd.children.sort((a: any, b: any) => b.n - a.n);
    nd.children.forEach(norm);
  };
  norm(root);
  return root as Node;
}

// --- Import de fichiers -----------------------------------------------------

// Livre lichess/chess-openings (TSV : eco \t nom \t pgn) -> noms par clé SAN.
export function parseBookTsv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const cols = raw.split("\t");
    if (cols.length < 3) continue;
    const name = cols[1], pgn = cols[2];
    if (!name || !pgn || name.toLowerCase() === "name") continue; // saute l'en-tête
    const key = splitPgnMoves(pgn).join(" ");
    if (key) out[key] = name.trim();
  }
  return out;
}

// Fichier de lignes (Chessable CSV, ou TSV/PGN à une ligne par coup-suite) :
// pour chaque rangée, la cellule qui ressemble le plus à une suite de coups est
// rejouée -> ligne du cahier {s,u,n,sc}. En-têtes et cellules non-coups ignorés.
export function parseMoveLines(text: string, delim: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = (delim ? raw.split(delim) : [raw])
      .map((c) => c.trim().replace(/^"(.*)"$/s, "$1").replace(/""/g, '"')); // déguillemète le CSV
    let best = "", bestCount = 0;
    for (const cell of cells) {
      const n = splitPgnMoves(cell).length;
      if (n > bestCount) { bestCount = n; best = cell; }
    }
    if (bestCount < 1) continue;
    const free = parseLineToFree(splitPgnMoves(best));
    if (!free.length) continue;
    out.push({ s: free.map((m) => m.san).join(" "), u: free.map((m) => m.uci).join(" "), n: 1, sc: 0.5 });
  }
  return out;
}

export function findNode(root: Node, key: string): Node {
  if (!key) return root;
  let nd = root;
  for (const san of key.split(" ")) {
    const c = nd.children.find((x) => x.san === san);
    if (!c) return nd;
    nd = c;
  }
  return nd;
}

// --- Stats & couleur --------------------------------------------------------
export function wilsonLower(sc: number, n: number): number {
  const z = 1.96, p = sc;
  const denom = 1 + z * z / n, centre = p + z * z / (2 * n);
  const m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return Math.max(0, (centre - m) / denom);
}

function mix(a: number[], b: number[], t: number) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}
// Rampe opaque : critical -> crème neutre -> primary. Aucune bulle n'est transparente.
const STOPS = [[156, 59, 65], [222, 210, 180], [63, 107, 92]];
function winRamp(sc: number): number[] {
  const t = Math.max(0, Math.min(1, (sc - 0.4) / 0.2)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(t));
  return mix(STOPS[i], STOPS[i + 1], t - i);
}
export function winColor(sc: number): string {
  const c = winRamp(sc);
  return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
}

// --- Noms d'ouverture (fallback client : l'API ne les remplit pas encore) ---
export const NAMES: Record<string, string> = {
  "e4": "1.e4",
  "e4 c5": "Sicilienne", "e4 e5": "Ouverture du pion roi", "e4 e6": "Française",
  "e4 c6": "Caro-Kann", "e4 d5": "Scandinave", "e4 d6": "Pirc", "e4 g6": "Moderne", "e4 Nf6": "Alekhine",
  "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6": "Najdorf",
  "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6": "Accélérée",
  "e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6": "Kan",
  "e4 c5 Nc3": "Sicilienne fermée",
  "e4 e5 Nf3 Nc6 Bc4 Bc5": "Italienne",
  "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5": "Deux cavaliers",
  "e4 e5 Nf3 Nc6 Bb5": "Espagnole",
  "e4 e5 Nf3 Nf6": "Russe",
  "e4 e5 Nf3 d6": "Philidor",
  "e4 e6 d4 d5 Nc3 Bb4": "Winawer",
  "e4 e6 d4 d5 Nc3 Nf6": "Classique",
  "e4 e6 d4 d5 Nd2": "Tarrasch",
  "e4 e6 d4 d5 exd5": "Échange",
  "e4 c6 d4 d5 Nc3": "Caro classique",
  "e4 c6 d4 d5 e5": "Caro avance",
  "e4 c6 d4 d5 exd5 cxd5 c4": "Panov",
};

// --- Cahier (répertoire voulu) : mock local, pas de backend -----------------
export const IN_CAHIER = [
  "e4 e5 Nf3 Nc6 Bc4 Bc5", "e4 e5 Nf3 Nc6 Bb5", "e4 e6 d4 d5 Nc3 Nf6",
  "e4 c6 d4 d5 exd5 cxd5 c4", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6",
];

const CAHIER_LINES: Line[] = [
  { s: "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O", u: "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6 e1g1", n: 14, sc: 0.9 },
  { s: "e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 c3", u: "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8c5 c2c3", n: 9, sc: 0.7 },
  { s: "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1", u: "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1", n: 11, sc: 0.55 },
  { s: "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5", u: "e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 e4e5 f6d7 f2f4 c7c5", n: 8, sc: 0.35 },
  { s: "e4 c6 d4 d5 exd5 cxd5 c4 Nf6 Nc3 e6", u: "e2e4 c7c6 d2d4 d7d5 e4d5 c6d5 c2c4 g8f6 b1c3 e7e6", n: 7, sc: 0.6 },
  { s: "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5", u: "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e5", n: 6, sc: 0.3 },
];

export const TREE_C = buildTrie(CAHIER_LINES);

export interface Chapter {
  name: string; badge: string; tone: string; badgeTone: string;
  meta: string; line: string; pct: number; note: string; ref: string;
}
export const CHAPTERS: Chapter[] = [
  { name: "Italienne", badge: "Solide", tone: "var(--color-primary)", badgeTone: "primary", meta: "12 lignes · 268 parties · revu il y a 3 jours", line: "1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 5.d3", pct: 82, note: "Le d3 lent me convient mieux que d4 : je perds moins de parties dans le centre ouvert.", ref: "e4 e5 Nf3 Nc6 Bc4 Bc5" },
  { name: "Espagnole", badge: "À revoir", tone: "var(--color-warning)", badgeTone: "warning", meta: "9 lignes · 152 parties · revu il y a 6 semaines", line: "1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O", pct: 41, note: "Je connais le début et rien du milieu. Les variantes fermées sont à écrire.", ref: "e4 e5 Nf3 Nc6 Bb5" },
  { name: "Française — Classique", badge: "Trou", tone: "var(--color-critical)", badgeTone: "critical", meta: "6 lignes · 92 parties · win rate 57 %", line: "1.e4 e6 2.d4 d5 3.Nc3 Nf6 4.e5 Nfd7 5.f4", pct: 23, note: "Après 5.f4 c5 je joue au hasard. C'est là que je perds le plus de temps à la pendule.", ref: "e4 e6 d4 d5 Nc3 Nf6" },
  { name: "Panov", badge: "Neuf", tone: "var(--color-success)", badgeTone: "success", meta: "8 lignes · 73 parties · importé de Chessable", line: "1.e4 c6 2.d4 d5 3.exd5 cxd5 4.c4 Nf6 5.Nc3", pct: 64, note: "Importé la semaine dernière, jamais joué en blitz. À tester avant de le garder.", ref: "e4 c6 d4 d5 exd5 cxd5 c4" },
  { name: "Anti-Najdorf", badge: "Solide", tone: "var(--color-primary)", badgeTone: "primary", meta: "15 lignes · 214 parties · win rate 47 %", line: "1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6 6.Be3", pct: 71, note: "Mon plus gros volume et mon plus mauvais score. Le cahier existe, mes coups ne le suivent pas.", ref: "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6" },
];

export const SOURCES = [
  { name: "Fichier PGN", desc: "Une étude exportée, un fichier de lignes annotées." },
  { name: "Étude Lichess", desc: "Collée par URL. Chaque chapitre devient un chapitre." },
  { name: "Export Chessable", desc: "CSV de cours. Les lignes gardent leur ordre." },
  { name: "Livre lichess/chess-openings", desc: "Noms d'ouverture par position (TSV), pour nommer la carte." },
];
