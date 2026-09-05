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
| 20 | Page d'accueil centrée sur le LLM et les fonctions du projet | EN REVUE |
| 21 | Reprendre automatiquement le workflow après validation des propositions | EN REVUE |

## Lot 6 — Pipeline créatif structuré et médias réels

Ordre approuvé le 2026-09-02. Le storyboard éditable (#28) est le jalon central :
aucune génération vidéo en lot ne commence avant sa validation.

| # | Tâche | Statut |
| --- | --- | --- |
| 22 | Unifier la conversation LLM : les onglets changent le contexte affiché, jamais le fil de discussion | EN REVUE — fil et surface uniques vérifiés au changement d'onglet |
| 23 | Créer la phase « idée structurée » et sa porte de validation avant l'édition détaillée | EN REVUE — proposition unique éditable et blocage serveur vérifiés |
| 24 | Brancher un contrat de génération d'images avec fichiers persistés, provenance, coût prévu et approbation | EN REVUE — adaptateur Google/mock, confirmation, galerie, estimation, prompt et régénération versionnée vérifiés |
| 25 | Générer et contrôler une planche de cohérence personnage : angles, postures et émotions | EN REVUE — sélection explicite, checklist humaine obligatoire et correction ciblée livrées ; la v4 existante reste provisoire tant que les trois contrôles ne sont pas cochés |
| 26 | Générer et contrôler une planche de cohérence décor : angles, lumière et altérations | À FAIRE |
| 27 | Générer le storyboard : une image par plan avec le scénario correspondant sous la frame | À FAIRE |
| 28 | MOMENT CLÉ — rendre chaque image et texte du storyboard modifiable, versionné et régénérable séparément | À FAIRE |
| 29 | Générer le premier plan ou tous les plans validés en clips vidéo muets, selon la durée fournisseur | À FAIRE |
| 30 | Assembler les clips muets dans l'ordre sur la timeline canonique, avec découpe non destructive | À FAIRE |
| 31 | Après verrouillage image, générer et synchroniser dialogues, voix off, bruitages, ambiances et musique | À FAIRE |
| 32 | Tester le parcours complet, ajuster les régressions et produire les captures desktop/mobile de revue | À FAIRE |
| 33 | Démarrer avec le panneau métier gauche replié et l'ouvrir au clic sur un onglet | EN REVUE — comportement desktop/mobile vérifié |
| 34 | BLOQUANT — corriger la boucle de propositions : ne pas resolliciter Gemini pour une décision déjà en attente non tranchée | EN REVUE — déduplication serveur (titre+position+durée, en ignorant les identifiants neufs) et plafond d'une relance automatique implémentés ; 29 tests Node verts ; vérification navigateur interrompue par une coupure de connexion, à reprendre |
| 35 | Proposition d'action/pose par keyframes images (2 alternatives) plutôt que par texte, une fois la bible visuelle validée | À FAIRE — cf. plan.md révision 7, en attente d'approbation |

### Portes de validation

1. Idée structurée : prémisse, genre, format, durée, style, personnages, décors et squelette narratif.
2. Bible visuelle : personnages et décors cohérents sous plusieurs vues, validés ou corrigés séparément.
3. Storyboard éditable : image et scénario de chaque frame modifiables avant verrouillage image.
4. Vidéo muette : génération d'un premier plan de contrôle, puis option de lancer tous les plans validés.
5. Son : génération seulement après verrouillage de l'assemblage image.

## À faire

| # | Tâche | Statut |
| --- | --- | --- |
| 7 | Vue « Tous les projets » et création de projet | À FAIRE |
| 8 | Historique des versions et comparaison avant/après du script | À FAIRE |
| 9 | Sélection partielle dans le script comme contexte joint | À FAIRE |
| 10 | Branchement d'une vraie API à la place de la réponse simulée | À FAIRE |

## Lot 7 — Régie de projet et édition ciblée

Direction visuelle approuvée le 2026-09-03 à partir des maquettes Product Design.

| # | Tâche | Statut |
| --- | --- | --- |
| 36 | Remplacer le rail d’icônes par un contexte de projet à gauche : workflow horizontal, contenu de l’étape et historique dessous | EN REVUE — navigation en six étapes et contexte associé implémentés |
| 37 | Ouvrir chaque référence comme une galerie d’images dérivées et permettre la régénération ciblée d’une image | EN REVUE — angles, postures, émotions et versions ciblées reliés au serveur |
| 38 | Ajouter l’étape Export et ses options de format, résolution, cadence, ratio, audio, sous-titres et qualité | EN REVUE — options manipulables et manifeste local téléchargeable |
| 39 | Tester les parcours desktop/mobile et réaliser la comparaison visuelle avec les maquettes retenues | EN REVUE — QA visuelle passée, captures et rapport `design-qa.md` produits |

### Tests du lot 7

- Logique : 46 tests Node passent, dont la génération d’une variante ciblée, son historique
  persistant, la navigation par étapes, la conservation du fil et les sélections Export.
- UI/UX : parcours vérifié dans le navigateur à 1440 × 1024 et 390 × 844, sans erreur console
  ni débordement de page. Comparaisons côte à côte galerie/Export validées ; voir `design-qa.md`.

## Lot 8 — Atelier visuel synchronisé et modification LLM

Direction visuelle choisie le 2026-09-04 : troisième maquette Product Design.

| # | Tâche | Statut |
| --- | --- | --- |
| 40 | Ouvrir l’asset dans un atelier occupant les deux tiers au-dessus du LLM | EN REVUE — atelier, filmstrip et métadonnées implémentés |
| 41 | Garder le chat visible et rendre la séparation ajustable | EN REVUE — glisser, clavier, préréglages 2/3–1/2 et plein écran vérifiés |
| 42 | Permettre au LLM de modifier un asset existant sans le dupliquer | EN REVUE — opération `update_asset` versionnée et validation humaine ajoutées |
| 43 | Vérifier le rendu et le contrat Gemini en réel | EN REVUE — desktop/mobile, console, comparaison visuelle et appel Google passés |

### Tests du lot 8

- Logique : 46 tests Node passent ; la modification d’un asset conserve son historique média.
- LLM réel : Gemini a choisi `update_asset` avec l’identifiant exact de Shadow, sans application
  automatique de la proposition.
- UI/UX : captures 1440 × 1024 et 390 × 844, aucune erreur console ni débordement de page ;
  rapport `design-qa.md` passé.

## Hors périmètre du lot historique de maquette

- Champ Autonomie, cadenas dans Script, onglets inférieurs.

## Décisions validées

- Prototype unique navigable, cinq onglets : Projet, Script, Production, Personnages, Décors.
- Chronologie du Script en liste verticale actes → séquences → scènes.
- Propositions du LLM champ par champ, avec Appliquer / Ignorer.
- Contenu narratif d'Odyssey rédigé par Claude.

## Lot 4 — Reprise Codex : continuité narrative déclarée

| Tâche | Statut |
| --- | --- |
| États avant/après versionnés, édition dans le storyboard et contrats de l’agent | EN REVUE |
| Comparaison des plans adjacents : contradiction explicite, ellipse et information indéterminée | EN REVUE |
| Preuves et préparation d’une correction ciblée, tests isolés puis vérification en ligne | EN REVUE |

Périmètre : faits déclarés dans le scénario ; aucune analyse de pixels ni génération payante.

Vérification logique : 88 tests passent (80 à la reprise). Les trois cas centraux
sont couverts : écart sur une action directe, reprise explicite dans le plan suivant,
et transition indéterminée ; s’ajoutent ellipse, validation, historique et migration.
Vérification UI : ordinateur 1440 × 1000 et mobile 390 × 844 ; brouillons,
sauvegardes successives, restauration, ajout/retrait de lignes et correction préparée
sans appel fournisseur. Aucun débordement horizontal ni erreur JavaScript.
Déployé sur Fly.io ; endpoints et formulaire vérifiés en ligne en lecture seule.
Révision, versions/identifiants des plans et identifiants médias conservés après déploiement.
Documentation : `docs/narrative-continuity.md`. Analyse du texte libre et des pixels
restent des lots distincts, non revendiqués dans cette livraison.

## Reprise — Parcours scénario → storyboard → vidéo (5 septembre)

| Tâche | Statut |
| --- | --- |
| Corriger l’adresse locale de prévisualisation et rendre le mode du modèle visible | EN COURS |
| Rétablir le défilement et réduire/restaurer l’atelier | EN COURS |
| Rechoisir une ancienne image sans supprimer les versions | EN COURS |
| Décomposer les plans en davantage de vignettes et prévisualiser le rythme | EN COURS |
| Atelier vidéo direct : durée demandée, référence de format, coût et génération | EN COURS |

Validation : tests isolés et parcours navigateur desktop/mobile, sans génération payante de médias.
