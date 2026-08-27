(function () {
  "use strict";

  var state = null;
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

  async function api(path, options) {
    var response = await fetch(path, Object.assign({}, options || {}, {
      headers: Object.assign({ "Content-Type": "application/json" }, options && options.headers || {})
    }));
    var payload = await response.json().catch(function () { return { error: "Réponse illisible." }; });
    if (!response.ok) throw new Error(payload.error || "La demande a échoué.");
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

  function rows(items, renderer) {
    return '<div class="bridge-list">' + items.map(renderer).join("") + '</div>';
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

  function renderPanels() {
    if (!state) return;
    var project = state.project || {};
    var projectPane = document.querySelector('.panes-host > [data-tab="projet"]');
    var scriptPane = document.querySelector('.panes-host > [data-tab="script"]');
    var productionPane = document.querySelector('.panes-host > [data-tab="production"]');
    var charactersPane = document.querySelector('.panes-host > [data-tab="personnages"]');
    var locationsPane = document.querySelector('.panes-host > [data-tab="decors"]');
    var exportPane = document.querySelector('.panes-host > [data-tab="export"]');

    if (projectPane) {
      var projectBody = project.id
        ? '<section><div class="sec-head"><span class="sec-title">Intention</span></div><div class="card"><p class="prose">' + escapeHtml(project.brief || "Brief à préciser") + '</p></div></section>' +
          '<section><div class="sec-head"><span class="sec-title">Paramètres vidéo</span></div><div class="grid2">' +
          '<div class="card"><span class="field-label">Format</span><div class="bridge-metric">' + escapeHtml(project.aspectRatio || "16:9") + '</div></div>' +
          '<div class="card"><span class="field-label">Durée cible</span><div class="bridge-metric">' + escapeHtml(project.durationSeconds || 8) + ' s</div></div></div></section>'
        : emptyState("Définissez votre première intention", "Deux propositions rapides suffisent pour cadrer le format, la durée et la direction générale.", "Décrire la vidéo");
      projectPane.innerHTML = pane(project.title || "Nouveau projet", "Projet", projectBody, project.id ? "Manifeste actif · révision " + state.revision : "Aucune donnée préchargée");
    }

    if (scriptPane) {
      var sequences = state.sequences || [];
      var shots = state.shots || [];
      var scriptBody = !sequences.length && !shots.length ? emptyState("Aucune séquence", "Le découpage peut rester minimal pour une vidéo simple : quelques poses ou un seul plan.", "Préparer le storyboard") :
        '<section><div class="sec-head"><span class="sec-title">Séquences</span></div>' + rows(sequences, function (item) {
          return '<div class="bridge-row"><div class="bridge-row-main"><strong>' + escapeHtml(item.title || item.id) + '</strong><small>' + escapeHtml(item.summary || "Sans résumé") + '</small></div></div>';
        }) + '</section><section><div class="sec-head"><span class="sec-title">Plans</span></div>' + rows(shots, function (item) {
          return '<div class="bridge-row"><div class="bridge-row-main"><strong>' + escapeHtml(item.title || "Plan") + '</strong><small>' + escapeHtml(item.description) + ' · ' + Math.round((item.durationMs || 0) / 100) / 10 + ' s</small></div><span class="pill">v' + escapeHtml(item.version) + '</span></div>';
        }) + '</section>';
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
      var body = assets.length ? rows(assets, function (asset) {
        return '<div class="bridge-row"><div class="bridge-row-main"><strong>' + escapeHtml(asset.name) + '</strong><small>' + escapeHtml(asset.description || "Description à préciser") + '</small></div><span class="pill">ID stable</span></div>';
      }) : emptyState("Aucun " + subtitle.toLowerCase(), "Les références seront créées uniquement si le projet en a besoin.", "Définir " + (type === "character" ? "un personnage" : "un décor"));
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

  function operationPresentation(approval) {
    var operation = approval.operation || {};
    var args = operation.args || {};
    var presentations = {
      set_project: ["Cadrage du projet", args.title || "Définir le projet", args.brief || "Format, durée et intention générale."],
      create_asset: [args.assetType === "location" ? "Créer un décor" : "Créer un asset", args.name || "Nouvelle référence", args.description || "Référence stable pour la continuité."],
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
    if (operation.name === "set_project") {
      return '<div class="choice-fields">' +
        '<div class="choice-field"><label>Format</label><select data-choice-field="aspectRatio">' + option("16:9", "16:9 · paysage", args.aspectRatio || "16:9") + option("9:16", "9:16 · vertical", args.aspectRatio) + option("1:1", "1:1 · carré", args.aspectRatio) + '</select></div>' +
        '<div class="choice-field"><label>Durée cible</label><select data-choice-field="durationSeconds">' + [4, 6, 8, 15, 30].map(function (seconds) { return option(seconds, seconds + " secondes", args.durationSeconds || 8); }).join("") + '</select></div></div>';
    }
    if (operation.name === "create_shot") {
      return '<div class="choice-fields"><div class="choice-field"><label>Durée du plan</label><select data-choice-field="durationMs">' + [1000, 2000, 4000, 6000, 8000].map(function (ms) { return option(ms, ms / 1000 + " seconde" + (ms > 1000 ? "s" : ""), args.durationMs || 4000); }).join("") + '</select></div>' +
        '<div class="choice-field"><label>Stratégie</label><select data-choice-field="strategy">' + option("image", "Image / pose", args.strategy || "image") + option("image_sequence", "Séquence d’images", args.strategy) + option("first_last_video", "Première → dernière image", args.strategy) + option("micro_video", "Vidéo courte", args.strategy) + '</select></div></div>';
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

  function renderApprovals(thread) {
    if (!state) return;
    var target = thread || activeThread();
    if (!target) return;
    var existing = target.querySelector(".bridge-approval-stack");
    if (existing) existing.remove();
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
    } catch (error) {
      card.style.opacity = "1";
      card.style.pointerEvents = "auto";
      var errorNode = card.querySelector(".choice-error");
      if (!errorNode) {
        errorNode = document.createElement("div");
        errorNode.className = "choice-error hint";
        card.appendChild(errorNode);
      }
      errorNode.textContent = error.message;
    }
  }

  function clearStaticExamples() {
    document.querySelectorAll("[data-thread]").forEach(function (thread) { thread.innerHTML = ""; });
  }

  async function load() {
    clearStaticExamples();
    try {
      var payload = await api("/api/workspace");
      state = payload.manifest;
      renderPanels();
      renderApprovals(activeThread());
    } catch (error) {
      var target = activeThread();
      if (target) target.innerHTML = '<div class="msg"><span class="av av-ai">!</span><p class="prose">' + escapeHtml(error.message) + '</p></div>';
    } finally {
      document.documentElement.classList.add("bridge-ready");
    }
  }

  document.addEventListener("click", function (event) {
    var focus = event.target.closest("[data-bridge-focus]");
    if (focus) { focusComposer(""); return; }
    var rail = event.target.closest(".rail-item[data-tab]");
    if (rail) setTimeout(function () { renderApprovals(activeThread()); }, 0);
    var choice = event.target.closest("[data-choice]");
    if (choice) {
      var card = choice.closest("[data-approval-card]");
      if (card) decide(card, choice.getAttribute("data-choice"));
      return;
    }
    if (event.target.closest("[data-choice-new]")) {
      focusComposer("Ces propositions ne me conviennent pas. Donne-moi une autre direction, en deux choix maximum.");
    }
  });

  window.CinemAIBridge = {
    handleResponse: function (payload, tab, thread) {
      if (payload.manifest) state = payload.manifest;
      if (state) {
        renderPanels();
        renderApprovals(thread);
      }
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load, { once: true });
  else load();
})();
