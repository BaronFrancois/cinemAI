# Continuité narrative déclarée

## Utilisation

Dans Storyboard, ouvrir un plan puis « Continuité narrative · états avant / après ».
Ajouter une référence, une propriété stable (position, tenue, possession…) et ses états
au début et à la fin. L’élément choisi est lié au plan. Une valeur vide reste inconnue.
Réutiliser les mêmes libellés et valeurs : la comparaison normalise casse et espaces,
mais ne résout pas les synonymes et ne lit ni le récit libre ni les pixels.

Exemple : le plan 3 finit avec la tasse « sur le bureau ». Le plan 4 commence
« en main », avec une action sans interruption : la revue expose l’écart et nomme les
deux plans. Si le plan 4 décrit la reprise, son début reste « sur le bureau » et sa fin
passe à « en main » ; il n’y a plus d’écart à la frontière.

Les transitions non précisées sont des questions séparées des contradictions.
Une ellipse assumée autorise un changement entre plans. Sans choix explicite, un
raccord vidéo `continuous` implique une action directe ; une coupe ne permet aucune
inférence temporelle. Aucun état ancien n’est propagé à travers un plan non renseigné.

Les liens ouvrent les deux plans. « Préparer une correction » remplit le composeur :
cela n’envoie pas de requête au modèle et ne modifie rien. Le réalisateur choisit la
correction, la décrit dans l’action et dans les états, puis valide sa proposition.

## Contrat

Les plans acceptent `narrativeStates: [{ assetId, property, before, after }]` et
`narrativeTransition: "unspecified" | "direct" | "ellipsis"`.
Maximum 20 faits par plan ; référence obligatoirement liée ; propriété unique par
référence ; 80 caractères pour la propriété et 240 par valeur. Les structures invalides
sont refusées sans mutation. Les anciens plans restent sans faits déclarés.

Les champs traversent création, scénario proposé, édition manuelle/agent, historique,
brouillons, restauration et résumé envoyé au modèle. Leur modification incrémente la
version du plan, donc la validation éditoriale précédente devient à revérifier.

Le rapport existant `/api/storyboard/review` ajoute les écarts certains au regard des
faits déclarés à `issues`, les transitions à expliquer à `narrativeQuestions`, et expose
la couverture dans `narrativeSummary`. Les preuves portent les identifiants et versions
des deux plans, la phase examinée et la valeur déclarée. Ce n’est pas une garantie de
cohérence narrative globale ; une différence de vocabulaire demande aussi une revue.

## Vérification

- 88 tests unitaires/API au moment de la livraison, sans fournisseur réel.
- `tests/narrative-ui-smoke.cjs` utilise un serveur et des données isolés. Vérifie la
  correction préparée sans appel, les brouillons, les sauvegardes successives, la
  restauration des états, l’ajout/retrait de lignes et l’ellipse, sur ordinateur et mobile.
- Le test navigateur demande Playwright disponible via `NODE_PATH` et Chrome installé
  (modifiable avec `CINEMAI_BROWSER_CHANNEL`). Les captures vont dans un dossier
  temporaire ou dans `CINEMAI_SCREENSHOT_DIR`.
- Aucune génération payante requise pour ces contrôles.

La prochaine étape distincte est une analyse du scénario libre proposant des faits à
valider, puis la revue multimodale des images. Aucune de ces analyses n’est simulée ici
comme une fonction déjà livrée.

Déploiement vérifié : `cinemai:deployment-01M1S6F6ZX0GKQ8K8Q9S520M5Q`.
Le contrôle en ligne confirme les nouveaux champs et le rapport, sur ordinateur et
mobile. La révision et les identifiants/versions des plans et médias sont inchangés.
Les anciens plans affichent zéro fait suivi tant que leurs états ne sont pas renseignés.
