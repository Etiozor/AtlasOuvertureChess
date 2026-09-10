"""Pipeline d'ingestion : remplit la base à partir d'un flux de parties normalisées.

Insertion source-agnostique. Chaque partie est insérée dans sa propre
transaction (atomicité, critère 7) ; le curseur de sync n'est avancé qu'à la
fin, une fois toutes les parties disponibles consommées. INSERT OR IGNORE sur
les clés primaires garantit l'idempotence (critère 1) indépendamment du curseur.
"""
import argparse
import datetime as dt

from . import db
from .chess_utils import SkipGame, parse_game

# Colonnes de `games` remplies depuis le record normalisé de la source.
_GAME_META = (
    "source", "external_id", "played_at", "my_color", "my_rating",
    "opp_rating", "opp_username", "time_control", "speed", "rated",
)


def _insert_game(conn, rec: dict) -> None:
    """Insère une partie et ses demi-coups. Idempotent (OR IGNORE)."""
    result, termination, eco, opening, plies = parse_game(rec["pgn"], rec["my_color"])

    # Les métadonnées de la plateforme priment sur les en-têtes PGN quand elles existent.
    eco = rec.get("eco") or eco
    opening = rec.get("opening_name") or opening

    conn.execute(
        """INSERT OR IGNORE INTO games
           (game_id, source, external_id, played_at, my_color, result,
            my_rating, opp_rating, opp_username, time_control, speed, rated,
            eco, opening_name, termination)
           VALUES (:game_id, :source, :external_id, :played_at, :my_color, :result,
                   :my_rating, :opp_rating, :opp_username, :time_control, :speed, :rated,
                   :eco, :opening_name, :termination)""",
        {**{k: rec.get(k) for k in _GAME_META},
         "game_id": rec["game_id"], "my_color": rec["my_color"],
         "result": result, "eco": eco, "opening_name": opening,
         "termination": termination},
    )
    conn.executemany(
        """INSERT OR IGNORE INTO game_plies
           (game_id, ply, from_fen, san, uci, to_fen, is_my_move, eval_cp, clock_ms)
           VALUES (:game_id, :ply, :from_fen, :san, :uci, :to_fen, :is_my_move, :eval_cp, :clock_ms)""",
        [{**p, "game_id": rec["game_id"]} for p in plies],
    )


def ingest_games(conn, source: str, username: str, records, new_cursor) -> int:
    """Consomme un itérable de records normalisés. Renvoie le nombre de parties
    effectivement traitées (hors doublons/variantes). `records` peut être un
    générateur réseau : une coupure en cours d'itération laisse la base cohérente
    (parties déjà commitées présentes, curseur non avancé)."""
    seen = 0
    for rec in records:
        try:
            with conn:  # transaction par partie
                _insert_game(conn, rec)
            seen += 1
        except SkipGame:
            continue

    # Curseur avancé seulement après épuisement complet du flux.
    # new_cursor peut être une valeur ou un callable (Lichess ne connaît son
    # curseur qu'après avoir consommé le stream).
    new_cursor = new_cursor() if callable(new_cursor) else new_cursor
    with conn:
        conn.execute(
            """INSERT INTO sync_state (source, username, last_synced, cursor)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(source) DO UPDATE SET
                   username=excluded.username,
                   last_synced=excluded.last_synced,
                   cursor=COALESCE(excluded.cursor, sync_state.cursor)""",
            (source, username, dt.datetime.now(dt.timezone.utc).isoformat(), new_cursor),
        )
    return seen


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m atlas.ingest")
    ap.add_argument("--source", required=True, choices=["lichess", "chesscom"])
    ap.add_argument("--user", required=True)
    ap.add_argument("--db", default="atlas.db")
    args = ap.parse_args(argv)

    from . import sources  # import tardif : évite de charger requests pour les tests unitaires

    conn = db.connect(args.db)
    cursor = db.get_cursor(conn, args.source)

    if args.source == "lichess":
        records, new_cursor = sources.lichess(args.user, cursor)
    else:
        records, new_cursor = sources.chesscom(args.user, cursor)

    n = ingest_games(conn, args.source, args.user, records(), new_cursor)
    total = conn.execute("SELECT COUNT(*) c FROM games WHERE source = ?", (args.source,)).fetchone()["c"]
    print(f"{args.source}/{args.user} : {n} parties traitées ce passage, {total} en base.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
