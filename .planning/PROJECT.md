# Atlas d'ouvertures d'échecs — PROJECT

Carte panoramique du répertoire d'ouvertures d'un joueur, à partir de ses
parties Chess.com / Lichess. **Angle unique** : la vue d'ensemble (l'arbre
entier lisible d'un coup, comme une carte de territoire). Le drill-down existe
partout ; le dashboard n'existe nulle part.

## Cadre
- **Local, mono-utilisateur, v1.** Pas d'auth, pas d'hébergement, pas de multi-tenant.
- **Agnostique au niveau.** Aucun seuil d'Elo en dur : l'élagage et la détection
  de sortie de théorie sont des *paramètres*, pas des constantes calées sur un joueur.
- Volumes : ~10 000 parties × 30 demi-coups ≈ 300 000 lignes de faits.

## Stack (fixée)
- Ingestion + agrégation : **Python 3.11+**, `python-chess` (parsing PGN, FEN,
  validation, plus tard UCI/Stockfish). C'est le cœur de justesse — on ne
  réimplémente rien qu'il fasse déjà.
- Stockage : **SQLite**, fichier local unique.
- API : **FastAPI** local.
- Front : **React + Vite + TypeScript + D3** (icicle via `d3.partition`).
- Pas de switch full-TS : `python-chess` garantit la canonicalisation e.p.
  « legal-only » ; `chess.js` ne la garantit pas, et la table de faits est immuable.
- Pas de skills Matt Pocock : orientés TS/AI-SDK, aucune IA dans ce projet.

## Méthodo
GSD lean + Ponytail. Phases = les lots. Exécution directe (pas de chaîne de
sous-agents par phase). Décisions figées dans DECISIONS.md, contexte de reprise
dans STATE.md.

## Hors périmètre v1
Stockfish, comparaison entre joueurs, prépa anti-adversaire, répétition espacée,
auth, hébergement, webhooks, rafraîchissement auto. (Un bouton « Rafraîchir »
déclenchant l'import incrémental suffit.)
