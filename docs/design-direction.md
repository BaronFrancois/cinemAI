# Direction de maquette — Workspace v1

## Ancrage

- Sujet : table de continuité d'un court film génératif.
- Public : réalisateur indépendant ou petite équipe.
- Travail unique : localiser une rupture et préparer sa correction sans perdre le reste.

## Héritage AIssistant vérifié

La maquette reprend les conventions observées dans AIssistant :

- rail latéral hiérarchique et surface centrale dockée ;
- inspecteur/assistant à droite sans recouvrir le contenu ;
- fonds froids et panneaux crème ;
- accent bleu pétrole et bleu d'action ;
- boutons calmes en relief, état actif enfoncé ;
- thème clair/sombre et focus visible.

Sources locales inspectées : `src/App.tsx`, `src/components/Sidebar.tsx` et les tokens du
système de thème dans `src/index.css`.

## Tokens

- `Brume` — `#EEF2F6` : fond du workspace.
- `Ivoire` — `#FBF6E9` : rails et panneaux de travail.
- `Papier` — `#FFFEFA` : cartes et champs.
- `Pétrole` — `#0C5F8F` : sélection et navigation.
- `Bleu action` — `#1642E5` : action principale.
- `Corail script` — `#C2412D` : rupture de continuité.
- `Vert montage` — `#16784A` : état préparé ou stable.
- `Encre` — `#242018` : texte principal.

Typographies sans téléchargement : `Segoe UI Variable` pour l'interface, `Bahnschrift`
pour les titres courts et `Cascadia Mono` pour IDs, durées et états.

## Structure

```text
┌──────────────────────── Barre projet + actions ───────────────────────┐
├──────────────┬──────────────────────────────────────┬─────────────────┤
│ Projet       │ Objectif de travail                  │ Continuité      │
│ Assets       │                                      │ Écart observé   │
│ Plans (5)    │ Bande des cinq plans traversée       │ État attendu    │
│ Historique   │ par la ligne de continuité           │ Impact          │
│              │                                      │ [Préparer]      │
└──────────────┴──────────────────────────────────────┴─────────────────┘
```

## Signature

Une ligne de continuité traverse réellement les cartes de plans. Elle est pleine lorsque
l'état est stable, se rompt au plan incohérent et redevient continue après préparation de la
correction. Elle encode donc une information, pas une décoration.

## Autocritique avant construction

La première piste ressemblait trop à un dashboard cinéma sombre avec grandes cartes et
gradients. Elle a été rejetée : elle n'aurait ni repris la logique familière d'AIssistant ni
rendu la correction locale plus lisible. La version construite conserve le calme
skeuomorphe d'AIssistant et dépense son audace sur une seule chose, la ligne de continuité.

