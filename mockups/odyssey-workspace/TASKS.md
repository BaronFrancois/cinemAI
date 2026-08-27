# TASKS — CinemAI / Odyssey

Méthode : `CLAUDE.md`. Livrable : `Odyssey Workspace.dc.html`.

## Lot en cours — Utilisabilité de la maquette

| # | Tâche | Statut |
| --- | --- | --- |
| 1 | Plein écran : l'espace de travail occupe toute la fenêtre | EN REVUE |
| 2 | Panneau gauche réductible jusqu'à zéro, LLM plein cadre | EN REVUE |
| 3 | Rail relié au panneau comme un intercalaire de classeur | EN REVUE |
| 4 | Contrôles réellement manipulables (menus, mots-clés, couleurs, dossiers) | EN REVUE |
| 5 | Réordonnancement des séquences par glisser-déposer | EN REVUE |
| 6 | Composeur saisissable, réponse simulée par onglet | EN REVUE |

### Tests

- Logique : à faire après validation du lot.
- UI/UX : à faire après validation du lot.

## Lot 2 — Alignement visuel sur les captures de référence

| # | Tâche | Statut |
| --- | --- | --- |
| 11 | Barre de navigation en pilules centrées | ABANDONNÉ — le rail-intercalaire est conservé |
| 12 | Fonds recalés : châssis quasi-noir, panneaux relevés, bordures plus fines | EN REVUE |
| 13 | Poignées de repli en languettes verticales sur les bords des panneaux | EN REVUE |
| 14 | Titres de section en petites capitales espacées, monospace sur les termes techniques | EN REVUE |
| 15 | Densité resserrée : hauteurs de contrôles, interlignes, marges | EN REVUE |
| 16 | Accent d'action principale | VALIDÉ — cobalt, vert réservé aux statuts « validé » |

Hors périmètre du lot : contenu, structure des cinq écrans, comportement du split.
Rythme validé : une tâche à la fois.

| 17 | Alignement rail/panneau, réduction simplifiée, CRUD complet | EN REVUE |
| 18 | Boutons alignés sur la hauteur des encarts, séparateur sans trait | EN REVUE |
| 19 | Le LLM renvoie vers l'onglet concerné | EN REVUE |

## À faire

| # | Tâche | Statut |
| --- | --- | --- |
| 7 | Vue « Tous les projets » et création de projet | À FAIRE |
| 8 | Historique des versions et comparaison avant/après du script | À FAIRE |
| 9 | Sélection partielle dans le script comme contexte joint | À FAIRE |
| 10 | Branchement d'une vraie API à la place de la réponse simulée | À FAIRE |

## Hors périmètre

- Génération d'images ou de vidéos réelles.
- Champ Autonomie, cadenas dans Script, onglets inférieurs.

## Décisions validées

- Prototype unique navigable, cinq onglets : Projet, Script, Production, Personnages, Décors.
- Chronologie du Script en liste verticale actes → séquences → scènes.
- Propositions du LLM champ par champ, avec Appliquer / Ignorer.
- Contenu narratif d'Odyssey rédigé par Claude.
