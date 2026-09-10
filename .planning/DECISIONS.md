# DECISIONS (figées)

1. **Clé de nœud = FEN tronqué 4 champs** (placement, trait, roques, e.p.), sans
   compteurs. e.p. canonicalisée « legal-only » (`board.epd(en_passant="legal")`)
   sinon les transpositions via double-pas anodin sont faussement séparées.
2. **DAG, pas arbre.** Stockage = liste d'arêtes (`game_plies`). Transpositions
   fusionnées au niveau position, marquées (jamais fusionnées) à l'affichage.
3. **Arbre non matérialisé.** MAIS : l'arbre d'affichage se construit par un walk
   trie sur les chemins de parties (pas un simple GROUP BY) → stats additives.
   Les métriques par position (incohérence, transposition) = agrégation SQL à part.
4. **`is_my_move`** par demi-coup : à mes nœuds, le nb de branches = mon
   incohérence ; aux nœuds adverses, ce qui compte est le volume.
5. **Deux arbres par couleur** par défaut ; fusion en option, jamais par défaut.
6. **Bruit du winrate** : Wilson (approx avec nulles : score = (W+0,5D)/N) →
   canal COULEUR. Taille d'échantillon → canal OPACITÉ. Jamais mélangés.
7. **Pas de moteur en v1.** `eval_cp` présent au schéma, rempli gratuitement
   depuis Lichess (`evals=true`) quand dispo. Stockfish = v2.
8. **Agnostique Elo** : aucun seuil en dur ; élagage & sortie de théorie = paramètres.
9. **Incrémental** : Lichess `since=<dernier createdAt ms>` ; Chess.com curseur =
   dernier mois complet « YYYY/MM », mois courant toujours re-fetché. Idempotence
   réelle garantie par `INSERT OR IGNORE` (le curseur n'est qu'une optimisation).
10. **30 demi-coups** conservés par partie.
11. **Sortie de théorie sans moteur** (phase 2/3) : embarquer le TSV
    `lichess/chess-openings` keyé par FEN.
12. **Méthodo** : GSD lean + Ponytail.

## Perf lot 2 (mesurée sur base réelle, 6 300 parties / 182 k demi-coups)
Le coût dominant est le BUILD du trie complet (~65 k nœuds/couleur) : 0,8 s
(blancs) à 1,15 s (noirs), profondeur 30, toutes cadences. La sérialisation à
`min_games=1` (dump 65 k nœuds) ~1 s — hors scénario d'affichage.
**Décision : cache du trie construit**, clé = (mtime base, filtres, max_depth),
invalidé au ré-import. Conséquences :
- Slider `min_games` (build réutilisé, on ne refait que la sérialisation
  élaguée) : **< 15 ms** → l'interaction signature du lot 3 est instantanée.
- Préchauffage des deux couleurs au démarrage de l'API (~2 s une fois) → le
  build à froid n'est jamais attendu par l'utilisateur.
- Changement de filtre = miss cache = build à froid du sous-ensemble (~100 ms
  typique filtré). Ça revient sur la note initiale « pas de cache » : la mesure
  a tranché.

## `ponytail:` reportés (dette assumée, à monter si besoin)
- Chess.com : ETag `If-None-Match` sur le mois courant → 304 quasi gratuit.
  Non fait : skip des mois passés + OR IGNORE suffisent déjà.
- `opening_name`/`eco` par nœud : **nuls en lot 2**. Le nom PAR POSITION exige le
  livre FEN `lichess/chess-openings` (décision #11), livré au lot 3 avec la
  détection de sortie de théorie. Le last-writer per-nœud donnait des noms faux
  (ex. `e4` = « Ponziani Jaenisch ») → retiré.
- Build à froid non filtré (~1 s) : optimisable (représentation colonnaire) si
  un jour la reconstruction sur changement de filtre gêne. Le préchauffage +
  cache rendent ça non prioritaire.
