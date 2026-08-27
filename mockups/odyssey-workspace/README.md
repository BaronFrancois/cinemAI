# Odyssey Workspace

## Lancer

```powershell
python -m http.server 4174 --directory H:\0perso\CinemAI\mockups\odyssey-workspace
```

Ouvrir `http://127.0.0.1:4174`.

## Fichiers

- `index.html` : version autonome et canonique du prototype.
- `Odyssey Workspace.dc.html` : export Claude Design original, conservé comme source.
- `support.js` : runtime de l'export original, non utilisé par `index.html`.
- `uploads/` : références visuelles et export AIssistant d'origine, non chargés par
  l'application.

## Limites actuelles

- les interactions et réponses de l'assistant sont simulées en mémoire ;
- aucun projet n'est encore persisté ;
- aucune clé, API Google ou génération réelle n'est branchée ;
- les actions d'export sont des états de maquette.
