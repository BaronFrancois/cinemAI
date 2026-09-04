# Handoff — cinemai-foundation

## État courant

- Statut : `executing`
- Révision de plan : 6
- Révision approuvée : 6
- Étape terminée techniquement : manifeste-first, approbations humaines et cockpit Odyssey connecté
- Checkpoint courant : #22 à #24 en revue technique ; ajouter le contrôle humain de cohérence personnage (#25)

## Ce qui est établi

Le studio démarre sans projet, personnage, décor, plan ni média d’exemple. Le manifeste persistant est l’unique source de vérité pour le projet, les assets, les séquences, les plans, la timeline, les propositions et la file de production. Le LLM peut proposer huit opérations typées ; aucune opération ne modifie le manifeste avant une décision humaine explicite.

Production et Export lisent la même timeline canonique. Elle comporte une piste visuelle et cinq pistes audio séparées : dialogues, voix off, bruitages, ambiances et musique. La file locale applique des transitions contrôlées et ne déclenche aucun fournisseur payant.

L’interface Odyssey responsive expose six onglets, le copilote persistant, les cartes d’approbation, la file et la timeline. Le design Odyssey précédemment validé a été restauré. La première réponse est limitée à deux propositions et les suivantes à trois ; format, durée et stratégie de plan peuvent être ajustés directement avant validation. Le guide `test-guide.html` contient huit prompts paramétrables et les résultats attendus, sans données narratives préchargées.

Preuves automatisées : 20 tests Node verts ; smoke Playwright desktop/mobile sur les six onglets, clavier, bouton et guide ; smoke Playwright isolé prouvant proposition visible, déduplication, absence de mutation initiale, validation explicite et application des paramètres ajustés. Les captures desktop/mobile ont été inspectées visuellement.

## Limites explicites

- Gemini ne fait actuellement que l’orchestration textuelle et les appels d’outils structurés.
- Nano Banana, Veo, génération audio, rendu final, export YouTube et suivi analytics ne sont pas encore branchés.
- Le bouton d’avancement des jobs simule uniquement le cycle de production local.
- La validation UX par François reste distincte des tests automatisés.
- Claude Code n’est pas branché comme réviseur : `claude mcp serve` expose des outils, pas une seconde intelligence. Une revue headless réelle impliquerait l’envoi de code à Anthropic et attend un consentement explicite sur le périmètre transmis.

## Nouveau workflow approuvé

Le parcours cible est désormais séquencé par cinq portes : idée structurée et validée, bible
visuelle personnages/décors, storyboard image + scénario entièrement éditable, génération et
assemblage des clips muets, puis génération du son. Les tâches #22 à #32 de `TASKS.md` constituent
l'ordre canonique. Le storyboard éditable (#28) est le jalon central et bloque la génération vidéo
en lot tant qu'il n'est pas validé.

Une seule conversation LLM doit survivre à toute la navigation. Les onglets ne sélectionnent qu'un
contexte métier à joindre au prochain message ; ils ne sélectionnent plus une mémoire distincte.

## Preuves du checkpoint du 2026-09-02

- le navigateur conserve les mêmes messages et propositions en passant de Projet à Personnages ;
- le manifeste possède une collection `media` versionnée et relie chaque image à son asset ;
- `/api/assets/:id/images/generate` exige `GENERATE_IMAGE`, utilise un adaptateur mock ou Google,
  persiste le fichier et `/api/media/:id` le sert sans exposer la clé ;
- Personnages et Décors affichent une galerie, l'état vide et le bouton de planche de cohérence ;
- 26 tests Node sont verts, dont persistance, confirmation, média visible et contrat Google ;
- captures inspectées : `tests/cinemai-image-gallery-desktop.png` et
  `tests/cinemai-image-gallery-mobile.png` ;
- `https://cinem-ai-gamma.vercel.app/` renvoie actuellement 500
  `FUNCTION_INVOCATION_FAILED`. Le stockage local devra être remplacé avant un déploiement durable.

### Porte « idée structurée »

- sans projet, le serveur ne conserve qu'une proposition `set_project` et écarte toute création
  prématurée d'asset, séquence ou plan ;
- la carte présente des champs modifiables pour la prémisse, le genre, la direction visuelle, le
  squelette narratif, le format et la durée ;
- l'approbation inscrit ces champs dans le manifeste avec le statut `structured` ;
- le store refuse les entités détaillées tant que cette porte n'est pas validée ;
- 28 tests Node sont verts et aucune erreur console n'a été observée ;
- captures inspectées : `tests/cinemai-structured-idea-desktop.png` et
  `tests/cinemai-structured-idea-mobile.png`.
- le panneau métier gauche démarre replié ; le rail reste disponible et un clic sur un onglet
  rouvre le panneau sur la bonne section, sans erreur console (tâche #33).

### Contrat image complété

- le coût estimé par résolution est exposé avant confirmation et peut être ajusté par variables
  d'environnement sans modifier le code ; le mode mock annonce toujours un coût nul ;
- chaque fiche accepte une direction supplémentaire, le choix 512/1K/2K/4K et une régénération
  ciblée qui crée une nouvelle version sans écraser les précédentes ;
- une régénération s'ancre par défaut sur la planche validée ; « Repartir de zéro » reste explicite ;
- les médias conservent modèle, prompt, version et coût estimé dans le manifeste ;
- 33 tests Node sont verts, aucun appel Google n'a été lancé par les tests et aucune erreur console
  n'a été observée pendant la revue ;
- captures inspectées : `tests/cinemai-image-controls-desktop.png` et
  `tests/cinemai-image-controls-mobile.png`.

## Prochaine action exacte

Faire valider #25 par François dans l'onglet Personnages : contrôler la v4, cocher uniquement les
critères réellement présents, puis soit la revalider comme référence, soit utiliser « Préparer une
correction ciblée ». Ensuite seulement, reprendre #26 avec la même porte de contrôle pour le décor.
Ne déclencher aucun appel Google sans approbation explicite. Le port 8001 reste réservé.

## Checkpoint du 2026-09-02 — contrôle humain personnage (#25)

- une image de personnage ne peut devenir une référence approuvée que si les contrôles angles,
  postures et émotions sont tous confirmés ; le store refuse une checklist incomplète ;
- une version approuvée est choisie explicitement et reste l'ancre même si une version plus récente
  existe ; une version simplement générée est désormais qualifiée de provisoire dans les prompts ;
- les anciennes validations sans checklist restent visibles mais apparaissent « contrôle à
  compléter » et ne sont plus présentées comme une bible visuelle validée ;
- « Préparer une correction ciblée » transforme les critères non cochés en direction de
  régénération sans lancer d'appel fournisseur et sans écraser la version existante ;
- 35 tests Node passent, dont le refus d'une validation personnage incomplète et l'ancrage sur une
  version explicitement approuvée ; aucun appel Google n'a été lancé ;
- revue desktop réelle : blocage actionnable vérifié, direction ciblée préremplie et capture
  inspectée dans `tests/cinemai-character-review-desktop.png` ;
- la passe mobile a été interrompue après une page locale devenue inaccessible dans le navigateur ;
  aucune tentative de contournement n'a été faite. La capture mobile reste à reprendre au prochain
  passage avec une connexion locale stable.

## Correction Claude (Cowork) — 2026-09-02

Diagnostic demandé par François sur trois symptômes signalés en session : images de personnages/décors invisibles, et échec de génération d'images en local.

- **Cause racine images invisibles** : `production-store.mjs`, fonction de snapshot (état envoyé au navigateur), ne conservait que `{ id, targetId, kind, purpose, version }` pour chaque média — `url`, `targetType`, `mimeType`, `provider`, `model` étaient supprimés. Or `workspace-bridge.js::mediaForAsset` filtre sur `media.targetType === "asset"` et `assetCard` affiche `<img src="item.url">`. Sans `targetType` le filtre ne retenait jamais rien ; sans `url` l'image aurait de toute façon été vide. Corrigé en incluant ces champs dans le mapping du snapshot. 28 tests toujours verts après correction.
- **Cause génération d'image impossible en local** : `.env` a `CINEMAI_LLM_MODE=mock`. Ce mode bascule aussi la génération d'image sur l'adaptateur factice (`createMockImage`, SVG déterministe) — `callGeminiImage` (vrai appel Google) n'est jamais atteint tant que ce mode reste actif. Pour tester la vraie génération, passer `CINEMAI_LLM_MODE=google` (et `CINEMAI_SERVER_PORT` reste à ajuster séparément si le port 8001 doit être évité).
- Non traité dans cette passe (hors périmètre du diagnostic demandé, à vérifier par le prochain incrément Codex) : le changement de conversation LLM perçu au changement d'onglet, et la boucle qui semblait tourner en rond sur une étape — le handoff précédent (checkpoint #33) indique un correctif déjà tenté sur la persistance du fil unique ; à re-tester manuellement onglet par onglet avant de conclure.
