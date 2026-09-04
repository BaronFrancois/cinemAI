# Design QA — Atelier visuel synchronisé

**Findings**

- Aucun écart P0, P1 ou P2 ne subsiste sur l’état comparé.
- [P3] Le visuel principal affiche actuellement la planche de référence complète lorsque la vue
  individuelle choisie n’a pas encore été générée. C’est un état de données réel et signalé par
  « Aperçu depuis la référence », pas un substitut graphique.

**Open Questions**

- La maquette montre déjà plusieurs images individuelles de Shadow. Le projet local n’en contient
  pas encore ; elles apparaîtront dans le filmstrip au fil des générations ciblées.

**Implementation Checklist**

- [x] Atelier d’asset au-dessus du chat, proportion initiale 2/3–1/3.
- [x] Conversation et composeur visibles pendant l’édition de l’asset.
- [x] Séparateur glissable, accessible au clavier, avec préréglages 2/3 et 1/2.
- [x] Mode plein écran réversible.
- [x] Source, catégorie, statut, versions et génération ciblée visibles ensemble.
- [x] Action LLM `update_asset` soumise à validation humaine.
- [x] Vérification desktop, mobile, console et appel Gemini réel.

**Follow-up Polish**

- Remplacer automatiquement l’aperçu de planche par la première image individuelle validée dès
  qu’elle existe. Le comportement est déjà prévu par le sélecteur de média.

## Evidence

- Source visual truth :
  `/Users/baronf/.codex/generated_images/01a05cca-8468-7393-a9f2-37135d51498d/exec-c6847320-a652-42d7-b4e5-fcf33c5976af.png`
- Implémentation desktop :
  `/Users/baronf/Documents/0perso/cinemAI/tests/cinemai-synchronized-workspace-desktop.png`
- Implémentation mobile :
  `/Users/baronf/Documents/0perso/cinemAI/tests/cinemai-synchronized-workspace-mobile.png`
- Comparaison côte à côte :
  `/Users/baronf/Documents/0perso/cinemAI/tests/cinemai-synchronized-workspace-comparison.png`

Viewport desktop : 1440 × 1024 CSS px, densité 1. Source : 1487 × 1058 px, normalisée à
1440 × 1024. Implémentation : 1440 × 1024 px. Le composite fait 2880 × 1092 px : bandeau de
68 px puis deux vues normalisées de 1440 × 1024.

Viewport mobile : 390 × 844 CSS px, capture 390 × 844 px, densité 1. Le document mesure exactement
390 × 844 : aucun débordement de page.

État comparé : étape Bible active, Shadow ouvert, atelier en préréglage 2/3, image « Face »
sélectionnée et conversation attachée.

### Full-view comparison

Le composite confirme la même composition principale : contexte du projet à gauche, atelier
visuel dominant en haut à droite, métadonnées sur son flanc, filmstrip sous l’image, séparateur
horizontal, historique du dialogue à gauche du composeur dans le tiers inférieur.

### Focused region comparison

- Atelier : titre, source v4, statut, versions, prompt, résolution et bouton de génération restent
  lisibles sans défilement à 1440 × 1024.
- Conversation : message contextuel et composeur sont visibles simultanément, comme dans la source.
- Mobile : le contexte, l’atelier et le chat conservent chacun une zone utilisable ; le composeur
  reste visible à 390 × 844.

### Required fidelity surfaces

- Fonts and typography : pile Manrope existante, hiérarchie, graisses, petites capitales et
  interlignages conservés ; aucune troncature critique.
- Spacing and layout rhythm : proportions 27/73 horizontales puis 66/34 verticales conformes ;
  gouttières, séparateurs, rayons et densité alignés sur la maquette.
- Colors and visual tokens : marine, graphite, cobalt, vert d’approbation et ambre d’alerte issus
  des tokens Odyssey existants ; contraste des actions maintenu.
- Image quality and asset fidelity : seuls les médias persistés du projet sont rendus. Ils sont
  affichés en `object-fit: contain`, sans découpage de sprite ni dessin CSS de remplacement.
- Copy and content : libellés français cohérents avec le projet et portée des actions explicitée.

### Primary interactions tested

- Ouverture de Shadow depuis la Bible.
- Sélection de « Profil » et conservation du texte du composeur.
- Préréglage 1/2, redimensionnement clavier 50 → 52, préréglage 2/3.
- Plein écran puis retour à la vue partagée.
- Serveur sur 4176 vérifié en mode `google`, clé configurée.
- Appel Gemini réel contrôlé : `update_asset` retourné pour l’identifiant exact de Shadow, sans
  application au manifeste ; 2 349 tokens déclarés par le fournisseur.
- Console navigateur : aucune erreur.

### Comparison history

1. L’ancienne galerie masquait entièrement le fil lorsque l’asset était ouvert. Le fil et le
   composeur ont été regroupés dans un dock persistant sous l’atelier.
2. Le premier rendu empilait le chat verticalement et plaçait les actions d’en-tête trop au centre.
   Le dock est désormais divisé historique/composition et les actions sont alignées à droite.
3. Le bouton de génération ciblée dépassait sous la zone visible. Les métadonnées, versions et
   contrôles ont été compactés ; la capture desktop post-correction montre le bouton complet.

final result: passed
