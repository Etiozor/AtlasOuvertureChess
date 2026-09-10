"""Câblage de l'API FastAPI (endpoints + params). Base temporaire, pas de réseau."""
import importlib

from fastapi.testclient import TestClient

from atlas import db
from atlas.ingest import ingest_games

GAME = """[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0
"""


def _client(tmp_path, monkeypatch):
    dbp = tmp_path / "t.db"
    conn = db.connect(str(dbp))
    ingest_games(conn, "test", "me",
                 [{"game_id": "g1", "source": "test", "external_id": "g1",
                   "played_at": "2026-01-01T00:00:00+00:00", "my_color": "white",
                   "pgn": GAME}], "c")
    conn.close()
    monkeypatch.setenv("ATLAS_DB", str(dbp))
    import atlas.api as api
    importlib.reload(api)  # relit ATLAS_DB
    return TestClient(api.app)


def test_meta_and_tree(tmp_path, monkeypatch):
    with _client(tmp_path, monkeypatch) as c:
        meta = c.get("/api/meta")
        assert meta.status_code == 200
        assert meta.json()["counts_by_color"] == {"white": 1}

        r = c.get("/api/tree", params={"color": "white", "min_games": 1})
        assert r.status_code == 200
        body = r.json()
        assert body["meta"]["total_games"] == 1
        assert body["tree"]["children"][0]["san"] == "e4"

        # color invalide -> 422 (contrainte de pattern)
        assert c.get("/api/tree", params={"color": "purple"}).status_code == 422
