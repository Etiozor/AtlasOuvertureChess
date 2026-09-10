# ROADMAP

Un lot à la fois. On livre, on teste, on discute, puis on passe au suivant.

## Phase 1 — Ingestion & table de faits  *(VALIDÉE)*
Pipeline CLI qui remplit la base. Aucune viz, aucune API.
- `python -m atlas.ingest --source lichess --user PSEUDO`
- Import incrémental dès le départ (Lichess `since`, Chess.com par mois).
- Critères d'acceptation : idempotence (2× = 0 ligne ajoutée), comptage = API,
  FEN normalisé (transpositions convergent), e.p. legal-only, `is_my_move`
  correct pour les deux couleurs, `result` de mon point de vue, atomicité réseau.

## Phase 2 — API d'agrégation  *(IMPLÉMENTÉE, à valider)*
Endpoint renvoyant l'arbre dérivé + filtres (couleur, cadence, dates, classé,
source, profondeur, seuil d'élagage).
- **Correction d'architecture** : nœud d'affichage = un *chemin* (trie construit
  en marchant les parties), stats additives, zéro double-comptage. Les métriques
  par position (incohérence, transposition) = agrégation SQL *séparée* par FEN.
  « Un GROUP BY = l'arbre » est faux à cause des transpositions dans un DAG.
- Sortie de théorie sans moteur : TSV `lichess/chess-openings` keyé par FEN.
- < 200 ms sur base complète. Pas de cache (INSERT OR IGNORE + volumes dérisoires).

## Phase 3 — Visualisation panoramique
Icicle horizontal (flame graph) : x = numéro de coup, hauteur ∝ parties,
couleur = performance (brute), opacité = confiance (taille d'échantillon),
liséré = mes coups vs adversaire. Slider d'élagage avec recalcul en direct.
- Test décisif : identifier mon plus gros trou de répertoire en < 10 s.
- **3a (implémentée, à valider visuellement)** : app Vite/React/TS/D3, icicle +
  encodages + slider + survol texte.
- **3b (à venir)** : livre FEN (noms d'ouverture par position + sortie de
  théorie), échiquier au survol, liens Chessable/YouTube, filtres dans l'UI.

---

## Milestone 2 (FUTUR) — Partage avec des amis
Intention réelle exprimée, mais **hors v1** et ce n'est PAS un problème de scale
(dizaines d'amis, pas des milliers). Ne rien précâbler maintenant. Décision à
prendre le moment venu, entre deux options :
- **Self-host** : chaque ami lance l'app en local avec son pseudo. Zéro infra.
- **Site hébergé** : hébergement + auth + **un fichier SQLite par utilisateur**
  (`atlas_<user>.db`). Suffisant pour des dizaines d'amis, pas de Postgres.
Compat gardée dès le lot 2 sans coût : chemin de la base = paramètre/config
(déjà `--db`), l'API le lit de la config → routage par utilisateur trivial plus tard.
