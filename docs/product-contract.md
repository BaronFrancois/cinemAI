# Contrat produit P0 — CinemAI Continuum

## Public

Créateur indépendant ou petite équipe qui prépare une courte séquence générative et veut
maîtriser les reprises sans manipuler directement un graphe ou du JSON.

## Travail principal de l'écran

Rendre la chaîne suivante explicite :

`projet → assets stables → plans → incohérence → correction locale → impact vérifiable`

## Entrées du futur moteur

- un projet et son format ;
- des assets identifiés et versionnés ;
- cinq plans ordonnés ;
- les états de continuité attendus par plan ;
- une instruction de correction ciblée.

## Sorties du futur moteur

- un paquet de génération autonome pour chaque plan ;
- une nouvelle version uniquement pour la cible ;
- les hashes avant/après ;
- la liste des dépendances potentiellement affectées ;
- la provenance, les paramètres, les erreurs et la validation humaine.

## États UI communs

- `stable` : aucune incohérence détectée ;
- `issue` : différence entre état attendu et état observé ;
- `prepared` : nouvelle version locale prête, non générée ;
- `review` : dépendance à contrôler humainement ;
- `failed` : action impossible avec raison et prochaine action.

## Règles d'interaction

1. Une action principale annonce exactement son effet.
2. Aucune correction ne régénère automatiquement les plans dépendants.
3. L'impact est affiché avant une intégration vidéo payante.
4. La couleur n'est jamais le seul indicateur d'état.
5. L'assistance et l'automatisation utilisent le même pipeline ; seul le niveau d'autonomie
   varie.

## Critère de sortie P0

Le contrat est compréhensible sans conversation, et la maquette permet de parcourir les
états `issue → prepared` avec une trace visible de l'impact. La maquette n'est pas une preuve
du moteur P1–P3.

