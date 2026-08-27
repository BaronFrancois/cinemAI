# Handoff — cinemai-foundation

## État courant

- Statut : `verifying`
- Révision de plan : 3
- Révision approuvée : 3
- Étape terminée techniquement : workspace Odyssey relié au serveur local Gemini
- Checkpoint courant : validation humaine du dialogue réel et du rendu UX

## Ce qui est établi

Odyssey reste la surface UI canonique. Son composeur appelle maintenant `POST /api/chat`,
avec un contexte borné et indépendant pour chacun des six onglets. Un serveur Node 20 sans
dépendance sert l'interface, conserve la clé Google hors du navigateur, écoute uniquement sur
`127.0.0.1` et propose les modes `mock` et `google`.

La configuration locale sélectionne désormais `google` et `gemini-3.5-flash`. Un unique appel
réel a réussi. La suite serveur (9 tests) et le parcours Playwright desktop/mobile (six onglets,
envoi clavier et bouton) sont verts. Aucun autre service Google, aucune génération d'image,
d'audio ou de vidéo, aucun export YouTube et aucun streaming ne sont encore intégrés.

## Prochaine action exacte

Lancer `node server.mjs`, ouvrir `http://127.0.0.1:4175`, puis recueillir le jugement de
François sur la qualité des réponses et l'ergonomie. Après validation, définir séparément le
contrat de génération d'assets (Nano Banana), puis les contrats audio et vidéo, sans supposer
qu'ils utilisent tous la même API ou les mêmes permissions.

## Blocages

Aucun blocage technique connu. La validation humaine UX reste volontairement distincte des
tests automatisés. Le serveur n'est pas exposé au Wi-Fi ; cette restriction est intentionnelle.
