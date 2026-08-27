# Vérification P0 — 2026-08-20

## Périmètre testé

Maquette `mockups/workspace-v1` servie localement sur `http://127.0.0.1:4173` et parcourue
avec Chromium headless.

## Preuves automatisées passées

- titre de page CinemAI présent ;
- exactement cinq cartes de plans ;
- état initial du plan 03 : `Rupture` ;
- action « Préparer la correction locale » répare la ligne de continuité ;
- nouvel état du plan 03 : `Préparé` ;
- message d'impact : les quatre autres hashes restent inchangés ;
- panneau de comparaison visible après correction ;
- thème sombre activable ;
- plan 04 sélectionnable au clavier avec `Entrée` ;
- cinq plans présents à 390 × 844 ;
- aucun débordement horizontal de la page à 390 px ;
- inspecteur visible sur mobile ;
- aucune erreur console et aucune erreur de page.

## Captures

- `workspace-desktop-before.png`
- `workspace-desktop-after.png`
- `workspace-mobile.png`

## Distinction obligatoire

Ces preuves valident le comportement technique de la maquette, pas sa qualité esthétique,
la clarté perçue ni le confort du vocabulaire. Ces trois points restent soumis au jugement
humain de François avant le passage à P1.

