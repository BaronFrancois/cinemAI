# Outils locaux

## extract-frame.swift

Extrait une image fixe d'une vidéo à un instant précis, via AVFoundation.
Sert à deux usages :

- **chaînage** : récupérer la dernière frame d'un clip pour la donner comme frame
  de départ du plan suivant, quand on veut un raccord exact ;
- **contrôle de cohérence** : échantillonner des frames et les comparer aux
  keyframes validées (double anse, changement de costume, traversée de décor…).

Cet outil est le **repli de développement sur macOS**. En production, le serveur
utilise `ffmpeg`, qui fonctionne sur Linux et sert aussi au mixage audio :

```bash
brew install ffmpeg            # local
CINEMAI_FFMPEG_PATH=/chemin/ffmpeg   # si absent du PATH
```

Le serveur préfère `ffmpeg` dès qu'il le trouve, pour que le comportement local
soit celui de la production. Sans aucun des deux, le chaînage retombe sur la
keyframe du plan au lieu d'échouer.

L'outil Swift nécessite les Command Line Tools de Xcode pour `swiftc`.

```bash
swiftc -O tools/extract-frame.swift -o tools/extract-frame
tools/extract-frame clip.mp4 derniere.jpg        # dernière frame
tools/extract-frame clip.mp4 milieu.jpg 5.0      # frame à 5 s
```

La tolérance temporelle est nulle : l'image renvoyée est celle de l'instant
demandé, pas la keyframe d'encodage la plus proche.

Cet outil n'est pas encore branché dans `server.mjs` : le chaînage automatique
et le contrôle de cohérence restent à décider.
