# STATE (reprise entre sessions)

**Phase courante : 3a — Visualisation icicle.** Statut : implémentée, build vert, plomberie E2E vérifiée ; à valider VISUELLEMENT par l'utilisateur (`npm run dev`).

## Fait
- **Phase 1 (validée)** — ingestion : db.py, chess_utils.py, ingest.py, sources.py.
  Base réelle : 6 303 parties, 182 k demi-coups. Incrémental OK.
- **Phase 2** — agrégation :
  - `atlas/aggregate.py` : build du trie (nœud = chemin, stats additives),
    Wilson, entropie de dispersion sur mes nœuds, marquage transposition (FEN
    partagé), cache du trie (clé = mtime+filtres) pour un slider < 15 ms.
  - `atlas/api.py` : FastAPI, `GET /api/tree` (tous les filtres) + `GET /api/meta`,
    préchauffage au démarrage, chemin base via `ATLAS_DB` (compat partage futur).
- Tests : 13 verts (fen, ingest, aggregate, api). Perf mesurée (voir DECISIONS).

- **Phase 3a** — front `web/` (Vite + React + TS + D3) :
  - `web/src/Icicle.tsx` : icicle via d3.hierarchy/partition, nœud=chemin,
    poids propre (_own) pour hauteur additive, couleur=perf brute / opacité=
    confiance / liséré=mes coups vs adversaire / point=transposition.
  - `web/src/App.tsx` : toggle couleur, slider d'élagage (client, instantané
    depuis le plancher FLOOR=2), légende, panneau d'info au survol.
  - Proxy Vite `/api` → `:8000`. Build vert (tsc strict + vite). E2E vérifié.

## À valider par l'utilisateur (phase 3a) — VISUEL
- 2 terminaux : `uvicorn atlas.api:app --reload` + `cd web && npm install && npm run dev`.
- Ouvrir http://127.0.0.1:5173. Vérifier les 4 critères du lot 3 : 500 nœuds
  sans chevauchement, slider instantané, faible/fort effectif distinguable au
  coup d'œil, et surtout : repérer son plus gros trou en < 10 s.

## Prochaine étape : phase 3b
Livre FEN `lichess/chess-openings` (noms d'ouverture par position + sortie de
théorie, DECISIONS #11 ; `eco`/`opening_name` encore nuls). Échiquier au survol.
Liens Chessable/YouTube. Filtres cadence/dates/classé dans l'UI (l'API les gère
déjà). Ne pas prendre d'avance.
