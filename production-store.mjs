import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { cleanNarrativeStates, cleanNarrativeTransition } from "./narrative-continuity.mjs";

export const VISUAL_STRATEGIES = new Set([
  "image",
  "first_last_video",
  "micro_video",
  "image_sequence",
  "interpolation",
]);

export const AUDIO_TRACKS = new Set([
  "dialogue",
  "voiceover",
  "sfx",
  "ambience",
  "music",
]);

export const OPERATION_NAMES = new Set([
  "set_project",
  "create_asset",
  "update_asset",
  "create_sequence",
  "create_shot",
  "update_shot",
  "create_screenplay",
  "add_timeline_clip",
  "add_audio_clip",
  "duplicate_shot",
  "split_shot",
  "delete_shot",
  "restore_shot",
  "reorder_shots",
  "queue_generation",
]);

// Une suppression doit être récupérable : un plan supprimé part à la corbeille
// avec sa position, pas dans le vide.
const TRASH_LIMIT = 20;
const STORYBOARD_OPERATIONS = new Set(["split_shot", "duplicate_shot", "delete_shot", "restore_shot", "reorder_shots"]);

// Un plan retiré laisse derrière lui des générations en attente qui ne visent
// plus rien : on les annule plutôt que de les laisser encombrer la file.
function cancelOrphanJobs(manifest) {
  for (const job of manifest.queue || []) {
    if (job.status !== "pending" || job.targetType !== "shot") continue;
    if (!manifest.shots.some((shot) => shot.id === job.targetId)) {
      job.status = "cancelled";
      job.error = "Le plan visé a été supprimé ou remplacé.";
    }
  }
}

const JOB_TRANSITIONS = {
  pending: new Set(["running", "cancelled"]),
  running: new Set(["review", "succeeded", "failed", "cancelled"]),
  review: new Set(["succeeded", "failed", "running", "cancelled"]),
  succeeded: new Set([]),
  failed: new Set(["pending"]),
  cancelled: new Set(["pending"]),
};

const cleanText = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const positiveInteger = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

export const SHOT_CONTINUITIES = new Set(["cut", "continuous"]);

// Une réplique doit être arrêtée avant la génération vidéo : Veo produit la
// synchronisation labiale en même temps que l'image, elle n'est pas ajoutable après.
function cleanDialogue(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const line = cleanText(entry.line, 600);
      if (!line) return null;
      return { speaker: cleanText(entry.speaker, 120), line };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

export function createEmptyManifest(now = () => new Date().toISOString()) {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: now(),
    project: {
      id: null,
      title: "",
      brief: "",
      premise: "",
      genre: "",
      visualStyle: "",
      narrativeOutline: "",
      aspectRatio: "16:9",
      fps: 24,
      durationSeconds: 8,
      status: "idea",
    },
    assets: [],
    media: [],
    sequences: [],
    shots: [],
    timeline: {
      durationMs: 0,
      tracks: [
        { id: "visual-main", kind: "visual", label: "Images et vidéo", clips: [] },
        { id: "audio-dialogue", kind: "dialogue", label: "Dialogues", clips: [] },
        { id: "audio-voiceover", kind: "voiceover", label: "Voix off", clips: [] },
        { id: "audio-sfx", kind: "sfx", label: "Bruitages", clips: [] },
        { id: "audio-ambience", kind: "ambience", label: "Ambiances", clips: [] },
        { id: "audio-music", kind: "music", label: "Musique", clips: [] },
      ],
    },
    queue: [],
    approvals: [],
    activity: [],
  };
}

function normalizeManifest(value, now) {
  const manifest = value && typeof value === "object" ? value : createEmptyManifest(now);
  if (!Array.isArray(manifest.media)) manifest.media = [];
  if (!Array.isArray(manifest.assets)) manifest.assets = [];
  for (const asset of manifest.assets) {
    if (!Array.isArray(asset.references)) asset.references = [];
    if (!Array.isArray(asset.states)) asset.states = [];
    if (!Number.isInteger(asset.version) || asset.version < 1) asset.version = 1;
    if (typeof asset.updatedAt !== "string") asset.updatedAt = asset.createdAt || now();
  }
  if (!Array.isArray(manifest.shots)) manifest.shots = [];
  if (!Array.isArray(manifest.trash)) manifest.trash = [];
  if (manifest.storyboardLock === undefined) manifest.storyboardLock = null;
  // Les manifestes enregistrés avant ce contrôle peuvent contenir des jobs
  // visant des plans disparus : ils se nettoient au chargement.
  if (Array.isArray(manifest.queue)) cancelOrphanJobs(manifest);
  if (manifest.shots.length && manifest.timeline?.tracks) {
    syncVisualTrack(manifest);
    recalculateTimeline(manifest);
  }
  for (const shot of manifest.shots) {
    if (shot.narrativeStates === undefined) shot.narrativeStates = [];
    if (shot.narrativeTransition === undefined) shot.narrativeTransition = "unspecified";
    if (!Array.isArray(shot.history)) shot.history = [];
    if (!Array.isArray(shot.dialogue)) shot.dialogue = [];
    if (!SHOT_CONTINUITIES.has(shot.continuity)) shot.continuity = "cut";
  }
  if (manifest.project && manifest.project.id && (!manifest.project.status || manifest.project.status === "draft")) {
    manifest.project.status = "structured";
  }
  for (const field of ["premise", "genre", "visualStyle", "narrativeOutline"]) {
    if (typeof manifest.project?.[field] !== "string") manifest.project[field] = "";
  }
  return manifest;
}

function clone(value) {
  return structuredClone(value);
}

const GENERATED_ID_FIELD_PATTERN = /Id$/;

function collectKnownIds(manifest) {
  const known = new Set();
  const collections = [manifest.assets, manifest.sequences, manifest.shots, manifest.media];
  for (const collection of collections || []) {
    for (const item of collection || []) {
      if (item && typeof item.id === "string") known.add(item.id);
    }
  }
  return known;
}

// Deux propositions décrivant la même intention (même titre, même emplacement, mêmes
// paramètres) doivent être reconnues comme un doublon même si le modèle a généré un
// identifiant neuf à chaque appel pour l'entité qu'il propose de créer. On ne neutralise
// donc, dans la clé de comparaison, que les champs `...Id` dont la valeur ne correspond à
// aucune entité déjà connue du manifeste : un identifiant qui référence un asset ou un plan
// existant reste, lui, déterminant (éditer l'asset A n'est jamais un doublon d'éditer l'asset B).
function stableArgsKey(name, args, knownIds) {
  const normalize = (value, keyName) => {
    if (Array.isArray(value)) return value.map((item) => normalize(item, keyName));
    if (value && typeof value === "object") {
      return Object.keys(value).sort().reduce((acc, key) => {
        acc[key] = normalize(value[key], key);
        return acc;
      }, {});
    }
    if (keyName && GENERATED_ID_FIELD_PATTERN.test(keyName) && typeof value === "string" && !knownIds.has(value)) {
      return "::nouvelle-entite::";
    }
    return value;
  };
  return `${name}::${JSON.stringify(normalize(args || {}, null))}`;
}

// La piste visuelle est DÉRIVÉE des plans, elle n'est pas une seconde source de
// vérité. Sans cela deux ordres coexistent : un scénario produit six plans mais
// une timeline vide, et l'étape Production croit le film inexistant. En cas de
// divergence, ce sont les plans qui font foi.
function syncVisualTrack(manifest) {
  const track = manifest.timeline?.tracks?.find((item) => item.kind === "visual");
  if (!track) return;
  let cursor = 0;
  track.clips = (manifest.shots || []).map((shot) => {
    const durationMs = shot.durationMs || 0;
    const clip = {
      id: `clip_${shot.id}`,
      shotId: shot.id,
      title: shot.title || "Plan",
      strategy: shot.strategy || "image",
      startMs: cursor,
      durationMs,
      status: "planned",
    };
    cursor += durationMs;
    return clip;
  });
}

function recalculateTimeline(manifest) {
  manifest.timeline.durationMs = manifest.timeline.tracks.reduce((max, track) => (
    track.clips.reduce((trackMax, clip) => Math.max(trackMax, clip.startMs + clip.durationMs), max)
  ), 0);
}

function requireProject(manifest) {
  if (!manifest.project.id) fail("Créez d'abord le projet.", 409);
  if (manifest.project.status !== "structured") {
    fail("Validez d'abord la présentation structurée du projet.", 409);
  }
}

function requireShot(manifest, shotId) {
  const shot = manifest.shots.find((item) => item.id === shotId);
  if (!shot) fail("Le plan demandé est introuvable.", 404);
  return shot;
}

function requireSequence(manifest, sequenceId) {
  const sequence = manifest.sequences.find((item) => item.id === sequenceId);
  if (!sequence) fail("La séquence demandée est introuvable.", 404);
  return sequence;
}

function applyOperation(manifest, operation, now) {
  const { name, args } = operation;
  if (!OPERATION_NAMES.has(name)) fail("Opération inconnue.");

  if (name === "set_project") {
    const title = cleanText(args.title, 120);
    const brief = cleanText(args.brief, 4_000);
    const premise = cleanText(args.premise, 2_000);
    const genre = cleanText(args.genre, 240);
    const visualStyle = cleanText(args.visualStyle, 2_000);
    const narrativeOutline = cleanText(args.narrativeOutline, 4_000);
    if (!title && !brief && !premise) fail("Le projet doit recevoir un titre, une prémisse ou un brief.");
    if (!manifest.project.id) manifest.project.id = `project_${randomUUID()}`;
    if (title) manifest.project.title = title;
    if (brief) manifest.project.brief = brief;
    if (premise) manifest.project.premise = premise;
    if (genre) manifest.project.genre = genre;
    if (visualStyle) manifest.project.visualStyle = visualStyle;
    if (narrativeOutline) manifest.project.narrativeOutline = narrativeOutline;
    if (args.aspectRatio) manifest.project.aspectRatio = cleanText(args.aspectRatio, 12);
    if (args.fps !== undefined) manifest.project.fps = positiveInteger(args.fps, manifest.project.fps, 1, 120);
    if (args.durationSeconds !== undefined) {
      manifest.project.durationSeconds = positiveInteger(args.durationSeconds, manifest.project.durationSeconds, 1, 3_600);
    }
    manifest.project.status = "structured";
    return { entityType: "project", entityId: manifest.project.id, tab: "projet" };
  }

  requireProject(manifest);

  if (name === "create_asset") {
    const assetType = cleanText(args.assetType, 24);
    const allowed = new Set(["character", "location", "prop", "style"]);
    const assetName = cleanText(args.name, 120);
    if (!allowed.has(assetType) || !assetName) fail("Le type et le nom de l'asset sont requis.");
    const asset = {
      id: `asset_${randomUUID()}`,
      type: assetType,
      name: assetName,
      description: cleanText(args.description, 2_000),
      states: [],
      references: [],
      version: 1,
      createdAt: now(),
      updatedAt: now(),
    };
    manifest.assets.push(asset);
    return { entityType: "asset", entityId: asset.id, tab: assetType === "location" ? "decors" : "personnages" };
  }

  if (name === "update_asset") {
    const assetId = cleanText(args.assetId, 128);
    const asset = manifest.assets.find((item) => item.id === assetId);
    if (!asset) fail("L'asset demandé est introuvable.", 404);
    const nextName = args.name === undefined ? asset.name : cleanText(args.name, 120);
    const nextDescription = args.description === undefined ? asset.description : cleanText(args.description, 2_000);
    if (!nextName) fail("Le nom de l'asset ne peut pas être vide.");
    if (nextName === asset.name && nextDescription === asset.description) {
      fail("La proposition ne contient aucune modification de l'asset.");
    }
    asset.name = nextName;
    asset.description = nextDescription;
    asset.version = (Number.isInteger(asset.version) ? asset.version : 1) + 1;
    asset.updatedAt = now();
    return { entityType: "asset", entityId: asset.id, tab: asset.type === "location" ? "decors" : "personnages" };
  }

  if (name === "create_screenplay") {
    // Remplacer un découpage existant efface le travail en cours : le modèle ne
    // peut pas le décider seul, c'est au réalisateur de l'autoriser à la
    // validation. Les plans remplacés partent en corbeille, pas au néant.
    if (manifest.shots.length || manifest.sequences.length) {
      if (args.replace !== true) {
        fail("Un découpage existe déjà. Validez en autorisant le remplacement, ou modifiez les plans existants.", 409);
      }
      if (!Array.isArray(manifest.trash)) manifest.trash = [];
      manifest.shots.forEach((shot, index) => {
        manifest.trash.push({ shot: clone(shot), index, deletedAt: now() });
      });
      manifest.trash = manifest.trash.slice(-TRASH_LIMIT);
      manifest.shots = [];
      manifest.sequences = [];
    }
    if (!Array.isArray(args.sequences) || !args.sequences.length || args.sequences.length > 12) fail("Le scénario doit contenir de 1 à 12 séquences.");
    let count = 0;
    for (const sequence of args.sequences) {
      if (!Array.isArray(sequence?.shots) || !sequence.shots.length) fail("Chaque séquence doit contenir des plans.");
      count += sequence.shots.length;
      if (count > 24) fail("Le scénario est limité à 24 plans par proposition.");
      const created = applyOperation(manifest, { name: "create_sequence", args: sequence }, now);
      for (const shot of sequence.shots) applyOperation(manifest, { name: "create_shot", args: { ...shot, sequenceId: created.entityId } }, now);
    }
    return { entityType: "screenplay", entityId: manifest.project.id, tab: "script" };
  }

  if (name === "create_sequence") {
    const title = cleanText(args.title, 120);
    if (!title) fail("Le titre de la séquence est requis.");
    const sequence = {
      id: `sequence_${randomUUID()}`,
      title,
      summary: cleanText(args.summary, 2_000),
      order: manifest.sequences.length,
      createdAt: now(),
    };
    manifest.sequences.push(sequence);
    return { entityType: "sequence", entityId: sequence.id, tab: "script" };
  }

  if (name === "create_shot") {
    const sequenceId = cleanText(args.sequenceId, 128);
    if (sequenceId) requireSequence(manifest, sequenceId);
    const description = cleanText(args.description, 2_000);
    if (!description) fail("La description du plan est requise.");
    const durationMs = positiveInteger(args.durationMs, 3_000, 250, 120_000);
    const strategy = VISUAL_STRATEGIES.has(args.strategy) ? args.strategy : "image";
    const shot = {
      id: `shot_${randomUUID()}`,
      sequenceId: sequenceId || null,
      title: cleanText(args.title, 120),
      description,
      durationMs,
      strategy,
      assetIds: Array.isArray(args.assetIds)
        ? args.assetIds.filter((id) => manifest.assets.some((asset) => asset.id === id)).slice(0, 20)
        : [],
      dialogue: cleanDialogue(args.dialogue),
      // "continuous" impose que la première frame de ce plan soit la dernière du précédent.
      continuity: SHOT_CONTINUITIES.has(args.continuity) ? args.continuity : "cut",
      version: 1,
      status: "draft",
      history: [],
      createdAt: now(),
      updatedAt: now(),
    };
    shot.narrativeStates = cleanNarrativeStates(args.narrativeStates, shot.assetIds);
    shot.narrativeTransition = cleanNarrativeTransition(args.narrativeTransition);
    manifest.shots.push(shot);
    return { entityType: "shot", entityId: shot.id, tab: "production" };
  }

  if (name === "update_shot") {
    const shot = requireShot(manifest, cleanText(args.shotId, 128));
    if (args.baseVersion !== undefined && args.baseVersion !== shot.version) fail("Ce plan a été modifié ailleurs. Rechargez-le avant d’enregistrer.", 409);
    const patch = args.patch && typeof args.patch === "object" && !Array.isArray(args.patch) ? args.patch : {};
    const { history, ...previous } = shot;
    shot.history = [...(history || []), clone(previous)].slice(-50);
    if (patch.title !== undefined) shot.title = cleanText(patch.title, 120);
    if (patch.description !== undefined) {
      const description = cleanText(patch.description, 2_000);
      if (!description) fail("La description du plan ne peut pas être vide.");
      shot.description = description;
    }
    if (patch.durationMs !== undefined) shot.durationMs = positiveInteger(patch.durationMs, shot.durationMs, 250, 120_000);
    if (patch.strategy !== undefined) {
      if (!VISUAL_STRATEGIES.has(patch.strategy)) fail("La stratégie visuelle est inconnue.");
      shot.strategy = patch.strategy;
    }
    if (patch.dialogue !== undefined) shot.dialogue = cleanDialogue(patch.dialogue);
    if (patch.assetIds !== undefined) {
      if (!Array.isArray(patch.assetIds) || patch.assetIds.some(id => !manifest.assets.some(asset => asset.id === id))) fail("Une référence sélectionnée est introuvable.");
      shot.assetIds = [...new Set(patch.assetIds)].slice(0, 20);
    }
    if (patch.continuity !== undefined) {
      if (!SHOT_CONTINUITIES.has(patch.continuity)) fail("La continuité doit valoir cut ou continuous.");
      shot.continuity = patch.continuity;
    }
    if (patch.narrativeStates !== undefined || patch.assetIds !== undefined) {
      shot.narrativeStates = cleanNarrativeStates(patch.narrativeStates !== undefined ? patch.narrativeStates : shot.narrativeStates, shot.assetIds);
    }
    if (patch.narrativeTransition !== undefined) shot.narrativeTransition = cleanNarrativeTransition(patch.narrativeTransition);
    shot.version += 1;
    shot.updatedAt = now();
    return { entityType: "shot", entityId: shot.id, tab: "production" };
  }

  if (name === "split_shot") {
    const source = requireShot(manifest, cleanText(args.shotId, 128));
    if (args.baseVersion !== source.version) fail("Ce plan a changé. Rechargez-le avant de le découper.", 409);
    const count = args.count;
    if (!Number.isInteger(count) || count < 2 || count > 4 || source.durationMs < count * 250) fail("Choisissez 2 à 4 vignettes d’au moins 250 ms.");
    const index = manifest.shots.indexOf(source);
    const original = clone(source);
    const duration = Math.floor(original.durationMs / count);
    applyOperation(manifest, { name: "update_shot", args: { shotId: source.id, patch: {
      title: `${original.title} · 1/${count}`, durationMs: duration,
      narrativeStates: [],
    } } }, now);
    const added = Array.from({ length: count - 1 }, (_, i) => ({
      ...clone(original), id: `shot_${randomUUID()}`, title: cleanText(`${original.title} · ${i + 2}/${count}`, 120),
      description: original.description, durationMs: i === count - 2 ? original.durationMs - duration * (count - 1) : duration,
      dialogue: [], narrativeStates: [], narrativeTransition: "unspecified", continuity: "continuous",
      approvedMediaId: null, status: "draft", version: 1, history: [], createdAt: now(), updatedAt: now(),
    }));
    manifest.shots.splice(index + 1, 0, ...added);
    return { entityType: "shot", entityId: source.id, tab: "script" };
  }

  if (name === "duplicate_shot") {
    const source = requireShot(manifest, cleanText(args.shotId, 128));
    const index = manifest.shots.findIndex((item) => item.id === source.id);
    const copy = {
      ...clone(source),
      id: `shot_${randomUUID()}`,
      title: cleanText(`${source.title || "Plan"} (copie)`, 120),
      version: 1,
      history: [],
      // Les images appartiennent au plan d'origine : la copie repart sans
      // média, sinon deux plans partageraient la même frame validée.
      createdAt: now(),
      updatedAt: now(),
    };
    manifest.shots.splice(index + 1, 0, copy);
    return { entityType: "shot", entityId: copy.id, tab: "script" };
  }

  if (name === "delete_shot") {
    const shot = requireShot(manifest, cleanText(args.shotId, 128));
    const index = manifest.shots.findIndex((item) => item.id === shot.id);
    manifest.shots.splice(index, 1);
    if (!Array.isArray(manifest.trash)) manifest.trash = [];
    manifest.trash.push({ shot: clone(shot), index, deletedAt: now() });
    if (manifest.trash.length > TRASH_LIMIT) manifest.trash.shift();
    return { entityType: "shot", entityId: shot.id, tab: "script" };
  }

  if (name === "restore_shot") {
    const shotId = cleanText(args.shotId, 128);
    if (!Array.isArray(manifest.trash)) manifest.trash = [];
    const position = manifest.trash.findIndex((entry) => entry.shot?.id === shotId);
    if (position < 0) fail("Ce plan n'est pas dans la corbeille.", 404);
    const [entry] = manifest.trash.splice(position, 1);
    // La position d'origine peut ne plus exister : on borne au lieu d'échouer.
    manifest.shots.splice(Math.min(entry.index, manifest.shots.length), 0, entry.shot);
    return { entityType: "shot", entityId: entry.shot.id, tab: "script" };
  }

  if (name === "reorder_shots") {
    const order = Array.isArray(args.order) ? args.order.map((id) => cleanText(id, 128)) : [];
    if (order.length !== manifest.shots.length) fail("L'ordre doit contenir exactement tous les plans.");
    const known = new Set(manifest.shots.map((shot) => shot.id));
    if (new Set(order).size !== order.length || order.some((id) => !known.has(id))) {
      fail("L'ordre doit être une permutation des plans existants.");
    }
    manifest.shots = order.map((id) => manifest.shots.find((shot) => shot.id === id));
    return { entityType: "screenplay", entityId: manifest.project.id, tab: "script" };
  }

  if (name === "add_timeline_clip") {
    // La piste visuelle dérive des plans : accepter un clip manuel créerait un
    // second ordre, aussitôt écrasé. Mieux vaut refuser clairement.
    fail("La piste visuelle est dérivée des plans. Modifiez la durée ou l'ordre du plan concerné.", 409);
  }
  if (name === "__add_timeline_clip_desactive__") {
    const shot = requireShot(manifest, cleanText(args.shotId, 128));
    const strategy = VISUAL_STRATEGIES.has(args.strategy) ? args.strategy : shot.strategy;
    const clip = {
      id: `clip_${randomUUID()}`,
      shotId: shot.id,
      title: cleanText(args.title, 120) || shot.title || "Plan",
      strategy,
      startMs: positiveInteger(args.startMs, manifest.timeline.durationMs, 0, 86_400_000),
      durationMs: positiveInteger(args.durationMs, shot.durationMs, 250, 120_000),
      status: "planned",
    };
    manifest.timeline.tracks.find((track) => track.kind === "visual").clips.push(clip);
    recalculateTimeline(manifest);
    return { entityType: "clip", entityId: clip.id, tab: "production" };
  }

  if (name === "add_audio_clip") {
    const trackKind = cleanText(args.trackKind, 24);
    if (!AUDIO_TRACKS.has(trackKind)) fail("La piste audio est inconnue.");
    const title = cleanText(args.title, 120);
    if (!title) fail("Le nom du clip audio est requis.");
    const clip = {
      id: `clip_${randomUUID()}`,
      shotId: args.shotId ? requireShot(manifest, cleanText(args.shotId, 128)).id : null,
      title,
      startMs: positiveInteger(args.startMs, 0, 0, 86_400_000),
      durationMs: positiveInteger(args.durationMs, 1_000, 100, 600_000),
      status: "planned",
    };
    manifest.timeline.tracks.find((track) => track.kind === trackKind).clips.push(clip);
    recalculateTimeline(manifest);
    return { entityType: "clip", entityId: clip.id, tab: "production" };
  }

  if (name === "queue_generation") {
    const targetType = cleanText(args.targetType, 24);
    const targetId = cleanText(args.targetId, 128);
    if (targetType === "shot") requireShot(manifest, targetId);
    else if (targetType === "asset") {
      if (!manifest.assets.some((asset) => asset.id === targetId)) fail("L'asset demandé est introuvable.", 404);
    } else fail("La cible de génération doit être un plan ou un asset.");
    const strategy = cleanText(args.strategy, 32);
    if (!VISUAL_STRATEGIES.has(strategy) && !AUDIO_TRACKS.has(strategy)) fail("La stratégie de génération est inconnue.");
    const job = {
      id: `job_${randomUUID()}`,
      targetType,
      targetId,
      strategy,
      label: cleanText(args.label, 160) || "Génération",
      status: "pending",
      progress: 0,
      createdAt: now(),
      updatedAt: now(),
      error: null,
    };
    manifest.queue.push(job);
    return { entityType: "job", entityId: job.id, tab: "production" };
  }

  fail("Opération non implémentée.");
}

export function createProductionStore({
  filePath = resolve(process.cwd(), "data", "workspace.json"),
  persist = true,
  initialState,
  now = () => new Date().toISOString(),
} = {}) {
  let manifest = normalizeManifest(initialState ? clone(initialState) : createEmptyManifest(now), now);
  let writeChain = Promise.resolve();

  const save = async () => {
    if (!persist) return;
    const snapshot = JSON.stringify(manifest, null, 2);
    writeChain = writeChain.then(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.tmp`;
      await writeFile(temporaryPath, snapshot, "utf8");
      await rename(temporaryPath, filePath);
    });
    await writeChain;
  };

  return {
    async load() {
      if (!persist) return clone(manifest);
      try {
        const loaded = JSON.parse(await readFile(filePath, "utf8"));
        if (loaded?.schemaVersion !== 1) fail("Le manifeste local utilise une version inconnue.", 500);
        manifest = normalizeManifest(loaded, now);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        await save();
      }
      return clone(manifest);
    },

    snapshot() {
      return clone(manifest);
    },

    async editShot(shotId, patch, baseVersion) {
      if (!Number.isInteger(baseVersion)) fail("La version du plan est requise.");
      if (patch.durationMs !== undefined && (!Number.isInteger(patch.durationMs) || patch.durationMs < 250 || patch.durationMs > 120000)) fail("La durée doit être comprise entre 0,25 et 120 secondes.");
      const next = clone(manifest);
      applyOperation(next, { name: "update_shot", args: { shotId, patch, baseVersion } }, now);
      cancelOrphanJobs(next);
      syncVisualTrack(next);
      recalculateTimeline(next);
      next.revision += 1;
      next.updatedAt = now();
      next.activity.push({ id: `event_${randomUUID()}`, type: "shot_edited", shotId, revision: next.revision, at: now() });
      manifest = next;
      await save();
      return { manifest: clone(manifest) };
    },

    // Réordonner, dupliquer, supprimer et restaurer sont des gestes directs du
    // réalisateur : c'est lui qui décide, il n'y a pas de proposition à valider.
    // Valider le storyboard fige ce qui a été jugé : versions de texte et images
    // retenues. Toute modification ultérieure devient repérable, au lieu de
    // laisser croire que la validation vaut encore.
    async setStoryboardLock(locked) {
      const next = clone(manifest);
      if (!locked) {
        next.storyboardLock = null;
      } else {
        if (!next.shots.length) fail("Il n'y a aucun plan à valider.", 409);
        next.storyboardLock = {
          lockedAt: now(),
          revision: next.revision,
          shots: next.shots.map((shot) => {
            const frames = next.media.filter(
              (item) => item.targetType === "shot" && item.targetId === shot.id && item.kind === "image",
            );
            const frame = frames.find((item) => item.status === "approved") || frames[frames.length - 1] || null;
            return { shotId: shot.id, version: shot.version, mediaId: frame ? frame.id : null };
          }),
        };
      }
      next.revision += 1;
      next.updatedAt = now();
      next.activity.push({
        id: `event_${randomUUID()}`,
        type: locked ? "storyboard_locked" : "storyboard_unlocked",
        revision: next.revision,
        at: now(),
      });
      manifest = next;
      await save();
      return { lock: clone(manifest.storyboardLock), manifest: clone(manifest) };
    },

    async editStoryboard(name, args = {}) {
      if (!STORYBOARD_OPERATIONS.has(name)) fail("Cette opération de storyboard est inconnue.");
      const next = clone(manifest);
      const result = applyOperation(next, { name, args }, now);
      cancelOrphanJobs(next);
      syncVisualTrack(next);
      recalculateTimeline(next);
      next.revision += 1;
      next.updatedAt = now();
      next.activity.push({
        id: `event_${randomUUID()}`,
        type: "storyboard_edited",
        operation: name,
        targetId: result?.entityId || "",
        revision: next.revision,
        at: now(),
      });
      manifest = next;
      await save();
      return { result, manifest: clone(manifest) };
    },

    async attachMedia({
      id,
      targetType,
      targetId,
      kind = "image",
      purpose = "reference",
      url,
      fileName,
      mimeType,
      prompt,
      provider,
      model,
      variantKey = null,
      parentMediaId = null,
      width = null,
      height = null,
      estimatedCostUsd = 0,
      sourceShotVersion = null,
      sourceRefs = [],
    } = {}) {
      if (targetType !== "asset" && targetType !== "shot") {
        fail("Les médias acceptent uniquement les assets et les plans.");
      }
      const cleanTargetId = cleanText(targetId, 128);
      const target = targetType === "asset"
        ? manifest.assets.find((item) => item.id === cleanTargetId)
        : manifest.shots.find((item) => item.id === cleanTargetId);
      if (!target) fail(targetType === "asset" ? "L'asset demandé est introuvable." : "Le plan demandé est introuvable.", 404);
      if (kind !== "image" && kind !== "video") fail("Le type de média demandé n'est pas encore pris en charge.");
      const mediaId = cleanText(id, 160);
      const mediaUrl = cleanText(url, 500);
      const storedFileName = cleanText(fileName, 220);
      const storedMimeType = cleanText(mimeType, 80);
      if (!mediaId || !mediaUrl || !storedFileName || !storedMimeType) fail("Le média généré est incomplet.");
      if (manifest.media.some((item) => item.id === mediaId)) fail("Cet identifiant média existe déjà.", 409);
      const cleanVariantKey = cleanText(variantKey, 80) || null;
      const cleanParentMediaId = cleanText(parentMediaId, 160) || null;
      if (cleanParentMediaId) {
        const parent = manifest.media.find((item) => item.id === cleanParentMediaId);
        if (!parent || parent.targetType !== targetType || parent.targetId !== target.id || parent.kind !== "image") {
          fail("La référence source de cette image ciblée est invalide.");
        }
      }
      const variantVersion = cleanVariantKey
        ? manifest.media.filter((item) => item.targetType === targetType && item.targetId === target.id
          && item.kind === kind && item.variantKey === cleanVariantKey).length + 1
        : null;
      const media = {
        id: mediaId,
        targetType,
        targetId: target.id,
        kind,
        purpose: cleanText(purpose, 80) || "reference",
        url: mediaUrl,
        fileName: storedFileName,
        mimeType: storedMimeType,
        width: Number.isInteger(width) && width > 0 ? width : null,
        height: Number.isInteger(height) && height > 0 ? height : null,
        estimatedCostUsd: Number.isFinite(Number(estimatedCostUsd)) ? Math.max(0, Number(estimatedCostUsd)) : 0,
        prompt: cleanText(prompt, 4_000),
        provider: cleanText(provider, 80),
        model: cleanText(model, 160),
        variantKey: cleanVariantKey,
        variantVersion,
        parentMediaId: cleanParentMediaId,
        sourceShotVersion: targetType === "shot" && Number.isInteger(sourceShotVersion) ? sourceShotVersion : null,
        // Références réellement transmises au générateur, pas celles qu'on
        // suppose : c'est ce qui rend une alerte de changement vérifiable.
        sourceRefs: Array.isArray(sourceRefs)
          ? sourceRefs
              .filter((ref) => ref && ref.assetId && ref.mediaId)
              .map((ref) => ({
                assetId: cleanText(ref.assetId, 128),
                mediaId: cleanText(ref.mediaId, 160),
                mediaVersion: Number.isInteger(ref.mediaVersion) ? ref.mediaVersion : null,
              }))
              .slice(0, 20)
          : [],
        version: (Array.isArray(target.references) ? target.references.length : 0) + 1,
        status: "ready",
        createdAt: now(),
      };
      manifest.media.push(media);
      if (!Array.isArray(target.references)) target.references = [];
      target.references.push(media.id);
      manifest.revision += 1;
      manifest.updatedAt = now();
      manifest.activity.push({
        id: `event_${randomUUID()}`,
        type: "media_attached",
        mediaId: media.id,
        targetType,
        targetId: target.id,
        revision: manifest.revision,
        at: now(),
      });
      await save();
      return { media: clone(media), manifest: clone(manifest) };
    },

    // Une image devient la référence approuvée de sa cible. Tant que rien n'est
    // approuvé, les générations retombent sur la dernière version disponible.
    async approveMedia(mediaId, approved = true, review = null) {
      const media = manifest.media.find((item) => item.id === cleanText(mediaId, 160));
      if (!media) fail("Le média demandé est introuvable.", 404);
      const target = media.targetType === "asset"
        ? manifest.assets.find((item) => item.id === media.targetId)
        : manifest.shots.find((item) => item.id === media.targetId);
      if (!target) fail("La cible du média est introuvable.", 404);
      if (approved && media.targetType === "asset" && media.purpose === "character_consistency") {
        const checklist = review && typeof review === "object" && !Array.isArray(review) ? review : {};
        const missing = ["angles", "postures", "emotions"].filter((item) => checklist[item] !== true);
        if (missing.length) {
          fail("Contrôle incomplet : confirmez angles, postures et émotions avant de valider cette référence.");
        }
        media.review = { angles: true, postures: true, emotions: true, reviewedAt: now() };
      }
      for (const item of manifest.media) {
        if (item.targetType === media.targetType && item.targetId === media.targetId && item.kind === media.kind && (item.variantKey || null) === (media.variantKey || null) && item.status === "approved") {
          item.status = "ready";
          item.approvedAt = null;
        }
      }
      media.status = approved ? "approved" : "ready";
      media.approvedAt = approved ? now() : null;
      if (media.targetType === "shot" && media.kind === "image") media.reviewedShotVersion = approved ? target.version : null;
      if (media.kind === "image" && !media.variantKey && (approved || target.approvedMediaId === media.id)) target.approvedMediaId = approved ? media.id : null;
      manifest.revision += 1;
      manifest.updatedAt = now();
      manifest.activity.push({
        id: `event_${randomUUID()}`,
        type: approved ? "media_approved" : "media_unapproved",
        mediaId: media.id,
        targetType: media.targetType,
        targetId: target.id,
        revision: manifest.revision,
        at: now(),
      });
      await save();
      return { media: clone(media), manifest: clone(manifest) };
    },

    async propose(name, args = {}, source = "assistant") {
      if (!OPERATION_NAMES.has(name)) fail("Opération inconnue.");
      const knownIds = collectKnownIds(manifest);
      const requestedKey = stableArgsKey(name, args, knownIds);
      const duplicate = manifest.approvals.find(
        (item) => item.status === "pending" && stableArgsKey(item.operation.name, item.operation.args, knownIds) === requestedKey,
      );
      if (duplicate) return clone(duplicate);
      const approval = {
        id: `approval_${randomUUID()}`,
        operation: { name, args: clone(args) },
        source,
        status: "pending",
        baseRevision: manifest.revision,
        createdAt: now(),
        decidedAt: null,
        result: null,
      };
      manifest.approvals.push(approval);
      manifest.activity.push({
        id: `event_${randomUUID()}`,
        type: "operation_proposed",
        approvalId: approval.id,
        operation: name,
        at: now(),
      });
      await save();
      return clone(approval);
    },

    async decide(approvalId, decision, argsOverride = null) {
      const approval = manifest.approvals.find((item) => item.id === approvalId);
      if (!approval) fail("La proposition est introuvable.", 404);
      if (approval.status !== "pending") fail("Cette proposition a déjà reçu une décision.", 409);
      if (decision !== "approve" && decision !== "reject") fail("La décision doit être approve ou reject.");
      approval.decidedAt = now();
      if (decision === "reject") {
        approval.status = "rejected";
        manifest.activity.push({ id: `event_${randomUUID()}`, type: "operation_rejected", approvalId, at: now() });
        await save();
        return { approval: clone(approval), manifest: clone(manifest) };
      }

      const next = clone(manifest);
      const nextApproval = next.approvals.find((item) => item.id === approvalId);
      if (argsOverride !== null) {
        if (!argsOverride || typeof argsOverride !== "object" || Array.isArray(argsOverride)) {
          fail("Les paramètres ajustés sont invalides.");
        }
        nextApproval.operation.args = { ...nextApproval.operation.args, ...clone(argsOverride) };
      }
      const result = applyOperation(next, nextApproval.operation, now);
      // Une seule reconstruction après l'opération complète : create_screenplay
      // en applique plusieurs en cascade.
      cancelOrphanJobs(next);
      syncVisualTrack(next);
      recalculateTimeline(next);
      next.revision += 1;
      next.updatedAt = now();
      nextApproval.status = "approved";
      nextApproval.decidedAt = approval.decidedAt;
      nextApproval.result = result;
      next.activity.push({
        id: `event_${randomUUID()}`,
        type: "operation_applied",
        approvalId,
        operation: nextApproval.operation.name,
        result,
        revision: next.revision,
        at: now(),
      });
      manifest = next;
      await save();
      return { approval: clone(nextApproval), manifest: clone(manifest) };
    },

    async transitionJob(jobId, status, progress = null, error = null) {
      const job = manifest.queue.find((item) => item.id === jobId);
      if (!job) fail("Le job demandé est introuvable.", 404);
      if (!JOB_TRANSITIONS[job.status]?.has(status)) fail(`Transition ${job.status} → ${status} refusée.`, 409);
      job.status = status;
      job.progress = status === "succeeded" ? 100 : progress === null ? job.progress : positiveInteger(progress, job.progress, 0, 100);
      job.error = status === "failed" ? cleanText(error, 500) || "Échec sans détail." : null;
      job.updatedAt = now();
      manifest.revision += 1;
      manifest.updatedAt = now();
      manifest.activity.push({ id: `event_${randomUUID()}`, type: "job_transition", jobId, status, at: now() });
      await save();
      return { job: clone(job), manifest: clone(manifest) };
    },

    async reset() {
      manifest = createEmptyManifest(now);
      await save();
      return clone(manifest);
    },
  };
}

export function summarizeManifest(manifest) {
  return {
    revision: manifest.revision,
    project: manifest.project.id
      ? {
          title: manifest.project.title,
          brief: manifest.project.brief,
          premise: manifest.project.premise,
          genre: manifest.project.genre,
          visualStyle: manifest.project.visualStyle,
          narrativeOutline: manifest.project.narrativeOutline,
          aspectRatio: manifest.project.aspectRatio,
          fps: manifest.project.fps,
          durationSeconds: manifest.project.durationSeconds,
          status: manifest.project.status,
        }
      : null,
    assets: manifest.assets.map(({ id, type, name, description, version }) => ({ id, type, name, description, version })).slice(0, 40),
    media: (manifest.media || []).map(({ id, targetType, targetId, kind, purpose, variantKey, variantVersion, parentMediaId, version, url, mimeType, provider, model, status }) => ({ id, targetType, targetId, kind, purpose, variantKey, variantVersion, parentMediaId, version, url, mimeType, provider, model, status })).slice(-80),
    sequences: manifest.sequences.map(({ id, title, order }) => ({ id, title, order })).slice(0, 30),
    shots: manifest.shots.map(({ id, sequenceId, title, description, durationMs, strategy, version, dialogue, continuity, assetIds, narrativeStates, narrativeTransition }) => ({
      id, sequenceId, title, description, durationMs, strategy, version,
      assetIds: assetIds || [],
      dialogue: dialogue || [],
      continuity: continuity || "cut",
      narrativeStates: narrativeStates || [],
      narrativeTransition: narrativeTransition || "unspecified",
    })).slice(0, 50),
    timelineDurationMs: manifest.timeline.durationMs,
    pendingApprovals: manifest.approvals.filter((item) => item.status === "pending").length,
    activeJobs: manifest.queue.filter((item) => !new Set(["succeeded", "failed", "cancelled"]).has(item.status)).length,
  };
}
