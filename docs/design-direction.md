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

## Odyssey agentique — révision 4

### Travail unique

Faire passer un projet vierge d'une intention à une production traçable, sans cacher les
actions de l'agent et sans préremplir l'imaginaire de l'utilisateur.

### Tokens conservés

- `Nuit plateau` — `#10141d` : fond général.
- `Ardoise` — `#1b212c` : panneaux métier.
- `Régie` — `#252c38` : cartes et pistes.
- `Bleu validation` — `#4d7cff` : action approuvée ou sélection.
- `Ambre attente` — `#d8a64d` : proposition qui attend une décision.
- `Vert prêt` — `#67c79a` : job terminé ou élément validé.
- `Craie` — `#f4f6fb` : texte principal.

`Segoe UI Variable` porte l'interface, `Bahnschrift` les titres de plateau et `Cascadia Mono`
les IDs, versions, timecodes et états. Aucun téléchargement de police n'est nécessaire.

### Structure

```text
┌ Navigation ┬ Surface métier vide ou alimentée ┬ Assistant général ┐
│ 6 onglets  │ manifeste / assets / plans       │ conversation       │
│            │ file + timeline canonique        │ propositions       │
└────────────┴───────────────────────────────────┴────────────────────┘
```

Sur mobile, la surface métier précède la conversation et la navigation devient une barre
basse. La production courante reste résumée dans l'en-tête afin de ne jamais disparaître.

### Signature

Une « ligne de régie » verticale relie les propositions, validations, jobs et clips issus de
la même action. Elle matérialise la provenance d'un résultat plutôt que de décorer l'écran.

### Autocritique

Une page vide pure serait élégante mais inutilisable ; un exemple prérempli orienterait le
projet et violerait la demande. La solution retenue utilise des états vides instructifs et des
boutons d'action sans contenu narratif. L'audace reste concentrée sur la ligne de régie ; les
cartes, contrôles et onglets conservent la géométrie Odyssey existante.
