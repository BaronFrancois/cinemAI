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

Le workspace propose six sections synchronisées avec leur conversation : Projet, Script,
Production, Personnages, Décors et Export. `index.html` fonctionne sans React ni CDN. La clé
Gemini reste exclusivement dans le serveur local.

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
- Nano Banana, Omni et Veo : non branchés.
