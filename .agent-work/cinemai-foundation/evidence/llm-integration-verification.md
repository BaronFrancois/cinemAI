# Vérification — intégration Gemini Flash 3.5

Date : 2026-08-24

## Résultat

- Serveur : Node 20, sans dépendance applicative, écoute sur `127.0.0.1:4175`.
- Interface : les six conversations Odyssey utilisent `POST /api/chat` avec historique borné par onglet.
- Secret : `GEMINI_API_KEY` est lu depuis `.env` par le serveur et n'est jamais envoyé au navigateur.
- Modèle configuré : `gemini-3.5-flash`.

## Appel réel borné

Un seul appel réel a été effectué et a réussi.

- Réponse : connexion à l'atelier CinemAI confirmée par le modèle.
- Usage : 140 jetons d'entrée, 30 jetons de sortie, 623 jetons au total.
- Identifiant local de requête : `fe6ed9d8-44c2-4b95-8307-e4ba30820d53`.
- Aucun second appel réel n'a été effectué pendant les tests UI.

## Tests automatisés

`node --test tests/server.test.mjs` : 9/9 réussis.

La couverture inclut la configuration locale, le mode simulé, la validation des entrées, le
transfert de clé exclusivement vers Google, les erreurs fournisseur, une réponse amont non JSON,
une traversée de chemin encodée sous Windows et les en-têtes de sécurité de la page statique.

`node tests/ui-smoke.cjs` avec Playwright : réussi sur 1440×1000 et 390×844.

- six onglets exercés ;
- envoi par Entrée sur desktop et par bouton sur mobile ;
- aucune erreur console ;
- aucune requête navigateur externe ;
- aucun débordement horizontal.

Captures : `tests/cinemai-gemini-mock-desktop.png` et
`tests/cinemai-gemini-mock-mobile.png`.

## Limites explicites

La qualité UX et la pertinence éditoriale demandent encore une validation humaine. Nano Banana,
les services audio/vidéo, le streaming et YouTube ne font pas partie de cette preuve.
