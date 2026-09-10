"""API FastAPI mince : l'endpoint d'arbre + un endpoint méta pour peupler l'UI
de filtres (lot 3). La logique vit dans aggregate.py. Chemin de base lu depuis
la config (ATLAS_DB) -> routage par utilisateur trivial pour le partage futur.
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from . import aggregate, db

DB_PATH = os.environ.get("ATLAS_DB", "atlas.db")


def _conn():
    return db.connect(DB_PATH)


@asynccontextmanager
async def _lifespan(app):
    """Préchauffe le trie des deux couleurs au démarrage (build ~0,5 s absorbé
    ici, une fois). Après ça, slider et requêtes répétées sont < 15 ms."""
    if os.path.exists(DB_PATH):
        version = os.path.getmtime(DB_PATH)
        conn = _conn()
        try:
            for color in ("white", "black"):
                aggregate.aggregate(conn, color=color, version=version)
        finally:
            conn.close()
    yield


app = FastAPI(title="Atlas d'ouvertures d'échecs", lifespan=_lifespan)
# Front Vite en dev sur un autre port : CORS ouvert (app locale mono-utilisateur).
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.get("/", include_in_schema=False)
def _root():
    return RedirectResponse("/docs")


@app.get("/api/tree")
def tree(
    color: str = Query(..., pattern="^(white|black)$"),
    speed: list[str] | None = Query(None),
    date_from: str | None = None,
    date_to: str | None = None,
    rated: bool | None = None,
    source: str | None = Query(None, pattern="^(lichess|chesscom)$"),
    max_depth: int = Query(30, ge=1, le=60),
    min_games: int = Query(1, ge=1),
):
    version = os.path.getmtime(DB_PATH) if os.path.exists(DB_PATH) else None
    conn = _conn()
    try:
        return aggregate.aggregate(
            conn, color=color, speeds=speed, date_from=date_from, date_to=date_to,
            rated=rated, source=source, max_depth=max_depth, min_games=min_games,
            version=version,
        )
    finally:
        conn.close()


@app.get("/api/meta")
def meta():
    """Domaines de valeurs pour construire l'UI de filtres."""
    conn = _conn()
    try:
        speeds = [r["speed"] for r in conn.execute(
            "SELECT DISTINCT speed FROM games WHERE speed IS NOT NULL ORDER BY speed")]
        sources = [r["source"] for r in conn.execute(
            "SELECT DISTINCT source FROM games ORDER BY source")]
        bounds = conn.execute(
            "SELECT MIN(played_at) lo, MAX(played_at) hi FROM games").fetchone()
        counts = {r["my_color"]: r["n"] for r in conn.execute(
            "SELECT my_color, COUNT(*) n FROM games GROUP BY my_color")}
        return {
            "speeds": speeds, "sources": sources,
            "date_from": bounds["lo"], "date_to": bounds["hi"],
            "counts_by_color": counts,
        }
    finally:
        conn.close()
