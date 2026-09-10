"""Schéma SQLite et connexion. Fichier local unique."""
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
    game_id      TEXT PRIMARY KEY,
    source       TEXT NOT NULL,
    external_id  TEXT NOT NULL,
    played_at    TIMESTAMP NOT NULL,
    my_color     TEXT NOT NULL,
    result       TEXT NOT NULL,
    my_rating    INTEGER,
    opp_rating   INTEGER,
    opp_username TEXT,
    time_control TEXT,
    speed        TEXT,
    rated        BOOLEAN,
    eco          TEXT,
    opening_name TEXT,
    termination  TEXT
);

CREATE TABLE IF NOT EXISTS game_plies (
    game_id     TEXT NOT NULL REFERENCES games(game_id),
    ply         INTEGER NOT NULL,
    from_fen    TEXT NOT NULL,
    san         TEXT NOT NULL,
    uci         TEXT NOT NULL,
    to_fen      TEXT NOT NULL,
    is_my_move  BOOLEAN NOT NULL,
    eval_cp     INTEGER,
    clock_ms    INTEGER,
    PRIMARY KEY (game_id, ply)
);

-- Index dont l'agrégation du lot 2 aura besoin (GROUP BY from_fen). Gratuit maintenant.
CREATE INDEX IF NOT EXISTS idx_plies_from_fen ON game_plies(from_fen);

CREATE TABLE IF NOT EXISTS sync_state (
    source       TEXT PRIMARY KEY,
    username     TEXT NOT NULL,
    last_synced  TIMESTAMP,
    cursor       TEXT   -- lichess: dernier createdAt (ms) ; chesscom: dernier mois complet "YYYY/MM"
);
"""


def connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn


def get_cursor(conn: sqlite3.Connection, source: str):
    row = conn.execute("SELECT cursor FROM sync_state WHERE source = ?", (source,)).fetchone()
    return row["cursor"] if row else None
