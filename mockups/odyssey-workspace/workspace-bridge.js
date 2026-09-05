(function () {
  "use strict";

  var state = null;
  var mediaConfig = null;
  var decisionQueue = Promise.resolve();
  var continuationRunning = false;
  var autoContinueStreak = 0;
  var activeAssetId = null;
  var activeVariantKey = null;
  var activeMediaId = null;
  var workspaceMode = "conversation";
  var workspaceSplit = 66;
  var exportSettings = {
    format: "MP4",
    resolution: "1080p",
    fps: "24",
    ratio: "16:9",
    quality: "Haute",
    audio: true,
    subtitles: false,
    watermark: false,
    fileName: ""
  };
  var AUTO_CONTINUE_LIMIT = 1;
  // Lecteur d'animatique : enchaîne les keyframes validées à la durée réelle des
  // plans. Aucun appel de génération, donc aucun coût — c'est tout l'intérêt :
  // valider rythme, lisibilité et continuité avant de payer une vidéo.
  var animaticTimer = null;
  var animaticIndex = 0;
  var animaticPlaying = false;
  var trackLabels = {
    visual: "Image / vidéo",
    dialogue: "Dialogues",
    voiceover: "Voix off",
    sfx: "Bruitages",
    ambience: "Ambiances",
    music: "Musique"
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  // Jeton d'accès : l'instance publique exige un jeton pour toute écriture.
  // On l'accepte dans l'URL une fois, puis on le retient, afin qu'un lien de
  // démonstration partagé reste fonctionnel sans le laisser traîner dans la
  // barre d'adresse.
  var accessToken = "";
  try {
    var fromUrl = new URLSearchParams(location.search).get("token");
    if (fromUrl) {
      localStorage.setItem("cinemai.token", fromUrl);
      history.replaceState(null, "", location.pathname);
    }
    accessToken = localStorage.getItem("cinemai.token") || "";
  } catch (error) {
    accessToken = "";
  }

  async function api(path, options) {
    var extra = accessToken ? { "x-cinemai-token": accessToken } : {};
    var response = await fetch(path, Object.assign({}, options || {}, {
      headers: Object.assign({ "Content-Type": "application/json" }, extra, options && options.headers || {})
    }));
    var payload = await response.json().catch(function () { return { error: "Réponse illisible." }; });
    if (!response.ok) {
      var failure = new Error(payload.error || "La demande a échoué.");
      failure.status = response.status;
      throw failure;
    }
    return payload;
  }

  function focusComposer(prefill) {
    var input = document.getElementById("composer-input");
    if (!input) return;
    input.classList.remove("empty");
    input.textContent = prefill || "";
    input.focus();
  }

  function pane(title, subtitle, body, footer) {
    return '<div class="pane-head">' +
      '<div class="eyebrow">' + escapeHtml(subtitle) + '</div>' +
      '<div class="fx col ac gap8" style="margin-top:4px;text-align:center"><h1 class="h1">' + escapeHtml(title) + '</h1></div>' +
      '</div><div class="pane-scroll">' + body + '</div>' +
      '<div class="pane-foot"><span>' + escapeHtml(footer) + '</span><div class="spacer"></div><a href="/test-guide.html">Guide de test</a></div>';
  }

  function emptyState(title, text, action) {
    return '<div class="bridge-empty"><div class="bridge-empty-inner">' +
      '<div class="bridge-empty-mark">✦</div><h2 class="h2">' + escapeHtml(title) + '</h2>' +
      '<p class="prose" style="color:var(--ink-2)">' + escapeHtml(text) + '</p>' +
      '<div class="bridge-actions"><button class="choice-action primary" data-bridge-focus>' + escapeHtml(action || "Parler à l’assistant") + '</button></div>' +
      '</div></div>';
  }

  function homeFunction(icon, title, text, prompt) {
    return '<button type="button" class="home-function" data-home-prompt="' + escapeHtml(prompt) + '">' +
      '<span class="home-function-icon" aria-hidden="true">' + icon + '</span>' +
      '<span class="home-function-copy"><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(text) + '</small></span>' +
      '<span class="home-function-arrow" aria-hidden="true">↗</span></button>';
  }

  function homeState() {
    var icons = {
      project: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3.5"></rect><path d="M3 9.5h18"></path><path d="M8 14h8"></path></svg>',
      script: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="3"></rect><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4.5"></path></svg>',
      production: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="3.5"></rect><path d="M3 10h18"></path><circle cx="12" cy="14.5" r="2.4"></circle></svg>',
      characters: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"></circle><circle cx="17" cy="9.5" r="2"></circle><path d="M3.5 19c0-3 2.4-5 5.5-5s5.5 2 5.5 5M15 15.5c2.8 0 5 1.4 5.5 3.5"></path></svg>',
      locations: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3.5"></rect><path d="m5.5 16 4-5 3 3 2.5-2.5 3.5 4.5"></path><circle cx="16" cy="9" r="1.4"></circle></svg>',
      export: '<svg viewBox="0 0 24 24"><path d="m8 10.5 4-4 4 4M12 6.5V16"></path><path d="M5 15.5v3A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-3"></path></svg>'
    };
    return '<div class="home-welcome">' +
      '<section class="home-hero">' +
        '<div class="home-ai-stage" aria-hidden="true">' +
          '<div class="home-orbit home-orbit-one"><i></i><i></i><i></i></div>' +
          '<div class="home-orbit home-orbit-two"></div>' +
          '<div class="home-ai-orb"><span class="home-ai-spark">✦</span></div>' +
          '<span class="home-ai-label">CinemAI</span>' +
        '</div>' +
        '<div class="home-hero-copy">' +
          '<span class="home-kicker"><i></i> Assistant de création cinématographique</span>' +
          '<h2>Votre idée.<br><em>Un film cohérent.</em></h2>' +
          '<p>Décrivez ce que vous imaginez. CinemAI structure le projet, prépare les plans et garde chaque décision sous votre contrôle.</p>' +
          '<div class="home-hero-actions">' +
            '<button type="button" class="choice-action primary" data-home-prompt="Je veux créer un nouveau film à partir de cette idée : ">Commencer avec une idée</button>' +
            '<button type="button" class="choice-action" data-home-prompt="Je veux partir d’un scénario existant. Aide-moi à l’organiser : ">Partir d’un scénario</button>' +
          '</div>' +
        '</div>' +
      '</section>' +
      '<section class="home-functions">' +
        '<div class="home-section-head"><div><span class="home-kicker">Un seul dialogue</span><h3>Tout le studio à portée de prompt</h3></div><span class="home-section-note">6 espaces synchronisés</span></div>' +
        '<div class="home-function-grid">' +
          homeFunction(icons.project, "Projet", "Cadrez l’intention, le format et la durée.", "Aide-moi à cadrer mon projet de film.") +
          homeFunction(icons.script, "Script", "Transformez une idée en séquences et en plans.", "Aide-moi à écrire et découper mon scénario.") +
          homeFunction(icons.production, "Production", "Préparez les générations et suivez la timeline.", "Prépare le plan de production de mon film.") +
          homeFunction(icons.characters, "Personnages", "Fixez l’identité et la continuité visuelle.", "Aide-moi à concevoir les personnages de mon film.") +
          homeFunction(icons.locations, "Décors", "Construisez les lieux, ambiances et références.", "Aide-moi à définir les décors et les ambiances.") +
          homeFunction(icons.export, "Export", "Contrôlez les éléments avant la livraison finale.", "Aide-moi à vérifier et préparer l’export final.") +
        '</div>' +
      '</section>' +
      '<div class="home-trust"><span><i class="home-status-dot"></i> Workspace local</span><span>Validation humaine avant chaque action</span><span>Aucune génération payante automatique</span></div>' +
    '</div>';
  }

  function rows(items, renderer) {
    return '<div class="bridge-list">' + items.map(renderer).join("") + '</div>';
  }

  function mediaForAsset(assetId) {
    return (state && state.media || []).filter(function (media) {
      return media.targetType === "asset" && media.targetId === assetId && media.kind === "image";
    });
  }

  function isMediaApproved(media) {
    if (!media || media.status !== "approved") return false;
    if (media.purpose !== "character_consistency") return true;
    var review = media.review || {};
    return review.angles === true && review.postures === true && review.emotions === true;
  }

  function imageCostLabel(size) {
    var image = mediaConfig && mediaConfig.image;
    var value = image && image.estimatedCostUsd && Number(image.estimatedCostUsd[size]);
    if (!value) return image && image.provider === "mock" ? "Aucun coût · aperçu local" : "Coût indisponible";
    return "≈ " + value.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " $ · estimation";
  }

  function mediaForShot(shotId) {
    return (state && state.media || []).filter(function (media) {
      return media.targetType === "shot" && media.targetId === shotId && media.kind === "image";
    });
  }

  function videoForShot(shotId) {
    return (state && state.media || []).filter(function (media) {
      return media.targetType === "shot" && media.targetId === shotId && media.kind === "video";
    });
  }

  function shotCard(shot) {
    var media = mediaForShot(shot.id).filter(function (item) { return item.kind === "image"; });
    var latest = media.length ? media[media.length - 1] : null;
    var linked = (state.assets || []).filter(function (asset) {
      return (shot.assetIds || []).indexOf(asset.id) !== -1;
    });
    var withSheets = linked.filter(function (asset) { return mediaForAsset(asset.id).length; });
    var approvedRefs = linked.filter(function (asset) {
      return mediaForAsset(asset.id).some(isMediaApproved);
    });
    var referenceHint = linked.length
      ? withSheets.length + "/" + linked.length + " référence" + (linked.length > 1 ? "s" : "") + " disponible" + (linked.length > 1 ? "s" : "") +
        ", dont " + approvedRefs.length + " validée" + (approvedRefs.length > 1 ? "s" : "")
      : "Aucune référence liée à ce plan";
    var frame = latest
      ? '<figure class="shot-media' + (latest.status === "approved" ? ' is-approved' : '') + '"><img src="' + escapeHtml(latest.url) + '" alt="Image du plan ' + escapeHtml(shot.title || "sans titre") + '" loading="lazy"><figcaption><span>v' + escapeHtml(latest.version) + (latest.status === "approved" ? ' · validée' : '') + ' · ' + escapeHtml(latest.model || latest.provider) + '</span><button type="button" class="media-approve' + (latest.status === "approved" ? ' on' : '') + '" data-approve-media="' + escapeHtml(latest.id) + '" data-approved="' + (latest.status === "approved" ? '1' : '0') + '">' + (latest.status === "approved" ? 'Validée' : 'Valider') + '</button><a href="' + escapeHtml(latest.url) + '" target="_blank" rel="noopener">Ouvrir</a></figcaption></figure>'
      : '<div class="asset-media-empty"><span>◇</span><p>Aucune image pour ce plan.</p></div>';
    return '<article class="shot-card" data-shot-card="' + escapeHtml(shot.id) + '">' +
      '<div class="shot-card-head"><div><span class="field-label">Plan · ' + Math.round((shot.durationMs || 0) / 100) / 10 + ' s</span><h3>' + escapeHtml(shot.title || "Plan sans titre") + '</h3><p>' + escapeHtml(shot.description || "Description à préciser") + '</p></div><span class="pill">v' + escapeHtml(shot.version) + '</span></div>' +
      frame +
      '<div class="asset-generation-controls"><label class="choice-field asset-prompt"><span>Direction supplémentaire</span><textarea rows="2" data-shot-image-prompt placeholder="Ex. cadrage plus serré, contre-plongée…"></textarea></label>' +
      '<label class="choice-field asset-size"><span>Résolution</span><select data-shot-image-size><option value="512">512 · brouillon</option><option value="1K" selected>1K · standard</option><option value="2K">2K · détail</option><option value="4K">4K · final</option></select></label></div>' +
      '<div class="asset-library-actions"><button type="button" class="choice-action primary" data-generate-shot-image="' + escapeHtml(shot.id) + '">' + (latest ? "Régénérer l’image du plan" : "Générer l’image du plan") + '</button><span class="hint" data-image-cost>' + escapeHtml(imageCostLabel("1K")) + ' · ' + escapeHtml(referenceHint) + '.</span></div>' +
      (media.length > 1 ? '<div class="shot-media-history">' + media.slice(0, -1).reverse().map(function (item) {
        return '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener"><img src="' + escapeHtml(item.url) + '" alt="Version ' + escapeHtml(item.version) + '" loading="lazy"></a>';
      }).join("") + '</div>' : "") +
      shotVideoBlock(shot, media.length > 0) +
      '<div class="choice-error hint" data-shot-image-error hidden></div>' +
    '</article>';
  }

  function shotVideoBlock(shot, hasKeyframe) {
    var clips = videoForShot(shot.id);
    var latest = clips.length ? clips[clips.length - 1] : null;
    var seconds = Math.min(10, Math.max(3, Math.round((shot.durationMs || 4000) / 1000)));
    var shots = (state && state.shots) || [];
    var index = shots.findIndex(function (item) { return item.id === shot.id; });
    var next = index >= 0 ? shots[index + 1] : null;
    var paired = !!(next && next.continuity === "continuous" && mediaForShot(next.id).some(function (item) { return item.kind === "image"; }));
    var hint = !hasKeyframe
      ? "Générez d’abord l’image de ce plan."
      : (paired ? "Début et fin : raccord imposé avec le plan suivant." : "Frame de début seule : le modèle choisit la fin.") + " Durée ≈ " + seconds + " s.";
    return '<div class="shot-video">' +
      (latest ? '<video controls preload="metadata" src="' + escapeHtml(latest.url) + '"></video>' : "") +
      '<div class="asset-library-actions"><button type="button" class="choice-action" data-generate-shot-video="' + escapeHtml(shot.id) + '"' + (hasKeyframe ? "" : " disabled") + '>' +
      (latest ? "Régénérer le clip" : "Animer ce plan") + '</button><span class="hint">' + escapeHtml(hint) + '</span></div>' +
      '<div class="choice-error hint" data-shot-video-error hidden></div>' +
    '</div>';
  }

  function assetCard(asset, type) {
    var media = mediaForAsset(asset.id);
    var hasApprovedMedia = media.some(isMediaApproved);
    var purpose = type === "location" ? "location_consistency" : type === "style" ? "style_board" : "character_consistency";
    var label = media.length
      ? "Régénérer une nouvelle version"
      : type === "location" ? "Générer les vues du décor" : type === "style" ? "Générer la planche de style" : "Générer angles et émotions";
    var gallery = media.length
      ? '<div class="asset-media-grid">' + media.slice().reverse().map(function (item) {
          var cost = Number(item.estimatedCostUsd || 0);
          var review = item.review || {};
          var approved = isMediaApproved(item);
          var reviewPending = type === "character" && item.status === "approved" && !approved;
          var checklist = type === "character"
            ? '<div class="media-review"><strong>Contrôle humain avant validation</strong><div class="media-review-checks">' +
              '<label><input type="checkbox" data-media-review="angles"' + (review.angles ? ' checked' : '') + '> Face, profil, dos et trois-quarts</label>' +
              '<label><input type="checkbox" data-media-review="postures"' + (review.postures ? ' checked' : '') + '> Postures lisibles et cohérentes</label>' +
              '<label><input type="checkbox" data-media-review="emotions"' + (review.emotions ? ' checked' : '') + '> Émotions distinctes, même identité</label></div>' +
              '<button type="button" class="media-correction" data-review-correction>Préparer une correction ciblée</button>' +
              '<span class="media-review-error" data-media-approval-error hidden></span></div>'
            : '<span class="media-review-error" data-media-approval-error hidden></span>';
          return '<figure class="asset-media' + (approved ? ' is-approved' : '') + (reviewPending ? ' needs-review' : '') + '"><img src="' + escapeHtml(item.url) + '" alt="Planche de cohérence de ' + escapeHtml(asset.name) + '" loading="lazy">' + checklist + '<figcaption><span>v' + escapeHtml(item.version) + (approved ? ' · référence validée' : reviewPending ? ' · contrôle à compléter' : '') + ' · ' + escapeHtml(item.model || item.provider) + (cost ? ' · ' + cost.toLocaleString("fr-FR", { maximumFractionDigits: 3 }) + ' $ estimés' : '') + '</span><button type="button" class="media-approve' + (approved ? ' on' : '') + '" data-approve-media="' + escapeHtml(item.id) + '" data-approved="' + (approved ? '1' : '0') + '">' + (approved ? 'Validée' : reviewPending ? 'Revalider' : 'Valider comme référence') + '</button><a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">Ouvrir</a></figcaption></figure>';
        }).join("") + '</div>'
      : '<div class="asset-media-empty"><span>◇</span><p>Aucune image générée pour le moment.</p></div>';
    return '<article class="asset-library-card" data-asset-card="' + escapeHtml(asset.id) + '">' +
      '<div class="asset-library-head"><div><span class="field-label">' + (type === "location" ? "Décor" : type === "style" ? "Direction artistique" : "Personnage") + '</span><h3>' + escapeHtml(asset.name) + '</h3><p>' + escapeHtml(asset.description || "Description à préciser") + '</p></div><span class="pill">ID stable</span></div>' +
      gallery +
      '<div class="asset-generation-controls"><label class="choice-field asset-prompt"><span>Direction supplémentaire</span><textarea rows="2" data-asset-image-prompt placeholder="Ex. conserver exactement le bandeau rouge, expression déterminée…"></textarea></label>' +
      '<label class="choice-field asset-size"><span>Résolution</span><select data-asset-image-size><option value="512">512 · brouillon</option><option value="1K" selected>1K · standard</option><option value="2K">2K · détail</option><option value="4K">4K · final</option></select></label></div>' +
      (media.length ? '<label class="asset-restart"><input type="checkbox" data-asset-image-restart><span>Repartir de zéro — ' + (hasApprovedMedia ? 'abandonner la version validée' : 'ignorer la dernière version provisoire') + ' et redessiner ' + (type === "location" ? "ce décor" : type === "style" ? "cette planche de style" : "ce personnage") + '.</span></label>' : "") +
      '<div class="asset-library-actions"><button type="button" class="choice-action primary" data-generate-asset-image="' + escapeHtml(asset.id) + '" data-image-purpose="' + purpose + '">' + label + '</button><span class="hint" data-image-cost>' + escapeHtml(imageCostLabel("1K")) + ' · ' + (hasApprovedMedia ? 'la version validée sert de référence' : media.length ? 'la dernière version reste une ancre provisoire' : 'le clic confirme l’appel') + '.</span></div>' +
      '<div class="choice-error hint" data-asset-image-error hidden></div>' +
    '</article>';
  }

  function timeline() {
    var tracks = state && state.timeline && state.timeline.tracks || [];
    return '<div class="bridge-timeline">' + tracks.map(function (track) {
      var clips = track.clips || [];
      return '<div class="bridge-track"><div class="bridge-track-name">' + escapeHtml(trackLabels[track.kind] || track.kind) +
        '</div><div class="bridge-clips">' + (clips.length ? clips.map(function (clip) {
          return '<span class="bridge-clip">' + escapeHtml(clip.title || clip.label || clip.shotId || clip.id) + '</span>';
        }).join("") : '<span class="hint">Piste vide</span>') + '</div></div>';
    }).join("") + '</div>';
  }

  function contextLabel(tab) {
    if (!state) return null;
    var project = state.project || {};
    if (!project.id) return "Accueil · aucun projet actif";
    var firstNamed = function (type) {
      var match = (state.assets || []).filter(function (asset) { return asset.type === type; });
      return match.length ? match[0].name : null;
    };
    if (tab === "projet") return "Projet · " + (project.visualStyle || project.genre || project.title || "Style visuel");
    if (tab === "script") {
      var sequences = state.sequences || [];
      return sequences.length
        ? "Script → " + sequences[0].title + " · " + sequences.length + " séquence" + (sequences.length > 1 ? "s" : "")
        : "Script · structure à définir";
    }
    if (tab === "production") {
      var shots = state.shots || [];
      return shots.length ? "Production → " + shots.length + " plan" + (shots.length > 1 ? "s" : "") : "Production · aucun plan";
    }
    if (tab === "personnages") {
      var character = firstNamed("character");
      return character ? "Bible visuelle → " + character : "Bible visuelle · aucune référence";
    }
    if (tab === "decors") {
      return "Son · " + ((state.timeline && state.timeline.tracks || []).filter(function (track) { return track.kind !== "visual"; }).length) + " pistes";
    }
    if (tab === "export") return "Export · " + Math.round((state.timeline && state.timeline.durationMs || 0) / 100) / 10 + " s";
    return project.title || "Projet";
  }

  function refreshContextLabel() {
    var target = document.querySelector(".ctx-strong");
    if (!target) return;
    var active = document.querySelector('.rail-item[data-tab].on');
    var label = contextLabel(active ? active.getAttribute("data-tab") : "projet");
    if (label) target.textContent = label;
  }

  function renderLegacyPanels() {
    if (!state) return;
    refreshContextLabel();
    var project = state.project || {};
    var projectPane = document.querySelector('.panes-host > [data-tab="projet"]');
    var scriptPane = document.querySelector('.panes-host > [data-tab="script"]');
    var productionPane = document.querySelector('.panes-host > [data-tab="production"]');
    var charactersPane = document.querySelector('.panes-host > [data-tab="personnages"]');
    var locationsPane = document.querySelector('.panes-host > [data-tab="decors"]');
    var exportPane = document.querySelector('.panes-host > [data-tab="export"]');
    var projectPickerLabel = document.querySelector('.proj-pick span:nth-of-type(2)');

    if (projectPickerLabel) projectPickerLabel.textContent = project.title || "Accueil";

    if (projectPane) {
      var projectBody = project.id
        ? '<section><div class="sec-head"><span class="sec-title">Présentation validée</span><div class="spacer"></div><span class="pill pill-ok">Structurée</span></div><div class="project-structure-grid">' +
          '<div class="card project-structure-wide"><span class="field-label">Prémisse</span><p class="prose">' + escapeHtml(project.premise || project.brief || "Prémisse à préciser") + '</p></div>' +
          '<div class="card"><span class="field-label">Genre et tonalité</span><p class="prose">' + escapeHtml(project.genre || "À préciser") + '</p></div>' +
          '<div class="card"><span class="field-label">Direction visuelle</span><p class="prose">' + escapeHtml(project.visualStyle || "À préciser") + '</p></div>' +
          '<div class="card project-structure-wide"><span class="field-label">Squelette narratif</span><p class="prose">' + escapeHtml(project.narrativeOutline || project.brief || "À préciser") + '</p></div></div></section>' +
          '<section><div class="sec-head"><span class="sec-title">Paramètres vidéo</span></div><div class="grid2">' +
          '<div class="card"><span class="field-label">Format</span><div class="bridge-metric">' + escapeHtml(project.aspectRatio || "16:9") + '</div></div>' +
          '<div class="card"><span class="field-label">Durée cible</span><div class="bridge-metric">' + escapeHtml(project.durationSeconds || 8) + ' s</div></div></div></section>'
        : homeState();
      var styleAssets = (state.assets || []).filter(function (asset) { return asset.type === "style"; });
      if (project.id && styleAssets.length) {
        projectBody += '<section><div class="sec-head"><span class="sec-title">Direction artistique</span><div class="spacer"></div><span class="hint">Référence de départ de toutes les images</span></div>' +
          '<div class="asset-library">' + styleAssets.map(function (asset) { return assetCard(asset, "style"); }).join("") + '</div></section>';
      }
      projectPane.innerHTML = pane(project.title || "Créer avec CinemAI", project.id ? "Projet" : "Accueil", projectBody, project.id ? "Manifeste actif · révision " + state.revision : "Prêt à transformer votre idée en projet");
    }

    if (scriptPane) {
      var sequences = state.sequences || [];
      var shots = state.shots || [];
      var scriptBody = !sequences.length && !shots.length ? emptyState("Aucune séquence", "Le découpage peut rester minimal pour une vidéo simple : quelques poses ou un seul plan.", "Préparer le storyboard") :
        '<section><div class="sec-head"><span class="sec-title">Séquences</span></div>' + rows(sequences, function (item) {
          return '<div class="bridge-row"><div class="bridge-row-main"><strong>' + escapeHtml(item.title || item.id) + '</strong><small>' + escapeHtml(item.summary || "Sans résumé") + '</small></div></div>';
        }) + '</section><section><div class="sec-head"><span class="sec-title">Plans</span><div class="spacer"></div><span class="hint">Une image par plan</span></div>' +
        (shots.length ? '<div class="shot-board">' + shots.map(shotCard).join("") + '</div>' : '<span class="hint">Aucun plan pour le moment.</span>') + '</section>';
      scriptPane.innerHTML = pane("Storyboard", "Script", scriptBody, shots.length + " plan" + (shots.length > 1 ? "s" : ""));
    }

    if (productionPane) {
      var queue = state.queue || [];
      var productionBody = '<section><div class="sec-head"><span class="sec-title">Timeline canonique</span><div class="spacer"></div><span class="hint">' + Math.round((state.timeline.durationMs || 0) / 100) / 10 + ' s</span></div>' + timeline() + '</section>' +
        '<section><div class="sec-head"><span class="sec-title">File de production</span></div>' + (queue.length ? rows(queue, function (job) {
          return '<div class="bridge-row"><div class="bridge-row-main"><strong>' + escapeHtml(job.label) + '</strong><small>' + escapeHtml(job.strategy) + ' · ' + escapeHtml(job.status) + '</small></div></div>';
        }) : '<div class="card"><span class="hint">Aucune génération préparée.</span></div>') + '</section>';
      productionPane.innerHTML = pane("Production", "Régie", productionBody, "Aucun fournisseur payant lancé automatiquement");
    }

    function renderAssetPane(target, type, title, subtitle) {
      if (!target) return;
      var assets = (state.assets || []).filter(function (asset) { return asset.type === type; });
      var body = assets.length ? '<div class="asset-library">' + assets.map(function (asset) {
        return assetCard(asset, type);
      }).join("") + '</div>' : emptyState("Aucun " + subtitle.toLowerCase(), "Les références seront créées uniquement si le projet en a besoin.", "Définir " + (type === "character" ? "un personnage" : "un décor"));
      target.innerHTML = pane(title, "Bibliothèque", body, assets.length + " asset" + (assets.length > 1 ? "s" : ""));
    }
    renderAssetPane(charactersPane, "character", "Personnages", "Personnage");
    renderAssetPane(locationsPane, "location", "Décors", "Décor");

    if (exportPane) {
      var incomplete = (state.queue || []).some(function (job) { return job.status !== "succeeded"; });
      var exportBody = '<section><div class="sec-head"><span class="sec-title">Aperçu de livraison</span></div><div class="grid2">' +
        '<div class="card"><span class="field-label">Durée</span><div class="bridge-metric">' + Math.round((state.timeline.durationMs || 0) / 100) / 10 + ' s</div></div>' +
        '<div class="card"><span class="field-label">État</span><div class="bridge-metric" style="font-size:16px">' + (incomplete ? "À finaliser" : "Prêt à contrôler") + '</div></div></div></section>' +
        '<section><div class="sec-head"><span class="sec-title">Pistes livrables</span></div>' + timeline() + '</section>';
      exportPane.innerHTML = pane("Export", "Livraison", exportBody, "Publication YouTube désactivée dans ce MVP");
    }
  }

  var workflowStages = [
    { tab: "projet", number: "1", label: "Idée" },
    { tab: "personnages", number: "2", label: "Bible" },
    { tab: "script", number: "3", label: "Storyboard" },
    { tab: "production", number: "4", label: "Vidéo" },
    { tab: "decors", number: "5", label: "Son" },
    { tab: "export", number: "6", label: "Export" }
  ];

  var variantGroups = {
    character: [
      { title: "Angles", items: [["face", "Face"], ["profil", "Profil"], ["dos", "Dos"], ["trois_quarts", "Trois-quarts"]] },
      { title: "Postures", items: [["neutre", "Neutre"], ["course", "Course"], ["saut", "Saut"], ["combat", "Combat"]] },
      { title: "Émotions", items: [["surpris", "Surpris"], ["determine", "Déterminé"], ["vigilant", "Vigilant"]] }
    ],
    location: [
      { title: "Angles", items: [["large", "Vue large"], ["trois_quarts", "Trois-quarts"], ["laterale", "Latérale"], ["detail", "Détail"]] },
      { title: "Altérations", items: [["jour", "Jour"], ["nuit", "Nuit"], ["altere", "Altéré"]] }
    ],
    style: [
      { title: "Direction artistique", items: [["palette", "Palette"], ["matiere", "Matières"], ["lumiere", "Lumière"], ["objet", "Objet neutre"]] }
    ]
  };

  function currentTab() {
    var active = document.querySelector('.rail-item[data-tab].on');
    return active ? active.getAttribute("data-tab") : "projet";
  }

  function projectSummary() {
    var project = state && state.project || {};
    var text = project.premise || project.brief || "Décrivez votre idée pour structurer le projet.";
    return text.length > 155 ? text.slice(0, 152).trim() + "…" : text;
  }

  function workflowNav(activeTab) {
    return '<div class="project-workflow" aria-label="Étapes du projet">' + workflowStages.map(function (stage) {
      var on = stage.tab === activeTab;
      return '<button type="button" class="workflow-stage' + (on ? ' on' : '') + '" data-context-tab="' + stage.tab + '" aria-current="' + (on ? 'step' : 'false') + '">' +
        '<span class="workflow-node">' + stage.number + '</span><span class="workflow-label">' + escapeHtml(stage.label) + '</span></button>';
    }).join("") + '</div>';
  }

  function contextPane(activeTab, body, footer) {
    var project = state && state.project || {};
    return '<div class="project-context-head"><span class="context-kicker">Contexte du projet</span>' +
      '<h1>' + escapeHtml(project.title || "Nouveau projet") + '</h1><p>' + escapeHtml(projectSummary()) + '</p>' +
      '<span class="context-section-label">Étape actuelle</span>' + workflowNav(activeTab) + '</div>' +
      '<div class="pane-scroll project-context-scroll">' + body + '</div>' +
      // Le bouton ouvrait toujours l'étape Projet, quelle que soit l'étape
      // affichée : depuis le Storyboard il renvoyait à l'Idée. Il ouvre
      // désormais la vue d'ensemble de l'étape courante.
      '<div class="pane-foot project-context-foot"><span>' + escapeHtml(footer) + '</span><button type="button" data-context-tab="' + escapeHtml(activeTab) + '">Vue d’ensemble</button></div>';
  }

  function primaryAssetMedia(asset) {
    var media = mediaForAsset(asset.id).filter(function (item) {
      return item.purpose !== "set_layout" && String(item.purpose || "").indexOf("_variant") === -1;
    });
    return media.find(function (item) { return item.id === asset.approvedMediaId && isMediaApproved(item); }) ||
      media.find(isMediaApproved) || media[media.length - 1] || null;
  }

  function assetTypeLabel(type) {
    return type === "character" ? "Personnage" : type === "location" ? "Décor" : "Direction artistique";
  }

  function contextAssetCard(asset) {
    var media = primaryAssetMedia(asset);
    var approved = !!(media && isMediaApproved(media));
    return '<button type="button" class="context-asset-card" data-open-asset="' + escapeHtml(asset.id) + '">' +
      (media ? '<img src="' + escapeHtml(media.url) + '" alt="' + escapeHtml(asset.name) + '" loading="lazy">' : '<span class="context-asset-empty">À générer</span>') +
      '<span class="context-asset-copy"><strong>' + escapeHtml(asset.name) + '</strong><small>' + assetTypeLabel(asset.type) + (media ? ' · v' + media.version : '') + '</small><em>Voir et modifier</em></span>' +
      '<span class="context-asset-status' + (approved ? ' approved' : '') + '">' + (approved ? "Approuvé" : "À vérifier") + '</span>' +
      '<span class="context-asset-arrow" aria-hidden="true">›</span></button>';
  }

  function assetHistory(asset) {
    if (!asset) return "";
    var media = mediaForAsset(asset.id).filter(function (item) {
      return item.purpose !== "set_layout" && String(item.purpose || "").indexOf("_variant") === -1;
    }).slice().reverse().slice(0, 5);
    if (!media.length) return '<p class="context-empty-copy">Aucune version pour le moment.</p>';
    return '<div class="context-history">' + media.map(function (item, index) {
      return '<button type="button" class="context-history-row' + (index === 0 ? ' current' : '') + '" data-open-asset="' + escapeHtml(asset.id) + '">' +
        '<span class="history-dot"></span><img src="' + escapeHtml(item.url) + '" alt="Version ' + item.version + '" loading="lazy">' +
        '<span><strong>v' + item.version + '</strong><small>' + (item.status === "approved" ? "Référence approuvée" : "Version disponible") + '</small></span>' +
        (index === 0 ? '<em>Courante</em>' : '') + '</button>';
    }).join("") + '</div>';
  }

  function compactSection(title, content, detail) {
    return '<section class="context-section"><div class="context-section-head"><span>' + escapeHtml(title) + '</span>' +
      (detail ? '<small>' + escapeHtml(detail) + '</small>' : '') + '</div>' + content + '</section>';
  }

  function ideaContext() {
    var project = state.project || {};
    return compactSection("Idée structurée", '<div class="context-facts">' +
      '<div><span>Format</span><strong>' + escapeHtml(project.aspectRatio || "16:9") + '</strong></div>' +
      '<div><span>Durée</span><strong>' + escapeHtml(project.durationSeconds || 8) + ' s</strong></div>' +
      '<div class="wide"><span>Genre et tonalité</span><strong>' + escapeHtml(project.genre || "À préciser") + '</strong></div>' +
      '<div class="wide"><span>Direction visuelle</span><strong>' + escapeHtml(project.visualStyle || "Définie par la bible visuelle") + '</strong></div></div>', "Présentation validée");
  }

  function bibleContext() {
    var assets = state.assets || [];
    var chosen = assets.find(function (asset) { return asset.id === activeAssetId; }) ||
      assets.find(function (asset) { return asset.type === "character"; }) || assets[0];
    return compactSection("Références actives", assets.length ? '<div class="context-assets">' + assets.map(contextAssetCard).join("") + '</div>' : '<p class="context-empty-copy">Aucune référence visuelle.</p>', assets.length + " élément" + (assets.length > 1 ? "s" : "")) +
      compactSection("Historique des versions", assetHistory(chosen), chosen ? chosen.name : "");
  }

  function animaticFrames() {
    return (state.shots || []).map(function (shot, index) {
      var media = mediaForShot(shot.id).filter(function (item) { return item.kind === "image"; });
      var image = media.find(isMediaApproved) || media[media.length - 1] || null;
      return {
        index: index,
        title: shot.title || "Plan sans titre",
        description: shot.description || "",
        durationMs: Math.max(400, shot.durationMs || 4000),
        continuity: shot.continuity || "cut",
        url: image ? image.url : null,
        approved: image ? isMediaApproved(image) : false
      };
    });
  }

  function animaticMarkup(frames) {
    var total = frames.reduce(function (sum, frame) { return sum + frame.durationMs; }, 0);
    var missing = frames.filter(function (frame) { return !frame.url; }).length;
    var strip = frames.map(function (frame) {
      return '<button type="button" class="animatic-thumb" data-animatic-go="' + frame.index + '" title="' + escapeHtml(frame.title) + '">' +
        (frame.url ? '<img src="' + escapeHtml(frame.url) + '" alt="">' : '<span class="animatic-thumb-empty">◇</span>') +
        '<small>' + String(frame.index + 1).padStart(2, "0") + '</small></button>';
    }).join("");
    return '<header class="workspace-panel-head"><div><span class="field-label">Animatique</span>' +
      '<h2>Storyboard animé</h2><p class="hint">' + frames.length + ' plans · ' + Math.round(total / 100) / 10 + ' s' +
      (missing ? ' · ' + missing + ' plan' + (missing > 1 ? 's' : '') + ' sans image' : '') + ' · aucune génération, aucun coût</p></div>' +
      '<div class="asset-review-head-actions"><button type="button" class="workspace-expand" data-workspace-fullscreen aria-pressed="false">Plein écran</button>' +
      '<button type="button" class="workspace-close" data-close-workspace aria-label="Fermer">×</button></div></header>' +
      // Les commandes passent avant la scène : le panneau est court et le bouton
      // Lire ne doit jamais demander de faire défiler.
      '<div class="animatic-controls">' +
      '<button type="button" class="choice-action" data-animatic-step="-1">◀</button>' +
      '<button type="button" class="choice-action primary" data-animatic-toggle>Lire</button>' +
      '<button type="button" class="choice-action" data-animatic-step="1">▶</button>' +
      '<div class="animatic-progress"><span data-animatic-bar></span></div></div>' +
      '<div class="animatic-stage" data-animatic-stage></div>' +
      '<div class="animatic-meta" data-animatic-meta></div>' +
      '<div class="animatic-strip">' + strip + '</div>';
  }

  function paintAnimatic() {
    var frames = animaticFrames();
    var stage = document.querySelector("[data-animatic-stage]");
    if (!stage || !frames.length) return;
    if (animaticIndex >= frames.length) animaticIndex = 0;
    var frame = frames[animaticIndex];
    stage.innerHTML = frame.url
      ? '<img src="' + escapeHtml(frame.url) + '" alt="' + escapeHtml(frame.title) + '">'
      : '<div class="animatic-missing"><span>◇</span><p>Aucune image validée pour ce plan.</p></div>';
    var meta = document.querySelector("[data-animatic-meta]");
    if (meta) {
      meta.innerHTML = '<strong>' + String(frame.index + 1).padStart(2, "0") + ' · ' + escapeHtml(frame.title) + '</strong>' +
        '<span class="hint">' + Math.round(frame.durationMs / 100) / 10 + ' s · ' +
        (frame.continuity === "continuous" ? "raccord continu" : "coupe") +
        (frame.url ? (frame.approved ? " · image validée" : " · image non validée") : " · image manquante") + '</span>' +
        (frame.description ? '<p class="prose">' + escapeHtml(frame.description) + '</p>' : '');
    }
    var bar = document.querySelector("[data-animatic-bar]");
    if (bar) bar.style.width = Math.round(((animaticIndex + 1) / frames.length) * 100) + "%";
    document.querySelectorAll("[data-animatic-go]").forEach(function (node) {
      node.classList.toggle("on", Number(node.getAttribute("data-animatic-go")) === animaticIndex);
    });
    var toggle = document.querySelector("[data-animatic-toggle]");
    if (toggle) toggle.textContent = animaticPlaying ? "Pause" : "Lire";
  }

  function stopAnimatic() {
    if (animaticTimer) clearTimeout(animaticTimer);
    animaticTimer = null;
    animaticPlaying = false;
  }

  function advanceAnimatic() {
    var frames = animaticFrames();
    if (!frames.length) return stopAnimatic();
    // Chaque plan reste à l'écran exactement sa durée : c'est ce qui rend le
    // rythme jugeable avant toute génération.
    animaticTimer = setTimeout(function () {
      animaticIndex += 1;
      if (animaticIndex >= frames.length) {
        animaticIndex = frames.length - 1;
        stopAnimatic();
        paintAnimatic();
        return;
      }
      paintAnimatic();
      advanceAnimatic();
    }, frames[animaticIndex].durationMs);
  }

  function openAnimatic() {
    var frames = animaticFrames();
    if (!frames.length) return;
    stopAnimatic();
    animaticIndex = 0;
    showWorkspacePanel(animaticMarkup(frames), "animatic", "Storyboard · animatique");
    paintAnimatic();
  }

  var selectedStoryboardShotId = null;
  // Un texte saisi et non enregistré doit survivre à la navigation : sans cela
  // ouvrir un autre plan efface silencieusement le travail en cours.
  var shotDrafts = {};
  var storyboardReviewRequest = 0;

  function storyboardFrame(shot) {
    var media = mediaForShot(shot.id);
    return media.find(isMediaApproved) || media[media.length - 1];
  }

  function renderStoryboardWorkspace() {
    if (!state) return;
    var shots = state.shots || [];
    var selected = shots.find(function (shot) { return shot.id === selectedStoryboardShotId; });
    var cards = shots.map(function (shot, index) {
      var frame = storyboardFrame(shot);
      // La tuile ne peut pas être un bouton : elle en contient d'autres.
      return '<article class="storyboard-tile"><button type="button" class="storyboard-tile-open" data-edit-shot="' + escapeHtml(shot.id) + '">' +
        '<div class="storyboard-tile-image">' + (frame ? '<img src="' + escapeHtml(frame.url) + '" alt="Image du plan ' + (index + 1) + '">' : '<span>Image à créer</span>') +
        '<span class="storyboard-number">' + String(index + 1).padStart(2, '0') + '</span></div>' +
        '<div class="storyboard-tile-copy"><small>' + (shot.durationMs / 1000) + ' s · ' + (shot.continuity === 'continuous' ? 'Raccord continu' : 'Coupe') + '</small><h3>' + escapeHtml(shot.title || 'Sans titre') + '</h3><p>' + escapeHtml(shot.description) + '</p><span class="storyboard-status">' + (frame && isMediaApproved(frame) ? '✓ Image validée' : '○ Image à valider') + '</span><span class="storyboard-edit-label">Modifier le plan ↗</span></div></button>' +
        '<div class="storyboard-tile-actions">' +
        '<button type="button" data-move-shot="' + escapeHtml(shot.id) + '" data-direction="-1" title="Déplacer avant"' + (index === 0 ? ' disabled' : '') + '>◀</button>' +
        '<button type="button" data-move-shot="' + escapeHtml(shot.id) + '" data-direction="1" title="Déplacer après"' + (index === shots.length - 1 ? ' disabled' : '') + '>▶</button>' +
        '<button type="button" data-duplicate-shot="' + escapeHtml(shot.id) + '" title="Dupliquer ce plan">Dupliquer</button>' +
        '<button type="button" data-delete-shot="' + escapeHtml(shot.id) + '" title="Supprimer, récupérable">Supprimer</button>' +
        '</div></article>';
    }).join('');
    var trash = (state.trash || []).map(function (entry) {
      return '<li><span>' + escapeHtml(entry.shot.title || 'Plan sans titre') + '</span>' +
        '<button type="button" class="choice-action" data-restore-shot="' + escapeHtml(entry.shot.id) + '">Restaurer</button></li>';
    }).join('');
    var trashBlock = trash ? '<section class="storyboard-trash"><span class="context-kicker">Corbeille</span><ul>' + trash + '</ul></section>' : '';
    var content = selected ? storyboardEditor(selected) : '<div class="storyboard-grid">' + (cards || '<div class="storyboard-empty"><span>01 — Écriture</span><h3>Une idée devient une histoire.</h3><p>Proposez un scénario découpé en séquences et en plans. Relisez-le avant de créer les images.</p><button type="button" class="choice-action primary" data-draft-screenplay>Proposer le scénario</button></div>') + '</div>' + trashBlock;
    showWorkspacePanel('<section class="storyboard-workspace"><header class="workspace-panel-head"><div><span class="context-kicker">Atelier de réalisation</span><h2>' + (selected ? escapeHtml(selected.title || 'Modifier le plan') : 'Votre histoire, plan par plan.') + '</h2><p>' + shots.length + ' plans · ' + shots.reduce(function (sum, s) { return sum + s.durationMs / 1000; }, 0) + ' s · objectif ' + escapeHtml(state.project.durationSeconds) + ' s</p></div><div class="storyboard-toolbar">' +
      (selected ? '<button type="button" class="choice-action" data-storyboard-overview>Vue d’ensemble</button>' : '<button type="button" class="choice-action" data-draft-screenplay>' + (shots.length ? 'Développer le scénario' : 'Proposer le scénario') + '</button>') +
      '<button type="button" class="choice-action" data-open-animatic' + (!shots.length ? ' disabled' : '') + '>▶ Animatique</button><button type="button" class="workspace-close" data-close-workspace aria-label="Fermer">×</button></div></header>' +
      '<div class="storyboard-body"><div class="storyboard-main">' + content + '</div><aside class="storyboard-review"><span class="context-kicker">Continuité</span><h3>Vérifier avant de générer</h3><p>Contrôles de structure et de références. L’identité visuelle, les costumes et les accessoires restent à examiner sur les images.</p><div data-storyboard-review aria-live="polite">Vérification en cours…</div><button type="button" class="choice-action" data-refresh-storyboard-review>Revérifier</button></aside></div></section>', 'storyboard', 'Storyboard · scénario et cohérence');
    refreshStoryboardReview();
  }

  function storyboardEditor(shot) {
    var draft = shotDrafts[shot.id] || null;
    var current = draft ? draft.values : {
      title: shot.title || '',
      description: shot.description || '',
      seconds: String(shot.durationMs / 1000),
      continuity: shot.continuity || 'cut',
      dialogue: (shot.dialogue || []).map(function (line) { return line.speaker + ' : ' + line.line; }).join('\n'),
      assetIds: shot.assetIds || [],
    };
    // Un brouillon né d'une version dépassée signale un conflit d'édition.
    var conflicted = Boolean(draft && draft.baseVersion !== shot.version);
    var dialogue = current.dialogue;
    var frame = storyboardFrame(shot);
    return '<div class="storyboard-editor">' + (frame ? '<figure class="storyboard-editor-preview"><img src="' + escapeHtml(frame.url) + '" alt="Image de référence du plan"><figcaption>Image v' + frame.version + ' · ' + (isMediaApproved(frame) ? 'validée' : 'à valider') + '</figcaption></figure>' : '') + '<form data-shot-editor="' + escapeHtml(shot.id) + '" data-base-version="' + shot.version + '"><span class="context-kicker">Scénario · version ' + shot.version + '</span>' +
      (draft ? '<p class="storyboard-draft' + (conflicted ? ' conflict' : '') + '">' + (conflicted
        ? 'Ce plan a changé ailleurs pendant votre saisie. Votre brouillon est conservé ; enregistrez pour écraser, ou abandonnez-le.'
        : 'Brouillon non enregistré, conservé depuis votre dernière saisie.') +
        ' <button type="button" data-discard-draft="' + escapeHtml(shot.id) + '">Abandonner le brouillon</button></p>' : '') +
      '<label>Titre<input name="title" maxlength="120" value="' + escapeHtml(current.title) + '"></label>' +
      '<label>Action et cadrage<textarea name="description" rows="4" required maxlength="2000">' + escapeHtml(current.description) + '</textarea></label>' +
      '<div class="storyboard-fields"><label>Durée (secondes)<input name="seconds" type="number" min="0.25" max="120" step="0.25" required value="' + escapeHtml(current.seconds) + '"></label><label>Raccord<select name="continuity">' + option('cut', 'Coupe franche', current.continuity) + option('continuous', 'Prolonger le plan précédent', current.continuity) + '</select></label></div>' +
      '<label>Dialogues — une ligne « Personnage : réplique »<textarea name="dialogue" rows="3">' + escapeHtml(dialogue) + '</textarea></label>' +
      '<fieldset><legend>Personnages et décors liés</legend>' + (state.assets || []).map(function (asset) { return '<label class="storyboard-reference"><input type="checkbox" name="assetIds" value="' + escapeHtml(asset.id) + '"' + ((current.assetIds || []).includes(asset.id) ? ' checked' : '') + '>' + escapeHtml(asset.name) + '</label>'; }).join('') + '</fieldset>' +
      '<button class="choice-action primary" type="submit">Enregistrer le texte</button><p class="hint">Une nouvelle version du texte est conservée. L’image se régénère séparément.</p><p data-shot-save-status role="status"></p></form>' +
      '<details class="storyboard-history"><summary>Historique du texte (' + (shot.history || []).length + ')</summary>' + (shot.history || []).slice().reverse().map(function (old) { return '<article><strong>v' + old.version + ' · ' + escapeHtml(old.title) + '</strong><p>' + escapeHtml(old.description) + '</p><small>' + old.durationMs / 1000 + ' s</small></article>'; }).join('') + '</details>' +
      '<details class="storyboard-media-tools"><summary>Image du plan et génération séparée</summary>' + shotCard(shot) + '</details></div>';
  }

  function refreshStoryboardReview() {
    var request = ++storyboardReviewRequest;
    api('/api/storyboard/review').then(function (payload) {
      if (request !== storyboardReviewRequest || workspaceMode !== 'storyboard') return;
      var target = document.querySelector('[data-storyboard-review]');
      if (!target) return;
      var report = payload.review;
      target.innerHTML = '<strong>' + report.issues.length + ' point' + (report.issues.length > 1 ? 's' : '') + ' à examiner</strong><small>' + report.approvedFrames + '/' + report.shotCount + ' images validées</small>' +
        (report.issues.length ? '<ul>' + report.issues.map(function (issue) {
          var shot = (state.shots || []).find(function (s) { return s.id === issue.shotId; });
          return '<li>' + (shot ? '<button type="button" data-edit-shot="' + escapeHtml(shot.id) + '">' + escapeHtml(shot.title || 'Voir le plan') + ' ↗</button>' : '<b>Ensemble du film</b>') + '<p>' + escapeHtml(issue.message) + '</p></li>';
        }).join('') + '</ul>' : '<p>Les contrôles de structure passent. Revoyez les images dans l’animatique.</p>');
    }).catch(function (error) {
      var target = document.querySelector('[data-storyboard-review]');
      if (target && request === storyboardReviewRequest) target.textContent = error.message;
    });
  }

  function captureShotDraft(form) {
    var values = new FormData(form);
    shotDrafts[form.getAttribute('data-shot-editor')] = {
      baseVersion: Number(form.getAttribute('data-base-version')),
      values: {
        title: String(values.get('title') || ''),
        description: String(values.get('description') || ''),
        seconds: String(values.get('seconds') || ''),
        continuity: String(values.get('continuity') || 'cut'),
        dialogue: String(values.get('dialogue') || ''),
        assetIds: values.getAll('assetIds'),
      },
    };
  }

  document.addEventListener('input', function (event) {
    var draftForm = event.target.closest && event.target.closest('[data-shot-editor]');
    if (draftForm) captureShotDraft(draftForm);
  });

  document.addEventListener('change', function (event) {
    var changedForm = event.target.closest && event.target.closest('[data-shot-editor]');
    if (changedForm) captureShotDraft(changedForm);
  });

  document.addEventListener('submit', function (event) {
    var form = event.target.closest('[data-shot-editor]');
    if (!form) return;
    event.preventDefault();
    var values = new FormData(form);
    var status = form.querySelector('[data-shot-save-status]');
    var button = form.querySelector('[type="submit"]');
    var lines = String(values.get('dialogue')).split('\n').filter(function (line) { return line.trim(); });
    if (lines.length > 12 || lines.some(function (line) { return line.indexOf(':') < 1 || !line.slice(line.indexOf(':') + 1).trim(); })) { status.textContent = 'Utilisez au plus 12 lignes au format « Personnage : réplique ».'; return; }
    button.disabled = true;
    api('/api/shots/' + encodeURIComponent(form.getAttribute('data-shot-editor')), { method: 'PATCH', body: JSON.stringify({ baseVersion: Number(form.getAttribute('data-base-version')), patch: {
      title: values.get('title'), description: values.get('description'), durationMs: Math.round(Number(values.get('seconds')) * 1000), continuity: values.get('continuity'), assetIds: values.getAll('assetIds'), dialogue: lines.map(function (line) { var at = line.indexOf(':'); return { speaker: line.slice(0, at).trim(), line: line.slice(at + 1).trim() }; })
    } }) }).then(function (payload) {
      state = payload.manifest;
      state = payload.manifest;
      delete shotDrafts[form.getAttribute('data-shot-editor')];
      // Réafficher met à jour data-base-version : sans cela la sauvegarde
      // suivante repartirait sur une version périmée et serait refusée.
      renderStoryboardWorkspace();
      renderPanels();
      var message = document.querySelector('[data-shot-save-status]');
      if (message) message.textContent = 'Texte enregistré. Vérifiez l’image si l’action a changé.';
    }).catch(function (error) {
      button.disabled = false;
      if (error.status === 409) {
        status.textContent = 'Ce plan a changé ailleurs. Votre saisie est conservée ; relisez puis réenregistrez.';
        api('/api/workspace').then(function (payload) {
          state = payload.manifest || payload;
          renderStoryboardWorkspace();
        }).catch(function () {});
        return;
      }
      status.textContent = error.message;
    });
  });

  function storyboardContext() {
    var shots = state.shots || [];
    return compactSection("Plans du storyboard", shots.length ? '<div class="context-shot-list">' + shots.map(function (shot, index) {
      var media = mediaForShot(shot.id);
      var image = media.find(function (item) { return item.status === "approved"; }) || media[media.length - 1];
      return '<button type="button" data-edit-shot="' + escapeHtml(shot.id) + '"><span>' + String(index + 1).padStart(2, "0") + '</span>' +
        (image ? '<img src="' + escapeHtml(image.url) + '" alt="' + escapeHtml(shot.title) + '">' : '') +
        '<strong>' + escapeHtml(shot.title || "Plan sans titre") + '</strong><small>' + Math.round((shot.durationMs || 0) / 100) / 10 + ' s</small></button>';
    }).join("") + '</div>' +
      '<button type="button" class="context-primary-action" data-open-animatic>Lire l’animatique — sans coût</button>'
      : '<p class="context-empty-copy">Le storyboard n’a pas encore de plan.</p>', shots.length + " plan" + (shots.length > 1 ? "s" : ""));
  }

  function videoContext() {
    var shots = state.shots || [];
    var ready = shots.filter(function (shot) { return videoForShot(shot.id).length > 0; }).length;
    return compactSection("Production vidéo", '<div class="context-readiness"><div><span>Plans animés</span><strong>' + ready + ' / ' + shots.length + '</strong></div><div><span>Durée assemblée</span><strong>' + Math.round((state.timeline.durationMs || 0) / 100) / 10 + ' s</strong></div></div>' +
      '<button type="button" class="context-primary-action" data-context-tab="production">Ouvrir la timeline</button>', ready === shots.length && shots.length ? "Prête" : "En cours");
  }

  function soundContext() {
    var audioTracks = (state.timeline && state.timeline.tracks || []).filter(function (track) { return track.kind !== "visual"; });
    return compactSection("Pistes sonores", '<div class="context-audio-list">' + audioTracks.map(function (track) {
      var count = (track.clips || []).length;
      return '<div><span>' + escapeHtml(trackLabels[track.kind] || track.label) + '</span><strong class="' + (count ? 'ready' : '') + '">' + (count ? count + " clip" + (count > 1 ? "s" : "") : "À préparer") + '</strong></div>';
    }).join("") + '</div>', "Après verrouillage image");
  }

  function exportContext() {
    var shots = state.shots || [];
    var videos = shots.reduce(function (count, shot) { return count + (videoForShot(shot.id).length ? 1 : 0); }, 0);
    return compactSection("Prêt à exporter", '<div class="context-export-summary">' +
      '<div><span>Durée totale</span><strong>' + Math.round((state.timeline.durationMs || 0) / 100) / 10 + ' s</strong></div>' +
      '<div><span>Plans vidéo</span><strong>' + videos + ' / ' + shots.length + '</strong></div>' +
      '<div><span>Piste sonore</span><strong>' + ((state.timeline.tracks || []).some(function (track) { return track.kind !== "visual" && (track.clips || []).length; }) ? "Disponible" : "Optionnelle") + '</strong></div>' +
      '<div><span>Format courant</span><strong>' + escapeHtml(exportSettings.format) + ' · ' + escapeHtml(exportSettings.resolution) + '</strong></div></div>' +
      '<button type="button" class="context-primary-action" data-open-export>Configurer l’export</button>', videos === shots.length && shots.length ? "Tous les plans sont prêts" : "Vérification recommandée") +
      compactSection("Historique des exports", '<p class="context-empty-copy">Aucun export final lancé dans cette session.</p>', "Les réglages restent modifiables");
  }

  function renderPanels() {
    if (!state) return;
    refreshContextLabel();
    var project = state.project || {};
    var panes = {
      projet: document.querySelector('.panes-host > [data-tab="projet"]'),
      script: document.querySelector('.panes-host > [data-tab="script"]'),
      production: document.querySelector('.panes-host > [data-tab="production"]'),
      personnages: document.querySelector('.panes-host > [data-tab="personnages"]'),
      decors: document.querySelector('.panes-host > [data-tab="decors"]'),
      export: document.querySelector('.panes-host > [data-tab="export"]')
    };
    var projectPickerLabel = document.querySelector('.proj-pick span:nth-of-type(2)');
    if (projectPickerLabel) projectPickerLabel.textContent = project.title || "Accueil";
    if (!project.id) {
      if (panes.projet) panes.projet.innerHTML = contextPane("projet", homeState(), "Commencez par une idée");
      return;
    }
    if (panes.projet) panes.projet.innerHTML = contextPane("projet", ideaContext(), "Manifeste · révision " + state.revision);
    if (panes.personnages) panes.personnages.innerHTML = contextPane("personnages", bibleContext(), "Références visuelles du projet");
    if (panes.script) panes.script.innerHTML = contextPane("script", storyboardContext(), (state.shots || []).length + " plans au total");
    if (panes.production) panes.production.innerHTML = contextPane("production", videoContext(), "Générations et assemblage");
    if (panes.decors) panes.decors.innerHTML = contextPane("decors", soundContext(), "Son après verrouillage image");
    if (panes.export) panes.export.innerHTML = contextPane("export", exportContext(), "Options de livraison");
    if (workspaceMode === "asset" && activeAssetId) renderAssetInspector(activeAssetId);
    if (workspaceMode === "export") renderExportWorkspace();
    if (workspaceMode === "storyboard") renderStoryboardWorkspace();
  }

  function conversationPane() {
    return document.querySelector('.split > .pane[data-screen-label="Conversation de production"]');
  }

  function ensureConversationLayout(conversation) {
    var dock = conversation.querySelector("[data-chat-dock]");
    if (!dock) {
      dock = document.createElement("section");
      dock.className = "conversation-chat-dock";
      dock.setAttribute("data-chat-dock", "");
      dock.innerHTML = '<header class="chat-dock-head"><div><span class="context-kicker">Assistant · conversation de production</span><strong>Toujours ouverte</strong></div>' +
        '<div class="chat-dock-presets" aria-label="Taille de l’atelier"><button type="button" data-workspace-split="66" aria-pressed="true">2/3</button><button type="button" data-workspace-split="50" aria-pressed="false">1/2</button></div></header>';
      var firstThread = conversation.querySelector(":scope > [data-thread]");
      conversation.insertBefore(dock, firstThread || conversation.lastElementChild);
      Array.from(conversation.querySelectorAll(":scope > [data-thread]")).forEach(function (thread) { dock.appendChild(thread); });
      var composer = conversation.querySelector(":scope > .composer-wrap");
      if (composer) dock.appendChild(composer);
    }
    return dock;
  }

  function workspacePanel() {
    var conversation = conversationPane();
    if (!conversation) return null;
    var dock = ensureConversationLayout(conversation);
    var panel = conversation.querySelector("[data-workspace-panel]");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "conversation-workspace";
      panel.setAttribute("data-workspace-panel", "");
      conversation.insertBefore(panel, dock);
    }
    var splitter = conversation.querySelector("[data-workspace-resize]");
    if (!splitter) {
      splitter = document.createElement("div");
      splitter.className = "workspace-horizontal-splitter";
      splitter.setAttribute("data-workspace-resize", "");
      splitter.setAttribute("role", "separator");
      splitter.setAttribute("tabindex", "0");
      splitter.setAttribute("aria-label", "Redimensionner l’atelier et la conversation");
      splitter.setAttribute("aria-orientation", "horizontal");
      splitter.innerHTML = '<span aria-hidden="true"><i></i><i></i><i></i></span>';
      conversation.insertBefore(splitter, dock);
    }
    return panel;
  }

  function applyWorkspaceSplit(value) {
    workspaceSplit = Math.max(48, Math.min(76, Number(value) || 66));
    var conversation = conversationPane();
    if (!conversation) return;
    conversation.style.setProperty("--workspace-split", workspaceSplit + "%");
    conversation.querySelectorAll("[data-workspace-split]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(Number(button.getAttribute("data-workspace-split")) === workspaceSplit));
    });
    var splitter = conversation.querySelector("[data-workspace-resize]");
    if (splitter) splitter.setAttribute("aria-valuenow", String(workspaceSplit));
  }

  function showWorkspacePanel(html, mode, contextLabel) {
    var conversation = conversationPane();
    var panel = workspacePanel();
    if (!conversation || !panel) return;
    workspaceMode = mode;
    panel.innerHTML = html;
    conversation.classList.add("workspace-focused");
    conversation.classList.remove("workspace-maximized");
    applyWorkspaceSplit(workspaceSplit);
    var attachedContext = document.querySelector(".ctx-strong");
    if (attachedContext && contextLabel) attachedContext.textContent = contextLabel;
    panel.scrollTop = 0;
  }

  function closeWorkspacePanel() {
    stopAnimatic();
    var conversation = conversationPane();
    var panel = workspacePanel();
    workspaceMode = "conversation";
    activeVariantKey = null;
    activeMediaId = null;
    if (conversation) conversation.classList.remove("workspace-focused", "workspace-maximized");
    if (panel) panel.innerHTML = "";
    refreshContextLabel();
  }

  function variantMedia(assetId, key) {
    return mediaForAsset(assetId).filter(function (item) { return item.variantKey === key; });
  }

  function findVariantLabel(asset, key) {
    var groups = variantGroups[asset.type] || [];
    for (var groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      for (var itemIndex = 0; itemIndex < groups[groupIndex].items.length; itemIndex += 1) {
        if (groups[groupIndex].items[itemIndex][0] === key) return groups[groupIndex].items[itemIndex][1];
      }
    }
    return key;
  }

  function variantTile(asset, item) {
    var key = item[0];
    var label = item[1];
    var versions = variantMedia(asset.id, key);
    var latest = versions[versions.length - 1];
    var selected = key === activeVariantKey;
    return '<button type="button" class="asset-film-thumb asset-variant-tile' + (selected ? ' selected' : '') + (latest ? '' : ' is-empty') + '" data-select-variant="' + escapeHtml(key) + '" data-asset-id="' + escapeHtml(asset.id) + '"' + (latest ? ' data-media-id="' + escapeHtml(latest.id) + '"' : '') + '>' +
      (latest ? '<img src="' + escapeHtml(latest.url) + '" alt="' + escapeHtml(label + " de " + asset.name) + '" loading="lazy">' : '<span class="film-thumb-empty"><strong>' + escapeHtml(label) + '</strong><small>À générer</small></span>') +
      '<span class="film-thumb-label">' + escapeHtml(label) + (latest ? ' · v' + escapeHtml(latest.variantVersion || versions.length) : '') + '</span></button>';
  }

  function renderAssetInspector(assetId) {
    var asset = (state.assets || []).find(function (item) { return item.id === assetId; });
    if (!asset) { closeWorkspacePanel(); return; }
    activeAssetId = asset.id;
    var groups = variantGroups[asset.type] || variantGroups.character;
    if (!activeVariantKey || !groups.some(function (group) { return group.items.some(function (item) { return item[0] === activeVariantKey; }); })) {
      var firstWithMedia = null;
      groups.some(function (group) {
        return group.items.some(function (item) {
          if (variantMedia(asset.id, item[0]).length) { firstWithMedia = item[0]; return true; }
          return false;
        });
      });
      activeVariantKey = firstWithMedia || groups[0].items[0][0];
    }
    var anchor = primaryAssetMedia(asset);
    var selectedVersions = variantMedia(asset.id, activeVariantKey);
    var selected = selectedVersions[selectedVersions.length - 1];
    if (activeMediaId) {
      var requestedMedia = mediaForAsset(asset.id).find(function (item) { return item.id === activeMediaId; });
      if (requestedMedia) {
        selected = requestedMedia;
        if (requestedMedia.variantKey) {
          activeVariantKey = requestedMedia.variantKey;
          selectedVersions = variantMedia(asset.id, activeVariantKey);
        }
      } else activeMediaId = null;
    }
    if (!activeMediaId && selected) activeMediaId = selected.id;
    var label = findVariantLabel(asset, activeVariantKey);
    var filmstrip = groups.map(function (group) {
      return '<section class="asset-film-group"><div class="variant-group-title"><span>' + escapeHtml(group.title) + '</span><small>' + group.items.length + '</small></div>' +
        '<div class="asset-film-row">' + group.items.map(function (item) { return variantTile(asset, item); }).join("") + '</div></section>';
    }).join("");
    var history = selectedVersions.length > 1
      ? '<details class="variant-history"><summary>Comparer les versions (' + selectedVersions.length + ')</summary><div>' + selectedVersions.slice().reverse().map(function (item) {
          return '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener"><img src="' + escapeHtml(item.url) + '" alt="Version ' + escapeHtml(item.variantVersion || item.version) + '"><span>v' + escapeHtml(item.variantVersion || item.version) + '</span></a>';
        }).join("") + '</div></details>'
      : '<span class="variant-history-empty">Aucune version précédente pour cette image.</span>';
    var hero = selected || anchor;
    var assetVersions = mediaForAsset(asset.id).filter(function (item) { return !item.variantKey; }).slice().reverse();
    showWorkspacePanel('<section class="asset-inspector asset-review-desk" data-asset-inspector="' + escapeHtml(asset.id) + '">' +
        '<header class="workspace-panel-head asset-review-head"><div><span class="context-kicker">Atelier ' + escapeHtml(assetTypeLabel(asset.type)) + '</span><h2>' + escapeHtml(asset.name) + '</h2><p>Identité visuelle · référence v' + escapeHtml(anchor && anchor.version || asset.version || 1) + (anchor && isMediaApproved(anchor) ? " approuvée" : " à vérifier") + '</p></div>' +
        '<div class="asset-review-head-actions"><button type="button" class="workspace-expand" data-workspace-fullscreen aria-pressed="false">Plein écran</button><button type="button" class="workspace-close" data-close-workspace aria-label="Fermer">×</button></div></header>' +
        '<div class="asset-review-body"><div class="asset-review-stage-column">' +
          '<figure class="asset-review-stage' + (!selected && anchor ? ' shows-reference' : '') + '">' +
            (hero ? '<img src="' + escapeHtml(hero.url) + '" alt="' + escapeHtml((selected ? label : "Planche de référence") + " de " + asset.name) + '">' : '<div class="asset-review-no-media"><strong>Aucune image disponible</strong><span>Générez d’abord une planche de référence.</span></div>') +
            '<figcaption><strong>' + escapeHtml(label) + '</strong><span>' + (selected ? 'Image individuelle · v' + escapeHtml(selected.variantVersion || selected.version) : 'Aperçu depuis la référence · image individuelle à générer') + '</span></figcaption>' +
          '</figure><div class="asset-filmstrip">' + filmstrip + '</div></div>' +
          '<aside class="asset-review-meta">' +
            (anchor ? '<section class="asset-meta-source"><span class="context-kicker">Source</span><div><img src="' + escapeHtml(anchor.url) + '" alt="Planche de référence"><span><strong>Planche v' + escapeHtml(anchor.version) + '</strong><em>' + (isMediaApproved(anchor) ? "Approuvée" : "Provisoire") + '</em><a href="' + escapeHtml(anchor.url) + '" target="_blank" rel="noopener">Ouvrir la planche</a></span></div></section>' : '') +
            '<section class="asset-meta-fact"><span>Catégorie</span><strong>' + escapeHtml(assetTypeLabel(asset.type)) + '</strong><small>' + escapeHtml(asset.description || "Identité visuelle principale") + '</small></section>' +
            '<section class="asset-meta-fact"><span>Statut</span><strong class="asset-status-line">' + (anchor && isMediaApproved(anchor) ? "Approuvée" : "À vérifier") + '</strong></section>' +
            '<section class="asset-meta-versions"><span class="context-kicker">Versions</span>' + (assetVersions.length ? assetVersions.slice(0, 4).map(function (item, index) { return '<button type="button" data-select-asset-media="' + escapeHtml(item.id) + '" data-asset-id="' + escapeHtml(asset.id) + '"><strong>v' + escapeHtml(item.version) + '</strong><small>' + (index === 0 ? "Courante" : "Disponible") + '</small></button>'; }).join("") : '<small>Aucune version.</small>') + '</section>' +
            '<section class="asset-meta-command" data-variant-command><div class="variant-command-title"><span>Modification ciblée</span><strong>' + escapeHtml(label) + '</strong>' + (selected && selected.variantKey ? '<em>v' + escapeHtml(selected.variantVersion || selectedVersions.length) + '</em>' : '<em>À générer</em>') + '</div>' +
              '<textarea rows="3" data-variant-prompt placeholder="Ex. conserver le costume, rendre le regard plus calme…"></textarea>' +
              '<label><span>Résolution</span><select data-variant-size><option value="512">512 · brouillon</option><option value="1K" selected>1K · standard</option><option value="2K">2K · détail</option><option value="4K">4K · final</option></select></label>' +
              '<button type="button" class="choice-action primary" data-generate-variant="' + escapeHtml(asset.id) + '" data-variant-key="' + escapeHtml(activeVariantKey) + '">' + (selected && selected.variantKey ? "Régénérer cette image" : "Générer une nouvelle image") + '</button>' + history + '<div class="choice-error hint" data-variant-error hidden></div></section>' +
          '</aside></div>' +
      '</section>', "asset", "Bible visuelle · " + asset.name);
    var thread = activeThread();
    if (thread && !thread.querySelector('[data-asset-context="' + CSS.escape(asset.id) + '"]')) {
      var contextMessage = document.createElement("div");
      contextMessage.className = "msg asset-context-message";
      contextMessage.setAttribute("data-asset-context", asset.id);
      contextMessage.innerHTML = '<span class="av av-ai">AI</span><div class="fx col gap6"><p class="prose">' + escapeHtml(asset.name) + ' est joint à la conversation. Décrivez une correction : je préparerai une proposition à valider sans toucher aux images existantes.</p><span class="chat-source">Contexte de la Bible</span></div>';
      thread.appendChild(contextMessage);
    }
  }

  function exportOption(key, value, label) {
    return '<button type="button" class="export-option' + (String(exportSettings[key]) === String(value) ? ' selected' : '') + '" data-export-key="' + escapeHtml(key) + '" data-export-value="' + escapeHtml(value) + '">' + escapeHtml(label || value) + '</button>';
  }

  function renderExportWorkspace() {
    var project = state.project || {};
    var shots = state.shots || [];
    var videoMedia = (state.media || []).filter(function (item) { return item.targetType === "shot" && item.kind === "video"; });
    var latestVideos = shots.map(function (shot) {
      var clips = videoMedia.filter(function (item) { return item.targetId === shot.id; });
      return clips[clips.length - 1];
    }).filter(Boolean);
    var seconds = Math.round((state.timeline.durationMs || 0) / 100) / 10;
    var defaultFileName = String(project.title || "film-cinemai").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "") + "_v" + state.revision;
    var fileName = exportSettings.fileName || defaultFileName;
    showWorkspacePanel('<div class="workspace-message"><span class="av av-ai">✦</span><p>Le film est prêt à être contrôlé. Choisissez les paramètres de livraison sans quitter la conversation.</p></div>' +
      '<section class="export-workspace"><header class="workspace-panel-head"><div><span class="context-kicker">Livraison</span><h2>Exporter le film</h2><p>' + escapeHtml(latestVideos.length + " plan" + (latestVideos.length > 1 ? "s" : "") + " vidéo sur " + shots.length + " · " + seconds + " s") + '</p></div>' +
      '<button type="button" class="workspace-close" data-close-workspace aria-label="Fermer">×</button></header>' +
      '<div class="export-controls-grid">' +
        '<fieldset><legend>Format</legend><div class="export-segment">' + exportOption("format", "MP4") + exportOption("format", "MOV") + exportOption("format", "WebM") + '</div></fieldset>' +
        '<fieldset><legend>Résolution</legend><div class="export-segment">' + exportOption("resolution", "1080p") + exportOption("resolution", "1440p") + exportOption("resolution", "4K") + '</div></fieldset>' +
        '<fieldset><legend>Fréquence d’images</legend><div class="export-segment">' + exportOption("fps", "24", "24") + exportOption("fps", "25", "25") + exportOption("fps", "30", "30 ips") + '</div></fieldset>' +
        '<fieldset><legend>Ratio</legend><div class="export-segment">' + exportOption("ratio", "16:9") + exportOption("ratio", "9:16") + exportOption("ratio", "1:1") + '</div></fieldset>' +
      '</div>' +
      '<div class="export-switches"><label><span><strong>Audio</strong><small>Inclure le mixage final</small></span><input type="checkbox" data-export-toggle="audio"' + (exportSettings.audio ? ' checked' : '') + '></label>' +
        '<label><span><strong>Sous-titres</strong><small>Intégrer au fichier</small></span><input type="checkbox" data-export-toggle="subtitles"' + (exportSettings.subtitles ? ' checked' : '') + '></label>' +
        '<label><span><strong>Filigrane</strong><small>Identification du projet</small></span><input type="checkbox" data-export-toggle="watermark"' + (exportSettings.watermark ? ' checked' : '') + '></label></div>' +
      '<div class="export-final-row"><fieldset><legend>Qualité</legend><div class="export-segment">' + exportOption("quality", "Standard") + exportOption("quality", "Haute") + exportOption("quality", "Master") + '</div></fieldset>' +
        '<label class="export-file-name"><span>Nom du fichier</span><input type="text" data-export-filename value="' + escapeHtml(fileName) + '"></label></div>' +
      '<div class="export-estimate"><div><span>Taille estimée</span><strong>' + Math.max(1, Math.round(seconds * (exportSettings.resolution === "4K" ? 18 : exportSettings.resolution === "1440p" ? 10 : 6))) + ' Mo</strong></div><div><span>Temps de rendu estimé</span><strong>Après assemblage</strong></div></div>' +
      '<div class="export-actions"><button type="button" class="choice-action primary" data-run-export>Lancer l’export</button><button type="button" class="choice-action" data-export-separate>Exporter les plans séparément</button></div>' +
      '<div class="export-after"><span>Après l’export</span><button type="button" data-export-after="download">Télécharger</button><button type="button" data-export-after="link">Copier un lien</button><button type="button" data-export-after="archive">Archive du projet</button></div>' +
      '<div class="export-result" data-export-result hidden></div></section>', "export", "Export · paramètres de livraison");
  }

  function operationPresentation(approval) {
    var operation = approval.operation || {};
    var args = operation.args || {};
    var presentations = {
      set_project: ["Idée structurée · validation requise", args.title || "Définir le projet", args.premise || args.brief || "Prémisse, genre, direction visuelle et squelette narratif."],
      create_asset: [args.assetType === "location" ? "Créer un décor" : "Créer un asset", args.name || "Nouvelle référence", args.description || "Référence stable pour la continuité."],
      update_asset: ["Modifier une référence", args.name || "Mettre à jour l’asset", args.description || "La description sera modifiée après validation."],
      create_screenplay: ["Scénario proposé", "Découpage complet à relire", "Valider ce scénario crée ses séquences et ses plans, sans générer d’image ni de vidéo."],
      create_sequence: ["Ajouter une séquence", args.title || "Nouvelle séquence", args.summary || "Bloc narratif proposé."],
      create_shot: ["Ajouter un plan", args.title || "Nouveau plan", args.description || "Plan proposé pour le storyboard."],
      update_shot: ["Corriger un plan", "Modification locale", "Seul le plan ciblé sera modifié."],
      add_timeline_clip: ["Placer sur la timeline", args.title || "Clip visuel", "Ajout à la piste visuelle canonique."],
      add_audio_clip: ["Ajouter un son", args.title || "Clip audio", "Ajout sur une piste audio séparée."],
      queue_generation: ["Préparer une génération", args.label || "Génération", "Ajout à la file locale, sans dépense automatique."]
    };
    return presentations[operation.name] || ["Proposition", "Action préparée", "Cette action attend votre validation."];
  }

  function option(value, label, selected) {
    return '<option value="' + escapeHtml(value) + '"' + (String(value) === String(selected) ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
  }

  function editableFields(approval) {
    var operation = approval.operation || {};
    var args = operation.args || {};
    if (operation.name === "create_screenplay") {
      return '<div class="screenplay-proposal">' + (args.sequences || []).map(function (sequence) {
        return '<h3>' + escapeHtml(sequence.title) + '</h3><p>' + escapeHtml(sequence.summary || '') + '</p>' + (sequence.shots || []).map(function (shot) {
          return '<article><strong>' + escapeHtml(shot.title) + ' · ' + (Number(shot.durationMs) / 1000) + ' s</strong><p>' + escapeHtml(shot.description) + '</p>' + (shot.dialogue || []).map(function (line) { return '<p><em>' + escapeHtml(line.speaker) + ' : ' + escapeHtml(line.line) + '</em></p>'; }).join('') + '</article>';
        }).join('');
        }).join('') + '</div>';
    }
    if (operation.name === "set_project") {
      return '<div class="choice-structure"><div class="choice-field choice-field-wide"><label>Prémisse</label><textarea data-choice-field="premise" rows="3">' + escapeHtml(args.premise || args.brief || "") + '</textarea></div>' +
        '<div class="choice-field"><label>Genre et tonalité</label><textarea data-choice-field="genre" rows="2">' + escapeHtml(args.genre || "") + '</textarea></div>' +
        '<div class="choice-field"><label>Direction visuelle</label><textarea data-choice-field="visualStyle" rows="2">' + escapeHtml(args.visualStyle || "") + '</textarea></div>' +
        '<div class="choice-field choice-field-wide"><label>Squelette narratif</label><textarea data-choice-field="narrativeOutline" rows="4">' + escapeHtml(args.narrativeOutline || "") + '</textarea></div></div>' +
        '<div class="choice-fields">' +
        '<div class="choice-field"><label>Format</label><select data-choice-field="aspectRatio">' + option("16:9", "16:9 · paysage", args.aspectRatio || "16:9") + option("9:16", "9:16 · vertical", args.aspectRatio) + option("1:1", "1:1 · carré", args.aspectRatio) + '</select></div>' +
        '<div class="choice-field"><label>Durée cible</label><select data-choice-field="durationSeconds">' + [4, 6, 8, 15, 30].map(function (seconds) { return option(seconds, seconds + " secondes", args.durationSeconds || 8); }).join("") + '</select></div></div>';
    }
    if (operation.name === "update_shot") {
      var currentShot = (state.shots || []).find(function (shot) { return shot.id === args.shotId; });
      return '<div class="screenplay-proposal"><h3>' + escapeHtml(currentShot && currentShot.title || 'Plan') + '</h3>' + Object.keys(args.patch || {}).map(function (key) { var labels = { title: 'Titre', description: 'Action', durationMs: 'Durée (ms)', continuity: 'Raccord', dialogue: 'Dialogues', assetIds: 'Références' }; return '<p><b>' + escapeHtml(labels[key] || key) + '</b><br>' + escapeHtml(typeof args.patch[key] === 'object' ? JSON.stringify(args.patch[key]) : args.patch[key]) + '</p>'; }).join('') + '</div>';
    }
    if (operation.name === "create_shot") {
      return '<div class="choice-fields"><div class="choice-field"><label>Durée du plan</label><select data-choice-field="durationMs">' + [1000, 2000, 4000, 6000, 8000].map(function (ms) { return option(ms, ms / 1000 + " seconde" + (ms > 1000 ? "s" : ""), args.durationMs || 4000); }).join("") + '</select></div>' +
        '<div class="choice-field"><label>Stratégie</label><select data-choice-field="strategy">' + option("image", "Image / pose", args.strategy || "image") + option("image_sequence", "Séquence d’images", args.strategy) + option("first_last_video", "Première → dernière image", args.strategy) + option("micro_video", "Vidéo courte", args.strategy) + '</select></div></div>';
    }
    if (operation.name === "update_asset") {
      var currentAsset = state && (state.assets || []).find(function (item) { return item.id === args.assetId; });
      return '<div class="choice-structure"><div class="choice-field"><label>Nom</label><input data-choice-field="name" value="' + escapeHtml(args.name || currentAsset && currentAsset.name || "") + '" placeholder="Conserver le nom actuel"></div>' +
        '<div class="choice-field choice-field-wide"><label>Description proposée</label><textarea data-choice-field="description" rows="4">' + escapeHtml(args.description || currentAsset && currentAsset.description || "") + '</textarea></div></div>';
    }
    return "";
  }

  function choiceCard(approval, index) {
    var presentation = operationPresentation(approval);
    return '<article class="proposal bridge-choice" data-approval-card="' + escapeHtml(approval.id) + '">' +
      '<div><div class="choice-kicker">Proposition ' + (index + 1) + '</div><div class="choice-title">' + escapeHtml(presentation[1]) + '</div></div>' +
      '<p class="choice-summary">' + escapeHtml(presentation[2]) + '</p>' + editableFields(approval) +
      '<div class="choice-actions"><button class="choice-action primary" data-choice="approve">Utiliser cette proposition</button><button class="choice-action" data-choice="reject">Écarter</button></div>' +
      '<details class="choice-technical"><summary>Détails techniques</summary><pre>' + escapeHtml(JSON.stringify(approval.operation.args || {}, null, 2)) + '</pre></details>' +
      '</article>';
  }

  function activeThread() {
    return document.querySelector('[data-thread]:not(.off)') || document.querySelector('[data-thread="projet"]');
  }

  function unifyConversationSurface() {
    var target = activeThread();
    if (!target) return;
    document.querySelectorAll("[data-thread]").forEach(function (thread) {
      if (thread === target) return;
      while (thread.firstChild) target.appendChild(thread.firstChild);
    });
    target.scrollTop = target.scrollHeight;
  }

  function renderApprovals(thread) {
    if (!state) return;
    var target = thread && !thread.classList.contains("off") ? thread : activeThread();
    if (!target) return;
    document.querySelectorAll(".bridge-approval-stack").forEach(function (existing) { existing.remove(); });
    var seen = {};
    var pending = (state.approvals || []).filter(function (approval) {
      if (approval.status !== "pending") return false;
      var operation = approval.operation || {};
      var key = operation.name + ":" + JSON.stringify(operation.args || {});
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).slice(-2);
    if (!pending.length) return;
    var wrapper = document.createElement("div");
    wrapper.className = "msg bridge-approval-stack";
    wrapper.innerHTML = '<span class="av av-ai">✦</span><div class="fx col gap12" style="min-width:0;flex:1">' +
      '<p class="prose">Choisissez une direction. Vous pouvez ajuster les paramètres avant validation.</p>' +
      pending.map(choiceCard).join("") +
      '<button class="choice-action" data-choice-new>Proposer autre chose</button></div>';
    target.appendChild(wrapper);
    target.scrollTop = target.scrollHeight;
  }

  async function decide(card, decision) {
    var approvalId = card.getAttribute("data-approval-card");
    var adjusted = {};
    card.querySelectorAll("[data-choice-field]").forEach(function (field) {
      var value = field.value;
      adjusted[field.getAttribute("data-choice-field")] = /^\d+$/.test(value) ? Number(value) : value;
    });
    card.style.opacity = "0.55";
    card.style.pointerEvents = "none";
    try {
      var payload = await api("/api/approvals/" + encodeURIComponent(approvalId) + "/decision", {
        method: "POST",
        body: JSON.stringify({ decision: decision, args: decision === "approve" ? adjusted : undefined })
      });
      state = payload.manifest;
      renderPanels();
      renderApprovals(activeThread());
      if (decision === "approve") autoContinueStreak = 0;
      var pending = (state.approvals || []).some(function (approval) { return approval.status === "pending"; });
      var canAutoContinue = !pending && window.CinemAIChat && typeof window.CinemAIChat.continueWorkflow === "function" &&
        !continuationRunning && autoContinueStreak < AUTO_CONTINUE_LIMIT;
      if (canAutoContinue) {
        continuationRunning = true;
        autoContinueStreak += 1;
        try {
          await window.CinemAIChat.continueWorkflow(
            "Les propositions affichées viennent d’être traitées. Continue le workflow à partir du manifeste actuel. " +
            "Ne répète aucune opération déjà appliquée et propose uniquement les prochaines actions logiques à valider. " +
            "Si aucune action nouvelle et pertinente ne se dégage, dis-le explicitement plutôt que de répéter une proposition déjà écartée."
          );
        } finally {
          continuationRunning = false;
        }
      } else if (!pending && autoContinueStreak >= AUTO_CONTINUE_LIMIT) {
        renderContinuePrompt(activeThread());
      }
    } catch (error) {
      card.style.opacity = "1";
      card.style.pointerEvents = "auto";
      delete card.dataset.decisionQueued;
      var errorNode = card.querySelector(".choice-error");
      if (!errorNode) {
        errorNode = document.createElement("div");
        errorNode.className = "choice-error hint";
        card.appendChild(errorNode);
      }
      errorNode.textContent = error.message;
    }
  }

  function enqueueDecision(card, decision) {
    if (!card || card.dataset.decisionQueued === "true") return;
    card.dataset.decisionQueued = "true";
    card.style.opacity = "0.55";
    card.style.pointerEvents = "none";
    decisionQueue = decisionQueue.then(function () { return decide(card, decision); });
  }

  function clearStaticExamples() {
    document.querySelectorAll("[data-thread]").forEach(function (thread) { thread.innerHTML = ""; });
  }

  function renderHomeAssistant() {
    if (!state || state.project && state.project.id) return;
    var thread = document.querySelector('[data-thread="projet"]');
    if (!thread) return;
    thread.innerHTML = '<div class="home-thread-welcome">' +
      '<div class="home-thread-core" aria-hidden="true"><span>✦</span></div>' +
      '<span class="home-kicker">Assistant CinemAI</span>' +
      '<h2>Par quoi commençons-nous&nbsp;?</h2>' +
      '<p>Une intention, une scène, un personnage ou simplement une ambiance suffisent. Je transformerai votre point de départ en prochaines actions claires.</p>' +
      '<div class="home-thread-prompts">' +
        '<button type="button" data-home-prompt="J’ai une idée de film. Aide-moi à la transformer en projet : "><span>✦</span> Développer une idée</button>' +
        '<button type="button" data-home-prompt="Je veux construire une scène à partir de cette ambiance : "><span>◌</span> Imaginer une scène</button>' +
        '<button type="button" data-home-prompt="Aide-moi à créer un personnage cohérent pour mon film : "><span>◇</span> Créer un personnage</button>' +
        '<button type="button" data-home-prompt="Je veux organiser ce scénario existant : "><span>≡</span> Organiser un scénario</button>' +
      '</div>' +
      '<span class="home-thread-note"><i class="home-status-dot"></i> Je propose, vous décidez avant toute modification.</span>' +
    '</div>';
  }

  async function load() {
    clearStaticExamples();
    try {
      var payloads = await Promise.all([api("/api/workspace"), api("/api/media/config")]);
      state = payloads[0].manifest;
      mediaConfig = payloads[1];
      renderPanels();
      renderHomeAssistant();
      unifyConversationSurface();
      renderApprovals(activeThread());
    } catch (error) {
      var target = activeThread();
      if (target) target.innerHTML = '<div class="msg"><span class="av av-ai">!</span><p class="prose">' + escapeHtml(error.message) + '</p></div>';
    } finally {
      document.documentElement.classList.add("bridge-ready");
    }
  }

  document.addEventListener("click", function (event) {
    var editShot = event.target.closest('[data-edit-shot]');
    if (editShot) { selectedStoryboardShotId = editShot.getAttribute('data-edit-shot'); renderStoryboardWorkspace(); return; }
    var discardDraft = event.target.closest('[data-discard-draft]');
    if (discardDraft) {
      delete shotDrafts[discardDraft.getAttribute('data-discard-draft')];
      renderStoryboardWorkspace();
      return;
    }
    var storyboardAction = event.target.closest('[data-move-shot],[data-duplicate-shot],[data-delete-shot],[data-restore-shot]');
    if (storyboardAction) {
      var move = storyboardAction.getAttribute('data-move-shot');
      var payload = null;
      if (move) {
        var ids = (state.shots || []).map(function (shot) { return shot.id; });
        var from = ids.indexOf(move);
        var to = from + Number(storyboardAction.getAttribute('data-direction'));
        if (from < 0 || to < 0 || to >= ids.length) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        payload = { operation: 'reorder_shots', args: { order: ids } };
      } else if (storyboardAction.getAttribute('data-duplicate-shot')) {
        payload = { operation: 'duplicate_shot', args: { shotId: storyboardAction.getAttribute('data-duplicate-shot') } };
      } else if (storyboardAction.getAttribute('data-delete-shot')) {
        payload = { operation: 'delete_shot', args: { shotId: storyboardAction.getAttribute('data-delete-shot') } };
      } else {
        payload = { operation: 'restore_shot', args: { shotId: storyboardAction.getAttribute('data-restore-shot') } };
      }
      storyboardAction.disabled = true;
      api('/api/storyboard/edit', { method: 'POST', body: JSON.stringify(payload) }).then(function (result) {
        state = result.manifest;
        renderStoryboardWorkspace();
        renderPanels();
      }).catch(function (error) {
        storyboardAction.disabled = false;
        storyboardAction.title = error.message;
      });
      return;
    }
    if (event.target.closest('[data-storyboard-overview]')) { selectedStoryboardShotId = null; renderStoryboardWorkspace(); return; }
    if (event.target.closest('[data-refresh-storyboard-review]')) { refreshStoryboardReview(); return; }
    var draftScreenplay = event.target.closest('[data-draft-screenplay]');
    if (draftScreenplay) {
      if (!state.project.id) { focusComposer('Voici mon idée de film : '); return; }
      var prompt = (state.shots || []).length || (state.sequences || []).length
        ? 'Développe le scénario existant en proposant des modifications ciblées des plans. Conserve les personnages, les décors et la durée cible. Ne crée pas de doublon et ne génère aucun média.'
        : 'Rédige automatiquement le scénario complet à partir de mon idée validée : séquences, plans filmables, actions, cadrages, durées et dialogues utiles. Utilise create_screenplay pour proposer tout le découpage en une validation. Respecte la durée cible, utilise les références existantes et ne génère aucun média.';
      draftScreenplay.disabled = true;
      window.CinemAIChat.continueWorkflow(prompt).finally(function () { draftScreenplay.disabled = false; });
      return;
    }
    var homePrompt = event.target.closest("[data-home-prompt]");
    if (homePrompt) { focusComposer(homePrompt.getAttribute("data-home-prompt")); return; }
    var contextTab = event.target.closest("[data-context-tab]");
    if (contextTab) {
      var tab = contextTab.getAttribute("data-context-tab");
      if (typeof window.odysseyActivate === "function") window.odysseyActivate(tab);
      if (tab === "export") renderExportWorkspace();
      else if (tab === "script") { selectedStoryboardShotId = null; renderStoryboardWorkspace(); }
      else closeWorkspacePanel();
      setTimeout(function () { unifyConversationSurface(); renderApprovals(activeThread()); }, 0);
      return;
    }
    if (event.target.closest("[data-open-animatic]")) {
      openAnimatic();
      return;
    }
    var animaticGo = event.target.closest("[data-animatic-go]");
    if (animaticGo) {
      stopAnimatic();
      animaticIndex = Number(animaticGo.getAttribute("data-animatic-go")) || 0;
      paintAnimatic();
      return;
    }
    var animaticStep = event.target.closest("[data-animatic-step]");
    if (animaticStep) {
      var frames = animaticFrames();
      stopAnimatic();
      animaticIndex = Math.min(frames.length - 1, Math.max(0, animaticIndex + Number(animaticStep.getAttribute("data-animatic-step"))));
      paintAnimatic();
      return;
    }
    if (event.target.closest("[data-animatic-toggle]")) {
      if (animaticPlaying) {
        stopAnimatic();
      } else {
        var total = animaticFrames();
        if (!total.length) return;
        // Relancer depuis la fin repart du début plutôt que de rester bloqué.
        if (animaticIndex >= total.length - 1) animaticIndex = 0;
        animaticPlaying = true;
        advanceAnimatic();
      }
      paintAnimatic();
      return;
    }
    var openAsset = event.target.closest("[data-open-asset]");
    if (openAsset) {
      activeVariantKey = null;
      activeMediaId = null;
      renderAssetInspector(openAsset.getAttribute("data-open-asset"));
      return;
    }
    if (event.target.closest("[data-close-workspace]")) {
      closeWorkspacePanel();
      return;
    }
    var selectVariant = event.target.closest("[data-select-variant]");
    if (selectVariant) {
      activeVariantKey = selectVariant.getAttribute("data-select-variant");
      activeMediaId = selectVariant.getAttribute("data-media-id") || null;
      renderAssetInspector(selectVariant.getAttribute("data-asset-id"));
      return;
    }
    var selectAssetMedia = event.target.closest("[data-select-asset-media]");
    if (selectAssetMedia) {
      activeMediaId = selectAssetMedia.getAttribute("data-select-asset-media");
      renderAssetInspector(selectAssetMedia.getAttribute("data-asset-id"));
      return;
    }
    var splitPreset = event.target.closest("[data-workspace-split]");
    if (splitPreset) {
      applyWorkspaceSplit(splitPreset.getAttribute("data-workspace-split"));
      return;
    }
    if (event.target.closest("[data-workspace-fullscreen]")) {
      var workspaceConversation = conversationPane();
      if (workspaceConversation) {
        workspaceConversation.classList.toggle("workspace-maximized");
        var fullButton = workspaceConversation.querySelector("[data-workspace-fullscreen]");
        var maximized = workspaceConversation.classList.contains("workspace-maximized");
        if (fullButton) {
          fullButton.setAttribute("aria-pressed", String(maximized));
          fullButton.textContent = maximized ? "Vue partagée" : "Plein écran";
        }
      }
      return;
    }
    var generateVariant = event.target.closest("[data-generate-variant]");
    if (generateVariant) {
      var variantAssetId = generateVariant.getAttribute("data-generate-variant");
      var variantKey = generateVariant.getAttribute("data-variant-key");
      var inspector = generateVariant.closest("[data-asset-inspector]");
      var variantPrompt = inspector && inspector.querySelector("[data-variant-prompt]");
      var variantSize = inspector && inspector.querySelector("[data-variant-size]");
      var variantError = inspector && inspector.querySelector("[data-variant-error]");
      var variantLabel = generateVariant.textContent;
      generateVariant.disabled = true;
      generateVariant.textContent = "Génération en cours…";
      if (variantError) { variantError.hidden = true; variantError.textContent = ""; }
      api("/api/assets/" + encodeURIComponent(variantAssetId) + "/images/generate", {
        method: "POST",
        body: JSON.stringify({
          confirm: "GENERATE_IMAGE",
          variantKey: variantKey,
          imageSize: variantSize ? variantSize.value : "1K",
          prompt: variantPrompt ? variantPrompt.value : ""
        })
      }).then(function (payload) {
        state = payload.manifest;
        activeMediaId = payload.media && payload.media.id || null;
        renderPanels();
      }).catch(function (error) {
        generateVariant.disabled = false;
        generateVariant.textContent = variantLabel;
        if (variantError) { variantError.hidden = false; variantError.textContent = error.message; }
      });
      return;
    }
    var exportOptionButton = event.target.closest("[data-export-key]");
    if (exportOptionButton) {
      exportSettings[exportOptionButton.getAttribute("data-export-key")] = exportOptionButton.getAttribute("data-export-value");
      renderPanels();
      return;
    }
    if (event.target.closest("[data-open-export]")) {
      renderExportWorkspace();
      return;
    }
    var runExport = event.target.closest("[data-run-export], [data-export-separate]");
    if (runExport) {
      var panel = runExport.closest(".export-workspace");
      var nameField = panel && panel.querySelector("[data-export-filename]");
      var result = panel && panel.querySelector("[data-export-result]");
      var separate = runExport.hasAttribute("data-export-separate");
      var videos = (state.media || []).filter(function (item) { return item.kind === "video"; });
      var payload = {
        projectId: state.project && state.project.id,
        projectTitle: state.project && state.project.title,
        createdAt: new Date().toISOString(),
        mode: separate ? "plans_separes" : "film_assemble",
        settings: Object.assign({}, exportSettings),
        fileName: nameField ? nameField.value : "film-cinemai",
        timelineDurationMs: state.timeline && state.timeline.durationMs || 0,
        media: videos.map(function (item) { return { id: item.id, shotId: item.targetId, url: item.url, mimeType: item.mimeType }; })
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      var link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = (payload.fileName || "film-cinemai") + (separate ? "-plans" : "-export") + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 0);
      if (result) {
        result.hidden = false;
        result.innerHTML = '<strong>Configuration préparée.</strong><span>Le manifeste de livraison a été téléchargé. L’assemblage vidéo final reste volontairement séparé du prototype local.</span>';
      }
      return;
    }
    var afterExport = event.target.closest("[data-export-after]");
    if (afterExport) {
      var afterPanel = afterExport.closest(".export-workspace");
      var afterResult = afterPanel && afterPanel.querySelector("[data-export-result]");
      if (afterResult) {
        afterResult.hidden = false;
        afterResult.innerHTML = afterExport.getAttribute("data-export-after") === "link"
          ? '<strong>Lien indisponible en local.</strong><span>Un lien pourra être copié après branchement d’un stockage partagé.</span>'
          : '<strong>Préparez d’abord l’export.</strong><span>Ces actions utiliseront le dernier manifeste de livraison généré.</span>';
      }
      return;
    }
    var focus = event.target.closest("[data-bridge-focus]");
    if (focus) { focusComposer(""); return; }
    var rail = event.target.closest(".rail-item[data-tab]");
    if (rail) setTimeout(function () { unifyConversationSurface(); renderApprovals(activeThread()); }, 0);
    var generateImage = event.target.closest("[data-generate-asset-image]");
    if (generateImage) {
      var assetId = generateImage.getAttribute("data-generate-asset-image");
      var purpose = generateImage.getAttribute("data-image-purpose");
      var originalLabel = generateImage.textContent;
      var card = generateImage.closest("[data-asset-card]");
      var customPrompt = card && card.querySelector("[data-asset-image-prompt]");
      var sizeControl = card && card.querySelector("[data-asset-image-size]");
      var errorNode = card && card.querySelector("[data-asset-image-error]");
      generateImage.disabled = true;
      generateImage.textContent = "Génération en cours…";
      if (errorNode) { errorNode.hidden = true; errorNode.textContent = ""; }
      api("/api/assets/" + encodeURIComponent(assetId) + "/images/generate", {
        method: "POST",
        body: JSON.stringify({
          confirm: "GENERATE_IMAGE",
          purpose: purpose,
          imageSize: sizeControl ? sizeControl.value : "1K",
          prompt: customPrompt ? customPrompt.value : "",
          restart: !!(card && card.querySelector("[data-asset-image-restart]") && card.querySelector("[data-asset-image-restart]").checked)
        })
      }).then(function (payload) {
        state = payload.manifest;
        renderPanels();
      }).catch(function (error) {
        generateImage.disabled = false;
        generateImage.textContent = originalLabel;
        if (errorNode) { errorNode.hidden = false; errorNode.textContent = error.message; }
      });
      return;
    }
    var generateShotVideo = event.target.closest("[data-generate-shot-video]");
    if (generateShotVideo) {
      var videoShotId = generateShotVideo.getAttribute("data-generate-shot-video");
      var videoLabel = generateShotVideo.textContent;
      var videoCard = generateShotVideo.closest("[data-shot-card]");
      var videoError = videoCard && videoCard.querySelector("[data-shot-video-error]");
      generateShotVideo.disabled = true;
      generateShotVideo.textContent = "Animation en cours…";
      if (videoError) { videoError.hidden = true; videoError.textContent = ""; }
      api("/api/shots/" + encodeURIComponent(videoShotId) + "/videos/generate", {
        method: "POST",
        body: JSON.stringify({ confirm: "GENERATE_VIDEO" })
      }).then(function (payload) {
        state = payload.manifest;
        renderPanels();
      }).catch(function (error) {
        generateShotVideo.disabled = false;
        generateShotVideo.textContent = videoLabel;
        if (videoError) { videoError.hidden = false; videoError.textContent = error.message; }
      });
      return;
    }
    var approveMedia = event.target.closest("[data-approve-media]");
    if (approveMedia) {
      var mediaId = approveMedia.getAttribute("data-approve-media");
      var wasApproved = approveMedia.getAttribute("data-approved") === "1";
      var mediaFigure = approveMedia.closest(".asset-media, .shot-media");
      var approvalError = mediaFigure && mediaFigure.querySelector("[data-media-approval-error]");
      var mediaReview = {};
      if (mediaFigure) mediaFigure.querySelectorAll("[data-media-review]").forEach(function (control) {
        mediaReview[control.getAttribute("data-media-review")] = control.checked;
      });
      approveMedia.disabled = true;
      if (approvalError) { approvalError.hidden = true; approvalError.textContent = ""; }
      api("/api/media/" + encodeURIComponent(mediaId) + "/approval", {
        method: "POST",
        body: JSON.stringify({ approved: !wasApproved, review: mediaReview })
      }).then(function (payload) {
        state = payload.manifest;
        renderPanels();
      }).catch(function (error) {
        approveMedia.disabled = false;
        approveMedia.title = error.message;
        if (approvalError) { approvalError.hidden = false; approvalError.textContent = error.message; }
      });
      return;
    }
    var prepareCorrection = event.target.closest("[data-review-correction]");
    if (prepareCorrection) {
      var reviewFigure = prepareCorrection.closest(".asset-media");
      var reviewCard = prepareCorrection.closest("[data-asset-card]");
      var promptField = reviewCard && reviewCard.querySelector("[data-asset-image-prompt]");
      var missing = [];
      if (reviewFigure) reviewFigure.querySelectorAll("[data-media-review]").forEach(function (control) {
        if (!control.checked) missing.push(control.parentElement.textContent.trim().toLowerCase());
      });
      if (promptField) {
        promptField.value = missing.length
          ? "Corriger uniquement les éléments manquants : " + missing.join(", ") + ". Conserver strictement l’identité, le costume, les couleurs et les accessoires de cette version."
          : "Créer une variante ciblée en conservant strictement l’identité validée.";
        promptField.focus();
      }
      return;
    }
    var generateShotImage = event.target.closest("[data-generate-shot-image]");
    if (generateShotImage) {
      var shotId = generateShotImage.getAttribute("data-generate-shot-image");
      var shotLabel = generateShotImage.textContent;
      var shotCardNode = generateShotImage.closest("[data-shot-card]");
      var shotPrompt = shotCardNode && shotCardNode.querySelector("[data-shot-image-prompt]");
      var shotSize = shotCardNode && shotCardNode.querySelector("[data-shot-image-size]");
      var shotError = shotCardNode && shotCardNode.querySelector("[data-shot-image-error]");
      generateShotImage.disabled = true;
      generateShotImage.textContent = "Génération en cours…";
      if (shotError) { shotError.hidden = true; shotError.textContent = ""; }
      api("/api/shots/" + encodeURIComponent(shotId) + "/images/generate", {
        method: "POST",
        body: JSON.stringify({
          confirm: "GENERATE_IMAGE",
          imageSize: shotSize ? shotSize.value : "1K",
          prompt: shotPrompt ? shotPrompt.value : ""
        })
      }).then(function (payload) {
        state = payload.manifest;
        renderPanels();
      }).catch(function (error) {
        generateShotImage.disabled = false;
        generateShotImage.textContent = shotLabel;
        if (shotError) { shotError.hidden = false; shotError.textContent = error.message; }
      });
      return;
    }
    var choice = event.target.closest("[data-choice]");
    if (choice) {
      var card = choice.closest("[data-approval-card]");
      if (card) enqueueDecision(card, choice.getAttribute("data-choice"));
      return;
    }
    if (event.target.closest("[data-choice-new]")) {
      focusComposer("Ces propositions ne me conviennent pas. Donne-moi une autre direction, en deux choix maximum.");
    }
  });

  document.addEventListener("pointerdown", function (event) {
    var splitter = event.target.closest("[data-workspace-resize]");
    if (!splitter || event.button !== 0) return;
    var conversation = conversationPane();
    if (!conversation || conversation.classList.contains("workspace-maximized")) return;
    event.preventDefault();
    document.body.classList.add("workspace-resizing");
    var bounds = conversation.getBoundingClientRect();
    var move = function (moveEvent) {
      applyWorkspaceSplit(((moveEvent.clientY - bounds.top) / bounds.height) * 100);
    };
    var stop = function () {
      document.body.classList.remove("workspace-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  });

  document.addEventListener("keydown", function (event) {
    if (!event.target.closest || !event.target.closest("[data-workspace-resize]")) return;
    if (event.key === "ArrowUp") { event.preventDefault(); applyWorkspaceSplit(workspaceSplit + 2); }
    if (event.key === "ArrowDown") { event.preventDefault(); applyWorkspaceSplit(workspaceSplit - 2); }
  });

  document.addEventListener("change", function (event) {
    if (event.target.matches && event.target.matches("[data-export-toggle]")) {
      exportSettings[event.target.getAttribute("data-export-toggle")] = event.target.checked;
      return;
    }
    if (!event.target.matches || !event.target.matches("[data-asset-image-size]")) return;
    var card = event.target.closest("[data-asset-card]");
    var cost = card && card.querySelector("[data-image-cost]");
    if (cost) cost.textContent = imageCostLabel(event.target.value) + " · le clic confirme l’appel.";
  });

  document.addEventListener("input", function (event) {
    if (event.target.matches && event.target.matches("[data-export-filename]")) {
      exportSettings.fileName = event.target.value;
    }
  });

  function renderContinuePrompt(thread) {
    var target = thread && !thread.classList.contains("off") ? thread : activeThread();
    if (!target || target.querySelector("[data-continue-workflow]")) return;
    var wrapper = document.createElement("div");
    wrapper.className = "msg bridge-approval-stack";
    wrapper.innerHTML = '<span class="av av-ai">✦</span><div class="fx col gap6">' +
      '<p class="prose">Pas de nouvelle proposition automatique pour l’instant, afin d’éviter de répéter la même chose en boucle. ' +
      'Cliquez pour redemander explicitement la suite, ou écrivez un message pour orienter le copilote.</p>' +
      '<button type="button" class="choice-action primary" data-continue-workflow>Redemander la suite</button></div>';
    target.appendChild(wrapper);
    target.scrollTop = target.scrollHeight;
  }

  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-continue-workflow]");
    if (!button || !window.CinemAIChat) return;
    button.disabled = true;
    button.textContent = "Reprise en cours…";
    autoContinueStreak = 0;
    window.CinemAIChat.continueWorkflow(
      "L’utilisateur redemande explicitement la suite du workflow. Continue à partir du manifeste actuel sans répéter une proposition déjà écartée."
    ).finally(function () {
      var wrapper = button.closest(".bridge-approval-stack");
      if (wrapper) wrapper.remove();
    });
  });

  window.CinemAIBridge = {
    handleResponse: function (payload, tab, thread) {
      if (payload.manifest) state = payload.manifest;
      if (state) {
        renderPanels();
        unifyConversationSurface();
        renderApprovals(thread);
      }
    },
    resetAutoContinue: function () {
      autoContinueStreak = 0;
    }
  };

  function hookTabActivation() {
    if (typeof window.odysseyActivate !== "function" || window.odysseyActivate.cinemaiWrapped) return;
    var original = window.odysseyActivate;
    var wrapped = function (tab) {
      original(tab);
      refreshContextLabel();
    };
    wrapped.cinemaiWrapped = true;
    window.odysseyActivate = wrapped;
  }

  function start() {
    var app = document.querySelector(".app");
    if (app) {
      app.classList.add("project-context-layout");
      app.classList.remove("pane-collapsed");
    }
    var rail = document.querySelector(".rail");
    if (rail) rail.setAttribute("aria-hidden", "true");
    workspacePanel();
    hookTabActivation();
    document.addEventListener("click", function () { setTimeout(refreshContextLabel, 0); }, true);
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
