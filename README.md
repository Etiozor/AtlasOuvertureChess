# Atlas d'ouvertures d'échecs

Carte panoramique d'un répertoire d'ouvertures, construite depuis les parties
Chess.com / Lichess. Local, mono-utilisateur. Voir [.planning/PROJECT.md](.planning/PROJECT.md).

## Lot 1 — Ingestion (livré)

```bash
pip install -r requirements.txt

python -m atlas.ingest --source lichess  --user <PSEUDO_LICHESS>
python -m atlas.ingest --source chesscom --user <PSEUDO_CHESSCOM>
```

Remplit `atlas.db` (SQLite). Import **incrémental** : relancer ne retélécharge
pas les parties déjà en base (Lichess `since`, Chess.com par mois). Relancer
n'ajoute aucune ligne.

## Lot 2 — API d'agrégation (livré)

```bash
uvicorn atlas.api:app          # http://127.0.0.1:8000  (doc interactive : /docs)
```

- `GET /api/tree?color=white&min_games=5` → l'arbre dérivé (nœud = chemin, stats
  additives, borne de Wilson, entropie de dispersion sur mes nœuds, transpositions
  marquées). Filtres : `color`, `speed` (multi), `date_from`/`date_to`, `rated`,
  `source`, `max_depth`, `min_games` (seuil d'élagage).
- `GET /api/meta` → domaines de valeurs pour l'UI de filtres.
- Base sélectionnée par `ATLAS_DB` (défaut `atlas.db`).

Perf : slider `min_games` < 15 ms (cache chaud), préchauffage ~2 s au démarrage.

Tests : `python -m pytest`

## Lot 3a — Visualisation icicle (livré)

Deux terminaux :

```bash
# Terminal 1 — backend (données)
uvicorn atlas.api:app --reload

# Terminal 2 — frontend (dessin)
cd web
npm install      # une seule fois
npm run dev      # ouvre http://127.0.0.1:5173
```

Icicle horizontal : axe X = numéro de coup, hauteur ∝ parties, **couleur** =
performance brute (rouge < ta moyenne < vert), **opacité** = confiance (taille
d'échantillon), **liséré** plein = tes coups / pointillé = l'adversaire, point
violet = transposition. **Slider d'élagage** en direct (côté client, instantané).
Survole une case : ligne SAN complète + stats + Wilson + dispersion.

Le front parle à l'API via un proxy Vite (`/api` → `:8000`), donc garde le
backend allumé. À venir (lot 3b) : échiquier au survol, liens Chessable/YouTube,
et le livre FEN (noms d'ouverture par position + sortie de théorie).

Tests front : `npm --prefix web run build` (typecheck + build).
