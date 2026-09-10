"""Agrégation dérivée : construit l'arbre déplié à partir de la table de faits.

Point clé d'architecture (voir .planning/DECISIONS.md #3) : un nœud d'affichage
est un CHEMIN, pas une position. On construit un trie en marchant les parties
-> les compteurs sont additifs (le n d'un nœud = les parties dont la ligne passe
par ici), zéro double-comptage. Les transpositions (deux chemins arrivant sur la
même position) sont DÉTECTÉES puis marquées, jamais fusionnées : un icicle est
strictement hiérarchique et ne peut de toute façon pas fusionner deux parents.

L'entropie de dispersion n'est calculée QUE sur mes nœuds à moi (ceux dont les
enfants sont mes coups) — c'est mon détecteur d'incohérence de répertoire.

Perf (critère 1) : le coût dominant est la CONSTRUCTION du trie complet
(~65 k nœuds sur la base réelle). On la met en cache par (mtime base, filtres) :
le slider d'élagage ne change que min_games -> reconstruction évitée, on ne
refait que la sérialisation élaguée. Voir DECISIONS.md.
"""
import itertools
import math
import time

import chess

from .chess_utils import truncate_fen

START_FEN = truncate_fen(chess.Board())
Z = 1.96  # 95 % — Wilson

# Cache du trie construit. Clé = (version, where, params, max_depth).
# version (mtime de la base, fourni par l'appelant) invalide le cache après un
# ré-import. Si version is None (tests sur base :memory:), on ne cache pas.
_CACHE: dict = {}
_CACHE_MAX = 16


def wilson_lower(w: int, d: int, l: int, z: float = Z) -> float:
    """Borne inférieure de Wilson sur le score (W + 0,5·D)/N.
    Approximation : Wilson suppose du binaire, les nulles sont traitées en
    demi-succès (assez bon pour un dashboard, voir DECISIONS.md #6)."""
    n = w + d + l
    if n == 0:
        return 0.0
    p = (w + 0.5 * d) / n
    denom = 1 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (centre - margin) / denom


def _entropy(counts) -> float:
    total = sum(counts)
    if total == 0:
        return 0.0
    return -sum((c / total) * math.log2(c / total) for c in counts if c > 0)


class _Node:
    __slots__ = ("san", "to_fen", "is_my_move", "ply", "n", "w", "d", "l", "children")

    def __init__(self, san, to_fen, is_my_move, ply):
        self.san = san
        self.to_fen = to_fen
        self.is_my_move = is_my_move
        self.ply = ply
        self.n = 0
        self.w = self.d = self.l = 0
        self.children = {}          # uci -> _Node


def _where(color, speeds, date_from, date_to, rated, source):
    clauses, params = ["g.my_color = ?"], [color]
    if speeds:
        clauses.append(f"g.speed IN ({','.join('?' * len(speeds))})")
        params += list(speeds)
    if date_from:
        clauses.append("g.played_at >= ?")
        params.append(date_from)
    if date_to:
        clauses.append("g.played_at <= ?")
        params.append(date_to)
    if rated is not None:
        clauses.append("g.rated = ?")
        params.append(1 if rated else 0)
    if source:
        clauses.append("g.source = ?")
        params.append(source)
    return " AND ".join(clauses), params


def _build(conn, where, params, max_depth):
    """Construit le trie complet + le comptage de FEN (transpositions).
    Renvoie (root, fen_counts, build_ms)."""
    t0 = time.perf_counter()
    result_of = {
        r["game_id"]: r["result"]
        for r in conn.execute(f"SELECT game_id, result FROM games g WHERE {where}", params)
    }
    plies = conn.execute(
        f"""SELECT p.game_id, p.ply, p.san, p.uci, p.to_fen, p.is_my_move
            FROM game_plies p JOIN games g ON g.game_id = p.game_id
            WHERE {where} AND p.ply < ?
            ORDER BY p.game_id, p.ply""",
        params + [max_depth],
    )

    root = _Node(None, START_FEN, None, -1)
    fen_counts: dict = {}
    for game_id, group in itertools.groupby(plies, key=_gid):
        result = result_of[game_id]
        # Branche win/draw/loss calculée une fois par partie (booléens = 0/1).
        iw, idr = result == "win", result == "draw"
        il = not iw and not idr
        node = root
        node.n += 1; node.w += iw; node.d += idr; node.l += il
        for p in group:
            uci = p["uci"]
            child = node.children.get(uci)
            if child is None:
                child = _Node(p["san"], p["to_fen"], bool(p["is_my_move"]), p["ply"])
                node.children[uci] = child
                fen_counts[child.to_fen] = fen_counts.get(child.to_fen, 0) + 1
            child.n += 1; child.w += iw; child.d += idr; child.l += il
            node = child

    return root, fen_counts, round((time.perf_counter() - t0) * 1000, 1)


def _gid(row):
    return row["game_id"]


def _cached_build(conn, version, where, params, max_depth):
    """Renvoie (root, fen_counts, build_ms, cached)."""
    if version is None:
        root, fc, ms = _build(conn, where, params, max_depth)
        return root, fc, ms, False
    for k in list(_CACHE):            # invalide les entrées d'une version antérieure
        if k[0] != version:
            del _CACHE[k]
    key = (version, where, tuple(params), max_depth)
    hit = _CACHE.get(key)
    if hit is None:
        if len(_CACHE) >= _CACHE_MAX:
            _CACHE.pop(next(iter(_CACHE)))
        hit = _CACHE[key] = _build(conn, where, params, max_depth)
        return (*hit, False)
    return (*hit, True)


def aggregate(conn, *, color, speeds=None, date_from=None, date_to=None,
              rated=None, source=None, max_depth=30, min_games=1, version=None):
    t0 = time.perf_counter()
    where, params = _where(color, speeds, date_from, date_to, rated, source)
    root, fen_counts, build_ms, cached = _cached_build(conn, version, where, params, max_depth)
    tree = _serialize(root, min_games, fen_counts)
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)

    return {
        "meta": {
            "color": color, "total_games": root.n,
            "cached": cached, "build_ms": build_ms,
            "elapsed_ms": elapsed_ms,
            "min_games": min_games, "max_depth": max_depth,
            "filters": {"speeds": speeds, "date_from": date_from,
                        "date_to": date_to, "rated": rated, "source": source},
        },
        "tree": tree,
    }


def _serialize(node, min_games, fen_counts):
    kids = node.children.values()
    # Dispersion : sur TOUS les enfants (avant élagage), et seulement si ce sont
    # mes coups -> l'incohérence reste mesurée même quand la traîne est masquée.
    my_kids = None
    for c in kids:
        my_kids = c.is_my_move
        break
    dispersion = _entropy([c.n for c in kids]) if my_kids else None

    children = [_serialize(c, min_games, fen_counts)
                for c in node.children.values() if c.n >= min_games]
    children.sort(key=lambda x: -x["n"])

    return {
        "san": node.san,
        "to_fen": node.to_fen,
        "ply": node.ply,
        "n": node.n,
        "wins": node.w, "draws": node.d, "losses": node.l,
        "wilson_lower": round(wilson_lower(node.w, node.d, node.l), 4),
        "is_my_move": node.is_my_move,
        "dispersion": round(dispersion, 4) if dispersion is not None else None,
        # eco/opening_name : nuls en lot 2. Nom PAR POSITION => livre FEN
        # (lichess/chess-openings), fourni au lot 3 avec la sortie de théorie (DECISIONS #11).
        "eco": None,
        "opening_name": None,
        "transposition": fen_counts.get(node.to_fen, 0) > 1,
        "children": children,
    }
