# CinemAI — Plan complet de reprise pour Claude

## Demande du propriétaire

Je souhaite poursuivre CinemAI pour obtenir un outil réellement fonctionnel, hébergé et simple à utiliser. Mes priorités sont la création automatique du scénario, le storyboard éditable et la vérification de la cohérence narrative et visuelle. Le storyboard doit devenir le centre du travail de réalisation.

Reprends le projet existant et progresse par lots vérifiables. Ce document fournit un état de reprise et un plan ; vérifie les affirmations dans le code avant de t’appuyer dessus. Ne repars pas de zéro et ne remplace pas la pile technique sans nécessité démontrée.

## 1. Où reprendre

- Dépôt local : `/Users/baronf/Documents/0perso/cinemAI`.
- Application : https://cinemai.fly.dev/
- Dépôt GitHub indiqué dans le README : https://github.com/BaronFrancois/cinemAI
- Maquette Figma : https://www.figma.com/design/wuoR5ZeF6ReBvmd1kuclNN?node-id=2-2
- Rapport de livraison : `docs/verification/storyboard-2026-09-05.md`.
- Captures : `docs/verification/storyboard-desktop.png` et `storyboard-mobile.png`.
- Documents historiques : `docs/product-contract.md`, `docs/design-direction.md`, `mockups/odyssey-workspace/TASKS.md`, `design-qa.md`.

Les documents historiques peuvent être dépassés. Certaines fonctions y figurent encore « à faire » alors qu’elles existent dans le code. Les conversations précédentes sur le concours ne constituent pas une demande actuelle de préparer une vidéo ou de soumettre un formulaire.

### État vérifié lors de la dernière intervention, le 5 septembre 2026

- Application déployée sur Fly.io, avec volume persistant.
- Backend Node.js, sans dépendance npm de production déclarée.
- Raisonnement de l’agent via Vertex AI ; génération des médias via le backend Google existant.
- Lectures analytiques ClickHouse via MCP ; télémétrie existante à préserver.
- Projet Shadow présent en production : 2 plans et 19 médias lors du contrôle.
- 76 tests automatisés passent ; interface vérifiée à 1440 × 1000 et 390 × 844.
- Contrôle de production effectué en lecture seule : aucune modification de Shadow ni génération payante pendant ces vérifications.
- Dernière image déployée par Codex : `registry.fly.io/cinemai:deployment-01M1RK9AQQMRYF2S69DDET63QN`.
- Les modifications de Codex étaient **déployées mais non commitées**. Examiner `git status` et `git diff` avant toute modification. Des captures non suivies préexistaient : ne pas les supprimer ni les attribuer automatiquement à Codex.

Ces informations décrivent le dernier état observé, pas une garantie sur l’état au moment de la reprise.

## 2. Ce qui existe déjà

### Principaux fichiers

| Fichier | Rôle |
| --- | --- |
| `server.mjs` | HTTP, agent, appels Google, génération des médias |
| `production-store.mjs` | Manifeste, opérations, validations, persistance |
| `llm-tools.mjs` | Contrats des outils proposés à l’agent |
| `storyboard-review.mjs` | Vérifications structurelles du storyboard |
| `mockups/odyssey-workspace/index.html` | Interface réellement servie |
| `mockups/odyssey-workspace/workspace-bridge.js` | Navigation, atelier, contrôles, appels serveur |
| `mockups/odyssey-workspace/workspace-bridge.css` | Styles de l’interface connectée |
| `vertex-auth.mjs` | Authentification Vertex |
| `mcp-client.mjs`, `clickhouse.mjs`, `telemetry.mjs` | MCP et télémétrie |
| `fly.toml`, `Dockerfile` | Hébergement existant |

### Dernier lot livré

1. L’étape Storyboard ouvre un atelier principal avec images, descriptions et durées.
2. Un plan possède un éditeur : titre, action/cadrage, durée, dialogues, raccord et références liées.
3. Une sauvegarde du texte conserve les 50 versions précédentes au maximum. Les autres plans et les médias ne sont pas modifiés.
4. `PATCH /api/shots/:id` utilise `baseVersion` pour refuser une écriture concurrente devenue obsolète.
5. L’outil agent `create_screenplay` propose un découpage complet pour un projet structuré sans séquences ni plans : 12 séquences et 24 plans au maximum. Une validation applique le tout atomiquement.
6. Un projet déjà découpé passe par des propositions `update_shot` pour éviter les doublons.
7. `GET /api/storyboard/review` vérifie les durées, les références/images absentes ou non approuvées, certains changements de décor entre plans continus, les locuteurs et la version du texte associée à l’image.
8. Les nouvelles images de storyboard enregistrent `sourceShotVersion`. Une validation humaine enregistre `reviewedShotVersion`.
9. Les images historiques sans provenance suffisante sont signalées comme inconnues : ne pas inventer leur version source.
10. L’animatique permet de revoir les images avec les durées des plans sans nouvelle génération.

### Limites à garder explicites

- Le nouveau scénario complet a été testé avec une réponse Google simulée ; le parcours créatif réel reste à vérifier.
- Le contrôle actuel est structurel. Il ne regarde pas les images et ne détecte pas réellement un costume, un visage ou un accessoire qui change.
- La maquette Figma est une direction éditable, pas une preuve de fonctionnement ni une bibliothèque exhaustive de composants.
- Modifier la durée d’un plan ne recale pas automatiquement les clips existants sur la timeline.
- L’historique du texte est consultable ; la restauration et la comparaison détaillée restent à compléter.
- Vérifier les fonctions de création/sélection des projets et d’export : un bouton visible n’est pas une preuve que le parcours aboutit.

## 3. Produit cible et parcours principal

**Idée → scénario proposé → scénario validé → bible visuelle → storyboard → contrôles et corrections → animatique → vidéo → son et export.**

Le réalisateur doit pouvoir :

- décrire une idée ou importer son scénario ;
- obtenir une proposition de récit avec début, évolution, résolution et durée cible ;
- modifier le texte avant de lancer les médias ;
- définir les personnages, décors, accessoires et règles visuelles stables ;
- visualiser le film comme une succession de plans ;
- comprendre ce qui est incohérent, incertain ou encore non vérifié ;
- corriger uniquement ce qui pose problème ;
- revoir le rythme avant de payer pour la vidéo ;
- télécharger un résultat réel.

L’assistant accompagne le travail et expose ses propositions. Les opérations courantes doivent aussi être accessibles directement dans l’interface, sans devoir connaître les commandes de l’agent.

## 4. Règles de réalisation

- Conserver le manifeste et les identifiants existants. Prévoir des migrations compatibles, précédées d’une sauvegarde.
- Séparer proposition, validation, génération et vérification du résultat.
- Une modification du texte ne déclenche pas automatiquement une génération d’image ou de vidéo.
- Une correction ciblée ne régénère pas les plans voisins. Afficher les dépendances à revérifier.
- Montrer le coût estimé et le périmètre avant une génération payante. Ne pas considérer ce plan comme une autorisation de dépenser sans limite.
- Ne jamais présenter un contrôle non exécuté, un service indisponible ou une faible confiance comme « cohérent ».
- Garder les versions rejetées et la provenance utile, sans confondre dernière version créée et référence approuvée.
- Tester avec des données isolées. Ne pas remettre Shadow à zéro pour faciliter un test.
- Conserver secrets et clés hors du dépôt, des captures et des journaux.
- Travailler d’abord sur les parcours prioritaires. Ne pas engager une refonte de framework ou un nouveau design system avant de résoudre leurs problèmes concrets.

## 5. Lots de travail, dans l’ordre

### Lot 0 — Reprise et sécurisation de l’existant

1. Lire les changements locaux, les instructions applicables et le rapport de livraison.
2. Identifier les modifications non commitées, les sauvegarder et les distinguer des travaux préexistants.
3. Vérifier les commandes de démarrage, les tests, la persistance et la configuration Fly sans exposer les secrets.
4. Préparer un environnement de test isolé avec les fournisseurs désactivés par défaut.
5. Vérifier les protections des routes de modification et de génération sur l’application publique : identité, autorisation et limitation des requêtes. Corriger les accès non autorisés identifiés avant d’élargir l’usage.
6. Faire l’inventaire des boutons sans effet, erreurs et divergences entre les documents et le code.

**Sortie :** état de référence documenté, sauvegarde exploitable et liste courte des blocages réels.

### Lot 1 — Scénario automatique réellement utilisable

1. Clarifier les entrées : idée, genre, tonalité, public, format, durée, contraintes et scénario fourni.
2. Produire une proposition lisible de scénario avant les images : résumé, progression narrative, séquences, actions filmables, dialogues et découpage temporel.
3. Compléter `create_screenplay` sans casser son application atomique. Contrôler côté serveur les tailles, types, durées et références.
4. Permettre de relire et modifier la proposition dans un écran adapté. Une erreur de validation doit conserver le travail de l’utilisateur.
5. Ajouter une réécriture ciblée : séquence ou plan sélectionné, consigne explicite et comparaison avant/après.
6. Préserver les éléments validés, éviter les doublons et arrêter les relances automatiques improductives.
7. Tester un scénario réel court avec un budget convenu pour l’appel au modèle ; aucune génération de média nécessaire pour cette étape.

**Sortie :** une idée devient un scénario cohérent, éditable et sauvegardé ; refus ou correction d’une proposition ne détruit rien.

### Lot 2 — Storyboard central et édition fluide

1. Garder une vue d’ensemble des plans et un inspecteur du plan sélectionné. Maintenir l’accès au scénario et à l’assistant sans surcharge.
2. Afficher image choisie, action, dialogues utiles, durée, cadrage, références et état de validation.
3. Ajouter création, duplication intentionnelle, suppression récupérable et réordonnancement des plans.
4. Répercuter explicitement l’ordre dans l’animatique et la production ; éviter deux ordres concurrents entre tableaux, séquences et timeline.
5. Conserver les brouillons non enregistrés lors de la navigation. Rendre visibles sauvegarde, erreur et conflit d’édition.
6. Compléter l’historique du texte et des images : comparer, sélectionner une ancienne version, restaurer comme nouvelle version.
7. Donner une commande claire pour régénérer uniquement l’image choisie, avec références et estimation visibles.
8. Définir un verrouillage éditorial du storyboard. Toute modification ultérieure doit indiquer ce qui doit être revérifié.

**Sortie :** préparer et corriger un storyboard entier sans manipuler de JSON ni dépendre du chat pour chaque édition.

### Lot 3 — Bible et provenance des références

1. Formaliser personnages, décors, accessoires et style ; distinguer attributs stables et variations autorisées.
2. Pour chaque personnage : identité, silhouette, tenue, couleurs, accessoires et états narratifs.
3. Pour chaque décor : géographie, positions relatives, éclairage, moment de la journée et transformations permises.
4. Uniformiser les contrôles humains des planches personnage et décor. Ne pas substituer une variante à la référence principale par accident.
5. Enregistrer les références réellement utilisées par chaque génération : identifiants média, versions d’assets, version du plan, paramètres et modèle.
6. Si une référence change, identifier les plans concernés et demander leur revue ; ne pas les régénérer automatiquement.

**Sortie :** pouvoir expliquer de quelles références vient chaque image et pourquoi un changement affecte certains plans.

### Lot 4 — Cohérence narrative et temporelle

1. Étendre les règles déterministes : ordre, durée totale, références, locuteurs et transitions.
2. Modéliser les états avant/après pertinents : objet porté ou posé, position, costume, blessures, informations connues, action commencée/achevée.
3. Ajouter une revue par modèle du scénario et des transitions : contradictions, motivations absentes, actions impossibles ou enchaînements peu lisibles.
4. Séparer les erreurs certaines des questions de mise en scène et des interprétations incertaines.
5. Chaque résultat doit comporter catégorie, plans concernés, preuves textuelles, explication et proposition de correction.
6. Une correction devient une proposition versionnée ; le modèle ne modifie pas silencieusement le film.

**Sortie :** une contradiction volontairement introduite est localisée et expliquée ; sa correction reste ciblée et vérifiable.

### Lot 5 — Cohérence visuelle multimodale

1. Vérifier les capacités et contrats actuels du fournisseur déjà intégré avant de choisir l’API d’analyse d’images.
2. Ajouter un service distinct de revue visuelle, recevant réellement les images et leurs références approuvées.
3. Comparer un plan à sa bible et, si pertinent, aux plans voisins : identité, costume, accessoires, décor, lumière et action représentée.
4. Exiger des observations concrètes et une confiance explicite. Une zone invisible ou ambiguë doit rester « indéterminée ».
5. Lier le rapport aux versions exactes des images examinées. Une nouvelle image rend le rapport précédent obsolète.
6. Afficher les images comparées à côté des observations et permettre au réalisateur de confirmer ou rejeter une alerte.
7. Préparer une consigne de correction ciblée ; toute nouvelle génération garde son estimation et sa validation séparées.
8. Mettre en cache les analyses inchangées et plafonner les appels pour éviter les dépenses répétées.
9. Évaluer sur un petit jeu annoté : images cohérentes, rupture de costume, accessoire déplacé, changement de décor et cas ambigu.

**Sortie :** analyses fondées sur les pixels effectivement transmis, résultats traçables, cas ambigus assumés et faux positifs mesurés.

### Lot 6 — Animatique et validation de réalisation

1. Garantir l’ordre, les durées et la sélection des versions affichées.
2. Signaler clairement les images manquantes ou provisoires.
3. Ajouter lecture/pause, précédent/suivant et accès direct au plan à corriger.
4. Rendre visibles les dialogues et notes utiles à la revue du rythme, sans ajouter de génération automatique.
5. Enregistrer la validation du storyboard avec ses versions exactes.

**Sortie :** juger le film avant la vidéo payante et savoir si la validation reste valable après une modification.

### Lot 7 — Vidéo, son et export réel

1. Générer d’abord un plan de contrôle approuvé, avec durée fournisseur, coût et références affichés.
2. Conserver les mécanismes existants de chaînage et de réancrage ; vérifier leur résultat plutôt que promettre une continuité parfaite.
3. Préparer les générations en lot uniquement pour les plans sélectionnés, avec total estimé, plafond, suivi, annulation et reprise sans doublons.
4. Définir le traitement des changements de durée : signaler ou proposer le recalage de la timeline, sans écraser silencieusement le montage.
5. Valider les dialogues destinés à la synchronisation labiale avant les appels qui en dépendent. Ne pas supposer que toute parole peut être ajoutée après coup.
6. Après validation du montage image, ajouter les pistes son requises et les contrôles de synchronisation.
7. Exporter réellement un fichier lisible avec les paramètres annoncés ; distinguer clairement téléchargement du manifeste et export du film.
8. Vérifier le résultat téléchargé : ouverture, durée, ordre, résolution, son et absence de plan manquant.

**Sortie :** un court film exporté à partir du storyboard validé, avec dépenses et provenance consultables.

### Lot 8 — Hébergement et usage quotidien

1. Rendre création, sélection et isolation des projets fiables.
2. Définir l’usage visé : atelier personnel protégé ou service multi-utilisateur. Ne pas implémenter une organisation multi-utilisateur complexe sans besoin établi.
3. Vérifier isolation des données, contrôle des routes payantes, quotas et limites de taille/durée des traitements.
4. Prévoir sauvegarde/restauration du manifeste et des médias, ainsi qu’une procédure de retour arrière du déploiement.
5. Assurer persistance après redémarrage et déploiement, gestion des erreurs fournisseur et reprise des traitements longs.
6. Garder une télémétrie utile : latence, échecs, coûts estimés/réels lorsque disponibles, versions et décisions humaines.
7. Réduire les frictions de l’interface sur petit écran et au clavier : focus, libellés, états textuels et actions accessibles.

**Sortie :** application stable et récupérable pour l’usage prévu, avec un parcours complet de projet à export.

## 6. Tests et méthode de livraison

Pour chaque lot :

1. Décrire brièvement le problème et les fichiers concernés.
2. Réaliser la plus petite évolution complète qui résout le problème.
3. Ajouter des tests de comportements utiles : validation refusée, absence de mutation prématurée, persistance, conflit, non-régression des voisins, version obsolète et reprise après erreur.
4. Utiliser les simulations pour les contrats et les erreurs ; distinguer leurs résultats des essais réels du modèle.
5. Vérifier visuellement les écrans modifiés sur ordinateur et mobile, avec états vide, rempli, attente, erreur et succès.
6. Tester les parcours réels payants de façon bornée, avec montant et périmètre convenus.
7. Documenter ce qui est livré, testé et encore limité. Mettre à jour les documents historiques concernés.
8. Produire un commit cohérent une fois les changements vérifiés, en préservant les travaux extérieurs au lot.
9. Pour une version destinée à la production, déployer sur l’hébergement existant puis vérifier les pages et la persistance.

Éviter les suites répétées sans modification ni nouveau risque. Ne pas multiplier les maquettes Figma ou les appels de génération lorsque le problème est déjà démontré dans l’application.

## 7. Priorités si le temps ou le budget manque

**Indispensable :** reprendre proprement le code, finir le scénario automatique, fiabiliser l’édition du storyboard, tracer les références, fournir des contrôles honnêtes, protéger les générations payantes et obtenir un export réel.

**Ensuite :** revue narrative avancée, analyse visuelle mesurée, historique comparatif et traitements en lot.

**Plus tard :** collaboration multi-utilisateur, bibliothèque de modèles, publication sur les réseaux, design system complet, effets et personnalisation décorative.

## 8. Première action attendue de Claude

Commence par le lot 0, puis attaque le premier blocage du parcours « idée → scénario validé → storyboard éditable ». Vérifie en priorité que `create_screenplay` produit une proposition lisible et validable avec le fournisseur réel, sans dépenser pour des images ou vidéos.

Ne me renvoie pas seulement un autre plan. Travaille par lots concrets, explique brièvement les décisions nécessaires et présente le résultat vérifié. Demande une précision uniquement lorsqu’une décision produit ou une dépense non autorisée bloque réellement la suite.
