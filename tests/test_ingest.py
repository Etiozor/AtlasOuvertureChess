"""Ingestion : is_my_move, result de mon POV, idempotence, atomicité
(critères d'acceptation 1, 5, 6, 7). Fixtures uniquement, aucun réseau."""
import pytest

from atlas import db
from atlas.chess_utils import parse_game
from atlas.ingest import ingest_games

# Mat de l'imbécile : les Noirs matent au 2e coup. Result de White : 0-1.
FOOLS_MATE = """[Event "Test"]
[Result "0-1"]
[Termination "Normal"]

1. f3 e5 2. g4 Qh4# 0-1
"""


def _rec(game_id, pgn, my_color, **extra):
    base = {
        "game_id": game_id, "source": "test", "external_id": game_id.split(":")[-1],
        "played_at": "2026-01-01T00:00:00+00:00", "my_color": my_color, "pgn": pgn,
    }
    base.update(extra)
    return base


def _mem_db():
    return db.connect(":memory:")


def test_is_my_move_black():
    """is_my_move correct quand je suis Noir (critère 5)."""
    _, _, _, _, plies = parse_game(FOOLS_MATE, "black")
    by_san = {p["san"]: p["is_my_move"] for p in plies}
    assert by_san["f3"] is False   # coup blanc
    assert by_san["e5"] is True    # coup noir = le mien
    assert by_san["g4"] is False
    assert by_san["Qh4#"] is True


def test_result_from_my_point_of_view():
    """Même partie (0-1) : 'win' si je suis Noir, 'loss' si je suis Blanc (critère 6)."""
    assert parse_game(FOOLS_MATE, "black")[0] == "win"
    assert parse_game(FOOLS_MATE, "white")[0] == "loss"


def test_idempotent_second_pass_adds_nothing():
    """Ingérer deux fois le même flux n'ajoute aucune ligne (critère 1)."""
    conn = _mem_db()
    records = [_rec("test:g1", FOOLS_MATE, "black")]
    ingest_games(conn, "test", "me", iter(records), "cur1")
    n1 = conn.execute("SELECT COUNT(*) c FROM games").fetchone()["c"]
    p1 = conn.execute("SELECT COUNT(*) c FROM game_plies").fetchone()["c"]

    ingest_games(conn, "test", "me", iter(records), "cur1")
    n2 = conn.execute("SELECT COUNT(*) c FROM games").fetchone()["c"]
    p2 = conn.execute("SELECT COUNT(*) c FROM game_plies").fetchone()["c"]

    assert n1 == n2 == 1
    assert p1 == p2 == 4


def test_atomicity_on_stream_interruption():
    """Une coupure en cours de flux laisse la base cohérente : les parties déjà
    commitées sont présentes, le curseur n'est PAS avancé (critère 7)."""
    conn = _mem_db()

    def flaky():
        yield _rec("test:g1", FOOLS_MATE, "black")
        raise RuntimeError("coupure réseau simulée")

    with pytest.raises(RuntimeError):
        ingest_games(conn, "test", "me", flaky(), "cur1")

    # La partie avant la coupure est bien là, avec ses coups.
    assert conn.execute("SELECT COUNT(*) c FROM games").fetchone()["c"] == 1
    assert conn.execute("SELECT COUNT(*) c FROM game_plies").fetchone()["c"] == 4
    # Curseur non avancé : rien n'a été écrit dans sync_state.
    assert conn.execute("SELECT COUNT(*) c FROM sync_state").fetchone()["c"] == 0
