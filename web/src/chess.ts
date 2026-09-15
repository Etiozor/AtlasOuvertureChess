// Échiquier minimal, porté du prototype Claude Design (support déplacements à la
// souris pour l'exploration d'ouvertures). Rien de légal-complet : pseudo-légal,
// suffisant pour rejouer/poursuivre une ligne à la main.
//
// Convention plateau : tableau de 64 cases, index 0 = a8 … 63 = h1 (comme un FEN
// lu de haut en bas). Majuscule = Blanc, minuscule = Noir, "." = vide.

export const START = "rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR".split("");

export const GLYPH: Record<string, string> = {
  K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

export function idx(sq: string): number {
  return (8 - +sq[1]) * 8 + (sq.charCodeAt(0) - 97);
}
export function sqName(i: number): string {
  return String.fromCharCode(97 + (i % 8)) + (8 - Math.floor(i / 8));
}
export function isWhite(p: string): boolean {
  return p !== "." && p === p.toUpperCase();
}

// Placement FEN (1er champ de l'EPD renvoyé par l'API) -> plateau 64 cases.
export function fenToBoard(fen: string): string[] {
  const placement = fen.split(" ")[0];
  const b: string[] = [];
  for (const ch of placement) {
    if (ch === "/") continue;
    if (ch >= "1" && ch <= "8") for (let k = 0; k < +ch; k++) b.push(".");
    else b.push(ch);
  }
  return b.length === 64 ? b : START.slice();
}

// Applique un coup UCI en place (roque + prise en passant + promotion en dame).
// ponytail: promotion forcée en dame — assez pour explorer une ouverture.
export function applyMoveInPlace(b: string[], uci: string): void {
  const a = idx(uci.slice(0, 2)), z = idx(uci.slice(2, 4));
  const piece = b[a];
  const pawn = piece === "P" || piece === "p";
  // prise en passant : pion qui change de colonne vers une case vide -> le pion
  // capturé est sur la colonne d'arrivée, à la rangée de départ.
  if (pawn && (a % 8) !== (z % 8) && b[z] === ".") b[Math.floor(a / 8) * 8 + (z % 8)] = ".";
  b[z] = piece; b[a] = ".";
  if (uci.length > 4) b[z] = isWhite(piece) ? uci[4].toUpperCase() : uci[4].toLowerCase();
  if (piece === "K" && uci === "e1g1") { b[idx("f1")] = "R"; b[idx("h1")] = "."; }
  if (piece === "K" && uci === "e1c1") { b[idx("d1")] = "R"; b[idx("a1")] = "."; }
  if (piece === "k" && uci === "e8g8") { b[idx("f8")] = "r"; b[idx("h8")] = "."; }
  if (piece === "k" && uci === "e8c8") { b[idx("d8")] = "r"; b[idx("a8")] = "."; }
}

export function applyUcis(ucis: string[]): { b: string[]; last: [number, number] | null } {
  const b = START.slice();
  let last: [number, number] | null = null;
  for (const u of ucis) {
    last = [idx(u.slice(0, 2)), idx(u.slice(2, 4))];
    applyMoveInPlace(b, u);
  }
  return { b, last };
}

// Deux cases qui changent entre deux plateaux (surbrillance du dernier coup).
export function diffSquares(prev: string[], cur: string[]): [number, number] | null {
  let from = -1, to = -1;
  for (let i = 0; i < 64; i++) {
    if (prev[i] !== cur[i]) {
      if (cur[i] === ".") from = i; else to = i;
    }
  }
  return from >= 0 && to >= 0 ? [from, to] : null;
}

// SAN approché, déduit du plateau : suffisant pour une exploration à la souris.
export function pseudoSan(board: string[], from: number, to: number): string {
  const p = board[from], capture = board[to] !== ".";
  const dest = sqName(to);
  if (p.toUpperCase() === "K" && Math.abs((to % 8) - (from % 8)) === 2)
    return (to % 8) > (from % 8) ? "O-O" : "O-O-O";
  if (p.toUpperCase() === "P") return capture ? sqName(from)[0] + "x" + dest : dest;
  return p.toUpperCase() + (capture ? "x" : "") + dest;
}

// --- Import PGN / FEN -------------------------------------------------------

// Un texte ressemble-t-il à un FEN ? (8 rangées séparées par "/")
export function isFen(text: string): boolean {
  return /^\s*([pnbrqkPNBRQK1-8]+\/){7}[pnbrqkPNBRQK1-8]+(\s+[wb])?/.test(text.trim());
}

// Extrait les jetons SAN d'un PGN : retire en-têtes, commentaires, variantes
// (un niveau), NAG, numéros de coup et résultat.
export function splitPgnMoves(pgn: string): string[] {
  let s = pgn.replace(/\[[^\]]*\]/g, " ").replace(/\{[^}]*\}/g, " ").replace(/;[^\n]*/g, " ");
  for (let i = 0; i < 4; i++) s = s.replace(/\([^()]*\)/g, " "); // variantes imbriquées
  s = s.replace(/\$\d+/g, " ")
       .replace(/\b\d+\.(\.\.)?/g, " ")
       .replace(/(1-0|0-1|1\/2-1\/2|\*)/g, " ");
  return s.split(/\s+/).filter(Boolean);
}

// SAN -> UCI sur un plateau donné. Pseudo-légal (pas de filtre échec/clouage,
// pas de prise en passant) : suffisant pour rejouer un PGN d'ouverture normal.
export function sanToUci(board: string[], san: string, whiteToMove: boolean): string | null {
  let s = san.replace(/[+#!?]+$/g, "").trim();
  if (s === "O-O" || s === "0-0") { const r = whiteToMove ? 7 : 0; return sqName(r * 8 + 4) + sqName(r * 8 + 6); }
  if (s === "O-O-O" || s === "0-0-0") { const r = whiteToMove ? 7 : 0; return sqName(r * 8 + 4) + sqName(r * 8 + 2); }
  let promo = "";
  const pm = s.match(/=([QRBN])$/i);
  if (pm) { promo = pm[1].toLowerCase(); s = s.slice(0, pm.index); }
  const pieceChar = /^[KQRBN]/.test(s) ? s[0] : "P";
  const rest = s.replace(/^[KQRBN]/, "").replace(/x/g, "");
  const dest = rest.slice(-2);
  if (!/^[a-h][1-8]$/.test(dest)) return null;
  const to = idx(dest);
  const disamb = rest.slice(0, -2);
  let df = -1, dr = -1;
  for (const ch of disamb) {
    if (ch >= "a" && ch <= "h") df = ch.charCodeAt(0) - 97;
    else if (ch >= "1" && ch <= "8") dr = 8 - +ch;
  }
  const want = whiteToMove ? pieceChar : pieceChar.toLowerCase();
  for (let from = 0; from < 64; from++) {
    if (board[from] !== want) continue;
    if (df >= 0 && from % 8 !== df) continue;
    if (dr >= 0 && Math.floor(from / 8) !== dr) continue;
    if (legalTargets(board, from).indexOf(to) >= 0) return sqName(from) + dest + promo;
  }
  return null;
}

// Rejoue une liste de SAN depuis la position de départ -> coups {uci, san}.
// S'arrête au premier coup non résolu et renvoie le préfixe valide.
export function parseLineToFree(sans: string[]): { uci: string; san: string }[] {
  const b = START.slice();
  const out: { uci: string; san: string }[] = [];
  let white = true;
  for (const san of sans) {
    const uci = sanToUci(b, san, white);
    if (!uci) break;
    applyMoveInPlace(b, uci);
    out.push({ uci, san });
    white = !white;
  }
  return out;
}

const DIRS: Record<string, number[][]> = {
  R: [[0, 1], [0, -1], [1, 0], [-1, 0]],
  B: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
};
DIRS.Q = DIRS.R.concat(DIRS.B);
const JUMPS: Record<string, number[][]> = {
  N: [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]],
  K: DIRS.Q,
};
function at(b: string[], file: number, rank: number): string | null {
  return file < 0 || file > 7 || rank < 0 || rank > 7 ? null : b[rank * 8 + file];
}

// Coups pseudo-légaux (sans échec ni prise en passant) : assez pour explorer.
export function legalTargets(b: string[], from: number): number[] {
  const p = b[from];
  if (p === ".") return [];
  const white = isWhite(p), t = p.toUpperCase();
  const file = from % 8, rank = Math.floor(from / 8), out: number[] = [];
  const push = (f2: number, r2: number): boolean => {
    const q = at(b, f2, r2);
    if (q === null) return false;
    if (q === ".") { out.push(r2 * 8 + f2); return true; }
    if (isWhite(q) !== white) out.push(r2 * 8 + f2);
    return false;
  };
  if (t === "P") {
    const dir = white ? -1 : 1, start = white ? 6 : 1;
    if (at(b, file, rank + dir) === ".") {
      out.push((rank + dir) * 8 + file);
      if (rank === start && at(b, file, rank + 2 * dir) === ".") out.push((rank + 2 * dir) * 8 + file);
    }
    for (const df of [-1, 1]) {
      const q = at(b, file + df, rank + dir);
      if (q && q !== "." && isWhite(q) !== white) out.push((rank + dir) * 8 + file + df);
    }
    return out;
  }
  if (t === "N" || t === "K") {
    for (const [df, dr] of JUMPS[t]) push(file + df, rank + dr);
    if (t === "K") {
      const row = white ? 7 : 0;
      if (from === row * 8 + 4) {
        if (b[row * 8 + 5] === "." && b[row * 8 + 6] === "." && b[row * 8 + 7].toUpperCase() === "R") out.push(row * 8 + 6);
        if (b[row * 8 + 1] === "." && b[row * 8 + 2] === "." && b[row * 8 + 3] === "." && b[row * 8].toUpperCase() === "R") out.push(row * 8 + 2);
      }
    }
    return out;
  }
  for (const [df, dr] of DIRS[t]) {
    let f2 = file + df, r2 = rank + dr;
    while (push(f2, r2)) { f2 += df; r2 += dr; }
  }
  return out;
}
