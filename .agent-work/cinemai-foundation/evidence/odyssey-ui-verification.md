# Vérification UI Odyssey — 2026-08-22

## Périmètre

`mockups/odyssey-workspace/index.html`, servi localement sur
`http://127.0.0.1:4174` et parcouru avec Chromium/Playwright.

## Défaut initial reproduit

L'export Claude Design brut affichait un écran vide lorsque les téléchargements de React et
ReactDOM depuis `unpkg.com` étaient refusés. Il sollicitait également Google Fonts.

## Preuves passées

- six onglets présents : Projet, Script, Production, Personnages, Décors et Export ;
- chaque onglet active le panneau et la conversation portant le même identifiant ;
- saisie et réponse simulée du composeur dans Script ;
- déplacement clavier entre onglets ;
- séparateur desktop réglable au clavier jusqu'à 0 et 100 ;
- titre UTF-8 correct : `CinemAI — Odyssey` ;
- aucune erreur console ni erreur de page ;
- aucune requête vers un domaine externe ;
- aucun débordement horizontal à 1440 px ou 390 px ;
- mobile : split remplacé par une pile verticale, conversation toujours accessible et
  navigation basse défilable ;
- six rôles `tab` et six rôles `tabpanel` présents.

## Correction visuelle des onglets

- les onglets inactifs ont un rayon constant de `16px` sur leurs quatre côtés en desktop ;
- leurs quatre bordures sont présentes et leur ombre correspond à un relief relevé ;
- lorsque le panneau métier est replié, l'onglet actif adopte le même rayon, la même bordure
  et le même relief relevé que les autres ;
- cliquer un onglet rouvre le panneau et restaure son état actif enfoncé ;
- sur mobile, replier le panneau le masque réellement et laisse la conversation visible ;
- aucune erreur console détectée après la correction.

## Captures

- `odyssey-desktop.png` — 1440 × 960 ;
- `odyssey-mobile.png` — 390 × 844, capture pleine page.
- `odyssey-buttons-collapsed-desktop.png` — boutons relevés, panneau métier replié ;
- `odyssey-buttons-collapsed-mobile.png` — conversation seule et navigation relevée.

## Distinction obligatoire

Les contrôles techniques passent. La qualité esthétique, le confort des libellés et le choix
de la densité finale restent soumis au jugement humain de François. Les réponses du LLM et
les exports ne sont pas réels dans ce lot.
