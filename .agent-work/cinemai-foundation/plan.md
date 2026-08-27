# CinemAI — plan canonique

## Révision 1 — proposition en attente d'approbation

Créée le 2026-08-20 par Codex.

### Objectif et valeur attendue

Produire un premier vertical slice de **CinemAI Continuum** qui démontre une propriété
précise : corriger un plan ou un segment sans régénérer toute la séquence, tout en gardant
des références de continuité traçables.

La valeur recherchée n'est pas encore la qualité visuelle finale. C'est la preuve que le
workflow sait isoler une correction et expliquer ses conséquences.

### État initial

- `verified` — le dossier `H:\0perso\CinemAI` existe et était vide au démarrage du plan.
- `verified` — aucun framework, dépôt Git, modèle ou fournisseur n'est encore choisi.
- `verified` — le besoin exprimé porte sur un workflow cinéma indépendant d'AIssistant.
- `inferred` — le nom public est **CinemAI** et le moteur de workflow peut s'appeler
  **Continuum** ; ce sous-nom reste réversible.
- `proposed` — commencer par le moteur et sa preuve déterministe avant une interface riche.
- `unknown` — la première cible d'exécution : Windows, Mac M1 Max, ou les deux.
- `unknown` — le premier générateur vidéo réel à brancher après validation du cœur.

### Étapes proposées

#### P0 — Figer le contrat du prototype

Livrable : un README court décrivant l'entrée, la sortie, la correction locale et le cas
de démonstration de cinq plans.

Preuve : chaque critère d'acceptation du `task.yaml` est relié à une étape et à un test.

#### P1 — Définir le Production Manifest minimal

Livrable : un schéma versionné contenant seulement projet, assets, personnages, plans,
segments, états de continuité, paramètres de génération et provenance.

Preuves : validation d'un manifeste correct ; refus documenté des identifiants dupliqués,
références absentes et versions incompatibles.

#### P2 — Compiler un plan de façon déterministe

Livrable : une commande locale qui transforme un plan et ses identifiants stables en un
`GenerationPacket` autonome et sérialisable.

Preuves : deux compilations de la même entrée ont le même hash ; changer un champ pertinent
du plan change son hash ; les secrets et chemins machine ne figurent pas dans le paquet.

#### P3 — Démontrer la correction locale

Livrable : un faux adaptateur de génération déterministe, une séquence fixture de cinq plans
et une opération `revise-shot` ciblant un plan ou un segment.

Preuves : le plan ciblé obtient une nouvelle version ; les quatre autres sorties restent
byte-for-byte identiques ; la liste des dépendances de continuité à revoir est produite.

#### P4 — Ajouter une surface de contrôle minimale

Livrable : une interface locale simple permettant de voir les cinq plans, sélectionner le
plan fautif, décrire la correction et comparer avant/après.

Preuves : parcours réel desktop ; navigation clavier ; focus et libellés ; console sans
erreur ; requêtes réseau inspectées ; distinction entre tests techniques et jugement UX.

#### P5 — Brancher un premier générateur réel

Livrable : un adaptateur remplaçable qui respecte le même `GenerationPacket` et conserve la
provenance, les paramètres, le coût, les erreurs et les versions.

Preuves : un plan de test peut être généré sans changer le manifeste ni le moteur de
correction ; l'échec fournisseur laisse l'état canonique récupérable.

Cette étape contient un point de décision humain sur le fournisseur, le budget et la machine.

### Dépendances et ordre

`P0 → P1 → P2 → P3 → P4 → P5`

P3 constitue la preuve centrale du MVP. P4 et P5 ne commencent que si cette preuve passe.

### Risques et retours arrière

- Sur-conception du schéma : supprimer tout champ sans usage dans la fixture de cinq plans.
- Confusion entre continuité déclarée et pixels réellement cohérents : présenter séparément
  les références traçables, les alertes et le jugement visuel humain.
- Couplage fournisseur : garder l'adaptateur derrière le paquet canonique ; revenir au faux
  adaptateur si le service réel est indisponible.
- Régénération en cascade : signaler les dépendances affectées sans les régénérer
  automatiquement dans ce premier MVP.
- Coût ou performance inconnus : benchmarker un seul plan court et basse résolution avant
  toute extension.

Rollback général : les manifests et sorties sont versionnés ; une correction crée une
nouvelle version et ne réécrit pas la précédente.

### Exclusions explicites de la révision 1

- scénario automatique complet ;
- audio, doublage et musique ;
- entraînement LoRA ou distillation de SLM ;
- publication et optimisation de réseaux sociaux ;
- collaboration cloud multi-utilisateur ;
- promesse d'édition pixel/multicouche d'une vidéo générée.

### Autocritique de la révision 1

1. Le plan initial risquait de confondre moteur de continuité et studio complet. La coupure
   après P3 borne maintenant la preuve centrale.
2. Une vraie génération vidéo dès le début rendrait les tests lents, coûteux et non
   déterministes. Le faux adaptateur de P3 permet d'abord de prouver l'isolation des changements.
3. La cohérence visuelle ne peut pas être prouvée uniquement par hash. P4 prévoit donc une
   comparaison humaine avant/après, séparée des preuves techniques.
4. Le stack n'est volontairement pas fixé : le choisir avant le contrat du prototype ne
   produit aucune preuve supplémentaire et compliquerait le rollback.

Conclusion de critique : la révision est cohérente avec les critères d'acceptation. La seule
bifurcation non bloquante est la cible Windows/Mac ; elle peut être décidée avant P2.

### Delta

Première révision : aucun delta antérieur.

### Validation

- État : `awaiting_approval`
- Révision approuvée : aucune
- Portée demandée : P0 à P3 comme MVP cœur ; P4 et P5 comme étapes conditionnelles

## Révision 2 — workspace Odyssey approuvé

Approuvée le 2026-08-22 par François avec l'instruction « Allez-y pour
l'implémentation ».

### Objectif du lot

Importer l'export Claude Design comme nouvelle surface canonique, rendre ses six onglets
réellement utilisables hors de Claude Design et stabiliser le design sur desktop et mobile,
sans intégrer de LLM ni demander de clé Google.

### État initial vérifié

- `verified` — l'export Odyssey contient six panneaux et six conversations associées ;
- `verified` — l'export brut dépend de React chargé depuis `unpkg.com` et affiche un écran
  vide lorsque l'accès réseau est refusé ;
- `verified` — la mise en page desktop initiale comprime les deux panneaux jusqu'à devenir
  illisible à 390 px ;
- `verified` — la première maquette P0 reste disponible et ne doit pas être écrasée.

### Étapes approuvées

1. Importer l'archive dans `mockups/odyssey-workspace/` en préservant sa source.
2. Produire un `index.html` autonome sans runtime Claude Design, React ni CDN.
3. Vérifier les six couples onglet/panneau/conversation et le composeur simulé.
4. Ajouter navigation clavier, sémantique d'onglets et séparateur accessible.
5. Remplacer le split mobile illisible par deux surfaces verticales et une navigation basse.
6. Tester desktop et mobile, console, réseau, clavier et débordements.

### Preuves attendues

- les six onglets activent exactement le panneau et la conversation correspondants ;
- le chargement n'émet aucune requête vers un domaine externe ;
- aucune erreur console ou erreur de page ;
- le clavier permet de changer d'onglet et d'ajuster le split desktop ;
- à 390 px, le contenu conserve sa largeur de lecture et le LLM reste visible sous le
  panneau métier ;
- l'interface conserve le rail-intercalaire sur desktop et devient une navigation basse
  compacte sur mobile.

### Exclusions

- API Google, OAuth, clés, modèles et réponses LLM réelles ;
- persistance des projets ;
- génération d'images, de vidéos ou d'audio ;
- moteur P1–P3 et exports réels.

### Delta depuis la révision 1

La révision 1 prouvait le concept de correction locale dans une petite maquette. La révision
2 ajoute la surface complète Odyssey et avance sa stabilisation UI avant le branchement LLM
demandé par François. Le moteur déterministe reste nécessaire, mais n'est pas confondu avec
ce lot d'interface.

### Validation

- État : `approved`
- Révision approuvée : 2
- Portée : import, autonomie, onglets, responsive et vérification UI

## Révision 3 — intégration Gemini Flash en autorun

Approuvée le 2026-08-24 par François avec l'instruction d'exécuter en autorun pendant son
absence.

### Objectif du lot

Remplacer la réponse simulée du composeur Odyssey par un appel serveur local à
`gemini-3.5-flash`, sans exposer la clé au navigateur et sans intégrer encore la génération
d'images ou de vidéos.

### Étapes approuvées

1. Créer un serveur Node 20 sans dépendance externe et servir Odyssey sur le même domaine.
2. Charger `.env` côté serveur, sans journaliser ni renvoyer la clé.
3. Ajouter `/api/health` et `/api/chat` avec validation, timeout, limite de taille et erreurs
   structurées.
4. Construire le contexte Gemini à partir de l'onglet actif et de l'instruction utilisateur.
5. Brancher le composeur UI avec état d'attente, réponse réelle et repli simulé explicite.
6. Tester le serveur en mode mock, les erreurs, le navigateur desktop/mobile et une requête
   réelle minimale vers Flash 3.5.

### Critères d'acceptation

- aucune clé présente dans HTML, réponse HTTP, logs ou captures ;
- `/api/health` indique le mode et le modèle sans exposer de secret ;
- `/api/chat` refuse méthode, JSON, message ou onglet invalides ;
- le composeur affiche une réponse Gemini et une erreur actionnable en cas d'échec ;
- l'UI statique et les six onglets restent fonctionnels ;
- un seul appel réel minimal confirme l'intégration, distinct des tests mock déterministes.

### Exclusions

- Nano Banana, Omni, Veo et fournisseurs tiers ;
- streaming token par token ;
- historique persistant et comptes utilisateurs ;
- déploiement public ou écoute réseau autre que `127.0.0.1`.

### Validation

- État : `approved`
- Révision approuvée : 3
- Autorisation : exécution autonome immédiate

## Révision 4 — manifeste, outils et production visible

Approuvée le 2026-08-27 par François avec l'instruction d'exécuter pendant son absence,
sans aucune donnée d'exemple dans l'application et avec un guide HTML séparé pour les tests.

### Objectif du lot

Transformer Odyssey en workspace réellement vide et pilotable : le LLM propose des opérations
typées, l'humain les accepte ou les refuse, le manifeste versionné devient la source de vérité,
et les onglets affichent la même file de production et la même timeline vidéo/audio.

### État initial vérifié

- `verified` — l'interface contient un film, des assets, des plans et des conversations fictifs ;
- `verified` — `/api/chat` ne traite que du texte et aucun `functionCall` Gemini ;
- `verified` — aucune persistance, file, timeline canonique ou transition d'état n'existe ;
- `verified` — le dépôt Git local a été initialisé avant ce lot avec le commit de référence
  `ac86ac5` ;
- `verified` — Claude Code 2.1.236 est installé ; son mode serveur MCP expose des outils, pas
  le modèle Claude. La critique sera donc exécutée en CLI non interactif et lecture seule.

### Étapes approuvées

1. Créer un manifeste vide versionné, un journal d'opérations et une persistance locale atomique.
2. Ajouter des opérations typées pour projet, assets, plans, timeline et file de génération.
3. Exposer lecture, propositions, validation/refus et transitions de jobs via l'API locale.
4. Permettre à Gemini de proposer ces opérations par function calling, sans application implicite.
5. Remplacer les données Odyssey codées en dur par des projections du manifeste et des états vides.
6. Afficher une file persistante et une timeline simple avec pistes image/vidéo et audio séparées.
7. Créer un HTML autonome contenant les prompts, actions et résultats attendus pour la validation.
8. Tester logique, erreurs, persistance, correction locale, desktop, mobile, clavier et réseau.
9. Faire critiquer le plan et les preuves par Claude Code en lecture seule ; Codex reste l'unique
   écrivain canonique.

### Critères d'acceptation

- aucun contenu créatif prérempli dans l'application ;
- le premier chargement affiche des invitations à créer, pas des exemples ;
- une proposition LLM n'altère pas le manifeste avant validation ;
- accepter ou refuser une proposition est visible et traçable ;
- une modification de plan laisse les autres plans inchangés ;
- `Production` et `Export` dérivent de la même timeline ;
- les pistes dialogue, voix off, bruitages, ambiance et musique restent séparées ;
- chaque job indique stratégie, état, cible et besoin de validation ;
- aucune clé ou donnée sensible n'est envoyée au navigateur ;
- le guide de test est séparé de l'état applicatif.

### Exclusions

- appel réel à Nano Banana, Veo, Lyria ou un fournisseur audio ;
- rendu vidéo final, interpolation réelle ou upload média ;
- déploiement Google Cloud, WebMCP et MCP partenaire dans ce lot ;
- collaboration en écriture simultanée entre Codex et Claude.

### Critique et réduction de périmètre

Le lot ne prétend pas produire un film. Il prouve le contrat agentique et les états nécessaires
pour brancher ensuite les générateurs réels. La timeline est un éditeur simple, pas un NLE : elle
ordonne des clips et des pistes, mais n'implémente ni effets complexes ni rendu multimédia.

### Validation

- État : `approved`
- Révision approuvée : 4
- Autorisation : exécution autonome immédiate

## Révision 5 — restauration Odyssey et choix rapides

Approuvée le 2026-08-27 par François après revue du premier parcours Gemini.

### Ajustements demandés

1. Restaurer le design Odyssey précédemment validé, avec le panneau métier et
   l'assistant de production persistant.
2. Limiter la première réponse à deux propositions structurées, puis à trois
   propositions maximum une fois le projet cadré.
3. Présenter ces propositions sous forme de cartes directement actionnables,
   sans JSON visible par défaut.
4. Permettre de modifier le format, la durée cible et, pour un plan, sa stratégie
   avant la validation humaine.
5. Dédupliquer visuellement les anciennes propositions strictement identiques
   sans supprimer leur trace du manifeste.

### Preuves attendues

- limitation appliquée côté serveur, même si le modèle renvoie trop d'outils ;
- aucune mutation du projet avant le clic de validation ;
- valeurs modifiées dans la carte appliquées au manifeste après validation ;
- parcours des six onglets sans erreur console, requête externe ni débordement ;
- validation desktop et mobile du design restauré.

### Validation

- État : `approved`
- Révision approuvée : 5
- Autorisation : poursuite de l'implémentation et de la vérification
