"""Agrégation en arbre (critères 2 et 4).

On insère deux parties qui TRANSPOSENT vers la même position par deux ordres de
coups, puis on compare l'arbre agrégé à un comptage fait à la main.
"""
from atlas import db
from atlas.aggregate import aggregate, wilson_lower
from atlas.ingest import ingest_games

# Deux chemins vers la même position après 3 coups. Je suis Blanc.
GAME_A = """[Result "1-0"]

1. d4 Nf6 2. c4 e6 3. Nc3 1-0
"""  # je gagne
GAME_B = """[Result "0-1"]

1. c4 Nf6 2. Nc3 e6 3. d4 0-1
"""  # je perds


def _rec(gid, pgn):
    return {"game_id": gid, "source": "test", "external_id": gid,
            "played_at": "2026-01-01T00:00:00+00:00", "my_color": "white", "pgn": pgn}


def _tree():
    conn = db.connect(":memory:")
    ingest_games(conn, "test", "me", [_rec("A", GAME_A), _rec("B", GAME_B)], "c")
    return conn


def _find(node, san):
    for c in node["children"]:
        if c["san"] == san:
            return c
    raise AssertionError(f"enfant {san} absent")


def test_counts_match_naive():
    """L'agrégation SQL/trie == comptage naïf fait main (critère 2)."""
    root = aggregate(_tree(), color="white")["tree"]
    # Racine : 2 parties, 1 victoire / 1 défaite (mon POV).
    assert (root["n"], root["wins"], root["losses"], root["draws"]) == (2, 1, 1, 0)
    # Deux premiers coups distincts, une partie chacun.
    assert _find(root, "d4")["n"] == 1   # partie A seulement
    assert _find(root, "c4")["n"] == 1   # partie B seulement
    # Wilson < score brut (0,5) : petit échantillon tiré vers le bas.
    assert root["wilson_lower"] < 0.5


def test_dispersion_only_on_my_nodes():
    """Entropie calculée à la racine (mes 1ers coups), = 1 bit pour 2 coups équiprobables."""
    root = aggregate(_tree(), color="white")["tree"]
    assert abs(root["dispersion"] - 1.0) < 1e-9
    # Un nœud adverse (après mon 1er coup, c'est à l'adversaire) : pas de dispersion.
    assert _find(root, "d4")["dispersion"] is None


def test_transposition_marked():
    """Les deux chemins convergent : même to_fen, marqué transposition (critère 4)."""
    root = aggregate(_tree(), color="white")["tree"]
    leaf_a = _find(_find(_find(root, "d4"), "Nf6"), "c4")  # d4 Nf6 c4 ... puis e6 Nc3
    leaf_a = _find(_find(leaf_a, "e6"), "Nc3")
    leaf_b = _find(_find(_find(root, "c4"), "Nf6"), "Nc3")
    leaf_b = _find(_find(leaf_b, "e6"), "d4")
    assert leaf_a["to_fen"] == leaf_b["to_fen"]
    assert leaf_a["transposition"] and leaf_b["transposition"]
    # Un nœud non convergent n'est pas marqué.
    assert _find(root, "d4")["transposition"] is False


def test_min_games_prunes_but_keeps_dispersion():
    """min_games élague les enfants rares mais la dispersion reste calculée sur le tout."""
    root = aggregate(_tree(), color="white", min_games=2)["tree"]
    assert root["children"] == []            # chaque 1er coup n'a qu'1 partie -> élagué
    assert abs(root["dispersion"] - 1.0) < 1e-9  # dispersion pré-élagage préservée


def test_wilson_bounds():
    assert wilson_lower(0, 0, 0) == 0.0
    assert 0.0 < wilson_lower(50, 0, 50) < 0.5   # 50 % sur gros échantillon, borne basse proche
    assert wilson_lower(7, 0, 3) < 0.7           # 70 % sur 10 parties : borne bien < 0,7
