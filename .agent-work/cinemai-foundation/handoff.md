# Handoff — cinemai-foundation

## État courant

- Statut : `verifying`
- Révision de plan : 4
- Révision approuvée : 4
- Étape terminée techniquement : manifeste-first, approbations humaines et cockpit Odyssey connecté
- Checkpoint courant : validation humaine du parcours réel avec Gemini

## Ce qui est établi

Le studio démarre sans projet, personnage, décor, plan ni média d’exemple. Le manifeste persistant est l’unique source de vérité pour le projet, les assets, les séquences, les plans, la timeline, les propositions et la file de production. Le LLM peut proposer huit opérations typées ; aucune opération ne modifie le manifeste avant une décision humaine explicite.

Production et Export lisent la même timeline canonique. Elle comporte une piste visuelle et cinq pistes audio séparées : dialogues, voix off, bruitages, ambiances et musique. La file locale applique des transitions contrôlées et ne déclenche aucun fournisseur payant.

L’interface Odyssey responsive expose six onglets, le copilote persistant, les cartes d’approbation, la file et la timeline. Le guide `test-guide.html` contient huit prompts paramétrables et les résultats attendus, sans données narratives préchargées.

Preuves automatisées : 17 tests Node verts ; smoke Playwright desktop/mobile sur les six onglets, clavier, bouton et guide ; smoke Playwright isolé prouvant proposition visible, absence de mutation initiale, validation explicite et application de la mutation. Les captures desktop/mobile ont été inspectées visuellement.

## Limites explicites

- Gemini ne fait actuellement que l’orchestration textuelle et les appels d’outils structurés.
- Nano Banana, Veo, génération audio, rendu final, export YouTube et suivi analytics ne sont pas encore branchés.
- Le bouton d’avancement des jobs simule uniquement le cycle de production local.
- La validation UX par François reste distincte des tests automatisés.
- Claude Code n’est pas branché comme réviseur : `claude mcp serve` expose des outils, pas une seconde intelligence. Une revue headless réelle impliquerait l’envoi de code à Anthropic et attend un consentement explicite sur le périmètre transmis.

## Prochaine action exacte

Lancer `npm start`, ouvrir `http://127.0.0.1:4175`, puis suivre le lien « Guide de test ». Après validation UX, définir le premier contrat fournisseur réel — recommandé : génération d’image de référence — avec estimation de coût, preview et approbation avant appel.
