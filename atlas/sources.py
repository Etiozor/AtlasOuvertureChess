"""Récupération des parties depuis Lichess et Chess.com, en incrémental.

Requêtes en série, User-Agent identifiable (Chess.com bloque les clients
anonymes et les rafales parallèles). Chaque fonction renvoie
(records, next_cursor) : `records()` est un générateur de dicts normalisés,
`next_cursor()` renvoie le curseur à stocker APRÈS consommation du flux.
"""
import datetime as dt
import json

import requests

UA = "AtlasOuvertures/0.1 (etienne.le.pironnec1@gmail.com)"
_SPEED = {"bullet": "bullet", "blitz": "blitz", "rapid": "rapid", "daily": "correspondence"}


def _session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = UA
    return s


def _iso_ms(ms: int) -> str:
    return dt.datetime.fromtimestamp(ms / 1000, tz=dt.timezone.utc).isoformat()


def _iso_s(s: int) -> str:
    return dt.datetime.fromtimestamp(s, tz=dt.timezone.utc).isoformat()


# --------------------------------------------------------------------------- Lichess

def lichess(username: str, cursor):
    """cursor = dernier createdAt (ms) déjà ingéré, ou None."""
    state = {"cursor": cursor}

    def records():
        params = {
            "opening": "true", "evals": "true", "clocks": "true",
            "pgnInJson": "true", "sort": "dateAsc",
        }
        if cursor:
            params["since"] = int(cursor) + 1  # +1 ms : exclut la dernière partie déjà en base
        with _session() as s:
            r = s.get(
                f"https://lichess.org/api/games/user/{username}",
                params=params, headers={"Accept": "application/x-ndjson"},
                stream=True, timeout=60,
            )
            if r.status_code == 429:
                raise RuntimeError("Lichess 429 : trop de requêtes, réessaie dans une minute.")
            r.raise_for_status()
            for line in r.iter_lines():
                if not line:
                    continue
                obj = json.loads(line)
                created = obj["createdAt"]
                state["cursor"] = str(max(int(state["cursor"] or 0), created))
                yield _lichess_record(obj, username)

    return records, (lambda: state["cursor"])


def _lichess_record(obj: dict, username: str) -> dict:
    white, black = obj["players"]["white"], obj["players"]["black"]
    wname = (white.get("user") or {}).get("name", "")
    my_color = "white" if wname.lower() == username.lower() else "black"
    me, opp = (white, black) if my_color == "white" else (black, white)
    clock = obj.get("clock")
    opening = obj.get("opening") or {}
    return {
        "game_id": f"lichess:{obj['id']}",
        "source": "lichess",
        "external_id": obj["id"],
        "played_at": _iso_ms(obj["createdAt"]),
        "my_color": my_color,
        "my_rating": me.get("rating"),
        "opp_rating": opp.get("rating"),
        "opp_username": (opp.get("user") or {}).get("name"),
        "time_control": f"{clock['initial']}+{clock['increment']}" if clock else None,
        "speed": obj.get("speed"),
        "rated": obj.get("rated"),
        "eco": opening.get("eco"),
        "opening_name": opening.get("name"),
        "pgn": obj["pgn"],
    }


# -------------------------------------------------------------------------- Chess.com

def chesscom(username: str, cursor):
    """cursor = dernier mois complet 'YYYY/MM' déjà ingéré, ou None."""
    now = dt.datetime.now(dt.timezone.utc)
    current_month = f"{now.year:04d}/{now.month:02d}"
    months_box = {"months": []}

    def records():
        with _session() as s:
            idx = s.get(
                f"https://api.chess.com/pub/player/{username}/games/archives", timeout=30
            )
            idx.raise_for_status()
            archives = idx.json().get("archives", [])
            months_box["months"] = [u[-7:] for u in archives]
            for url in archives:
                month = url[-7:]
                if cursor and month < cursor:
                    continue  # mois passé déjà complet : jamais re-téléchargé
                arch = s.get(url, timeout=60)
                arch.raise_for_status()
                for g in arch.json().get("games", []):
                    rec = _chesscom_record(g, username)
                    if rec:
                        yield rec

    def next_cursor():
        # Dernier mois strictement antérieur au mois calendaire courant = complet.
        complete = [m for m in months_box["months"] if m < current_month]
        return max(complete) if complete else cursor

    return records, next_cursor


def _chesscom_record(g: dict, username: str):
    if g.get("rules", "chess") != "chess" or not g.get("pgn"):
        return None
    white, black = g["white"], g["black"]
    my_color = "white" if white["username"].lower() == username.lower() else "black"
    me, opp = (white, black) if my_color == "white" else (black, white)
    ext = g.get("uuid") or g["url"].rstrip("/").rsplit("/", 1)[-1]
    return {
        "game_id": f"chesscom:{ext}",
        "source": "chesscom",
        "external_id": ext,
        "played_at": _iso_s(g["end_time"]),
        "my_color": my_color,
        "my_rating": me.get("rating"),
        "opp_rating": opp.get("rating"),
        "opp_username": opp.get("username"),
        "time_control": g.get("time_control"),
        "speed": _SPEED.get(g.get("time_class"), g.get("time_class")),
        "rated": g.get("rated"),
        "eco": None,          # rempli depuis l'en-tête PGN [ECO] par parse_game
        "opening_name": None,  # idem [Opening] si présent
        "pgn": g["pgn"],
    }
