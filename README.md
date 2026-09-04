# CinemAI

CinemAI est un atelier local-first pour préparer une séquence générative, suivre ses
références de continuité et corriger un plan sans relancer toute la production.

## Première preuve recherchée

Sur une séquence fixture de cinq plans :

1. identifier une incohérence locale ;
2. préparer une nouvelle version du seul plan concerné ;
3. conserver les quatre autres plans inchangés ;
4. lister les dépendances de continuité à revoir.

La qualité des pixels générés et le choix d'un fournisseur vidéo ne font pas encore partie
de cette première preuve.

## Workspace Odyssey

La surface canonique actuelle se trouve dans `mockups/odyssey-workspace/`.

Le workspace propose désormais une régie de projet à gauche et six étapes horizontales : Idée,
Bible, Storyboard, Vidéo, Son et Export. Le contenu situé sous ces étapes décrit les références,
l’historique et les actions propres à l’étape active. Changer d’étape modifie uniquement le
contexte joint au prochain message : la conversation de production reste unique. `index.html`
fonctionne sans React ni CDN. La clé Gemini reste exclusivement dans le serveur local.

Pour un nouveau projet, la première réponse est une seule présentation structurée — prémisse,
genre, direction visuelle, squelette narratif, format et durée. Ces champs peuvent être corrigés
dans la carte avant validation ; assets, séquences et plans restent bloqués jusque-là.

### Lancer CinemAI

Depuis `H:\0perso\CinemAI` :

```powershell
node server.mjs
```

Ouvrir ensuite `http://127.0.0.1:4175`. Le serveur sert l'interface et l'API sur le même
domaine. Ne plus utiliser `python -m http.server` pour tester le composeur Gemini.

## Préparer la clé Google

Créer le fichier local qui contiendra la clé :

```powershell
Copy-Item H:\0perso\CinemAI\.env.example H:\0perso\CinemAI\.env
```

Ouvrir ensuite `.env` et remplacer :

```dotenv
GEMINI_API_KEY=remplacer_par_votre_cle_google
```

Ne placez jamais la clé dans `index.html`, dans une variable préfixée `VITE_`, dans une
capture ou dans la conversation. Le serveur local est seul autorisé à lire `.env`.

Pour activer Gemini après avoir renseigné la clé et le modèle :

```dotenv
CINEMAI_LLM_MODE=google
```

Conserver `mock` pour exécuter les tests ou travailler hors ligne.

## Générer les premières images

Après validation d'un personnage ou d'un décor, ouvrir sa section et utiliser le bouton de
génération de planche. Le clic constitue la confirmation explicite de l'appel au fournisseur :
aucune image payante n'est produite automatiquement par le LLM.

Avant ce clic, la fiche affiche une estimation selon la résolution choisie. Une direction
supplémentaire peut être saisie pour corriger localement la planche ; chaque régénération crée une
nouvelle version et conserve l'historique. Par défaut, la dernière référence validée sert d'ancre
d'identité, sauf si « Repartir de zéro » est coché explicitement.

- en mode `mock`, CinemAI crée une planche SVG déterministe et gratuite ;
- en mode `google`, le serveur appelle `GEMINI_IMAGE_MODEL`, enregistre le fichier dans
  `data/media/`, puis attache son URL, son prompt, son modèle et sa version au manifeste ;
- les médias restent servis par `/api/media/:id` et la clé ne quitte jamais le serveur.

Depuis l’étape Bible, cliquer sur une référence comme Shadow ouvre toutes ses images dérivées.
Chaque angle, posture, émotion ou variation de décor peut être généré ou régénéré séparément,
avec son propre prompt et son historique. La planche approuvée reste l’ancre d’identité ; les
anciennes planches de contact sont conservées et ne sont pas découpées automatiquement.

L’asset s’ouvre dans un atelier synchronisé au-dessus de la conversation : deux tiers pour
l’image, ses versions et ses contrôles, un tiers pour le LLM. Le séparateur se règle à la souris
ou au clavier, les préréglages `2/3` et `1/2` sont disponibles, et le plein écran reste réversible.
Sur desktop, l’historique du dialogue et le composeur restent côte à côte ; sur mobile, ils se
replient verticalement sans masquer l’envoi.

## Modifier le projet avec le LLM

Gemini peut proposer une modification ciblée d’un asset existant via `update_asset`. La proposition
affiche le nom et la nouvelle description, puis attend « Utiliser cette proposition » avant toute
écriture. Les images, références et versions média de l’asset ne sont jamais remplacées par cette
opération.

Pour vérifier le mode réellement utilisé par le serveur :

```text
http://127.0.0.1:4175/api/health
```

La réponse doit contenir `"mode":"google"`. Une variable de lancement comme
`CINEMAI_LLM_MODE=mock` a priorité sur `.env` et désactive volontairement les propositions Gemini.

## Export

L’étape Export permet de préparer le format, la définition, la cadence, le ratio, l’audio, les
sous-titres, le filigrane et la qualité de livraison. Dans cette version locale, « Lancer
l’export » télécharge un manifeste JSON qui décrit ces choix. L’assemblage, l’encodage et le
multiplexage de la vidéo finale restent à brancher sur ce contrat.

Cette persistance sur disque convient au développement local. Un déploiement serverless comme
Vercel devra remplacer `data/media/` et `data/workspace.json` par un stockage durable.

### Vérifier hors ligne

```powershell
node --test tests/server.test.mjs
```

Ces tests remplacent le transport Google par un faux transport déterministe : ils ne
consomment aucun quota.

## Maquette P0 historique

La première preuve interactive reste disponible dans `mockups/workspace-v1/`.

```powershell
python -m http.server 4173 --directory H:\0perso\CinemAI\mockups\workspace-v1
```

Ouvrir ensuite `http://127.0.0.1:4173`.

Parcours démontré : sélectionner le plan 03, constater la rupture de continuité, préparer
la correction, puis comparer l'impact. L'export produit un JSON de démonstration local.

## État

- P0 : contrat, première preuve et workspace Odyssey validés techniquement ; validation
  visuelle humaine en attente.
- LLM texte : serveur local et Gemini Flash 3.5 intégrés, appel réel minimal validé.
- P1 à P3 : non commencés.
- Nano Banana : premier adaptateur et galerie de cohérence branchés ; appel réel à déclencher
  manuellement depuis la fiche d'un asset.
- Omni et Veo : étudiés, mais la génération vidéo n'est pas encore branchée.
