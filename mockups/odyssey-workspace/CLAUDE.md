# Méthode de travail — CinemAI / Odyssey

`TASKS.md` est la seule source de vérité. Toute demande formulée en conversation
devient une tâche dans ce fichier avant d'être traitée. Aucune tâche n'est
« terminée » : elle est **validée** par l'utilisateur, ou elle reste ouverte.

## Statuts

| Statut | Sens |
| --- | --- |
| `À FAIRE` | Décrite, pas commencée |
| `PLAN` | Plan proposé, en attente de révision |
| `EN COURS` | Exécution en cours |
| `EN REVUE` | Livrée, en attente du verdict utilisateur |
| `VALIDÉ` | Acceptée explicitement par l'utilisateur |
| `ABANDONNÉ` | Écartée, avec la raison en une ligne |

## Boucle 1 — Cadrage du plan

1. Écrire le plan dans `TASKS.md` (tâches, ordre, ce qui est explicitement hors périmètre).
2. Le soumettre à révision.
3. Correction → nouvelle révision.
4. Sortie de boucle : validation de l'utilisateur, ou **3 tours maximum** — au
   troisième, présenter 2 options concrètes et demander un choix plutôt que
   de reformuler une quatrième fois.

Un plan qui dépasse 8 tâches est découpé en lots livrables séparément.

## Boucle 2 — Exécution

Une tâche à la fois, dans l'ordre du plan. Pour chaque tâche : exécution →
revue → correction → revue, jusqu'à `VALIDÉ`. Le statut est mis à jour dans
`TASKS.md` au moment du changement, pas en fin de session.

Rien n'est ajouté hors plan. Une idée qui surgit pendant l'exécution est
inscrite en `À FAIRE` et proposée, jamais implémentée à la volée.

## Phase de test — deux passes distinctes

**1. Logique** — états et transitions atteignables, données cohérentes d'un
écran à l'autre, règles d'héritage respectées (un état de personnage ou de
décor ne contredit jamais sa Base), aucune action sans retour visible, aucune
erreur console.

**2. UI/UX** — parcours réalisable sans explication, densité et hiérarchie
lisibles, contraste et taille de texte suffisants, cibles cliquables ≥ 32 px,
aucun débordement ni élément coupé, comportement correct aux largeurs extrêmes
du split (panneau réduit à zéro, panneau étendu au maximum).

Les deux passes sont consignées dans `TASKS.md` sous la tâche concernée. Un
test échoué rouvre la tâche en `EN COURS`.

## Règles de fond

- Réponses et interface en français.
- Le style visuel suit le design system attaché : bleu nuit et graphite,
  surfaces imbriquées, grands arrondis, cobalt réservé aux actions
  principales et à la sélection active.
- Décisions figées, à ne pas remettre en cause sans demande explicite :
  split 50/50 par défaut redimensionnable, barre centrale avec ‹ ›, LLM
  toujours visible, contexte de l'onglet joint et détachable, un contrôle par
  décision (format, résolution, durée, générateur séparés), sauvegarde
  automatique, aucun cadenas dans Script, aucun champ Autonomie.
- Modification demandée = modification ciblée. Pas de redesign non demandé.
