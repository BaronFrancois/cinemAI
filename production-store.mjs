import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

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
  "create_sequence",
  "create_shot",
  "update_shot",
  "add_timeline_clip",
  "add_audio_clip",
  "queue_generation",
]);

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
      aspectRatio: "16:9",
      fps: 24,
      status: "draft",
    },
    assets: [],
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

function clone(value) {
  return structuredClone(value);
}

function recalculateTimeline(manifest) {
  manifest.timeline.durationMs = manifest.timeline.tracks.reduce((max, track) => (
    track.clips.reduce((trackMax, clip) => Math.max(trackMax, clip.startMs + clip.durationMs), max)
  ), 0);
}

function requireProject(manifest) {
  if (!manifest.project.id) fail("Créez d'abord le projet.", 409);
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
    if (!title && !brief) fail("Le projet doit recevoir un titre ou un brief.");
    if (!manifest.project.id) manifest.project.id = `project_${randomUUID()}`;
    if (title) manifest.project.title = title;
    if (brief) manifest.project.brief = brief;
    if (args.aspectRatio) manifest.project.aspectRatio = cleanText(args.aspectRatio, 12);
    if (args.fps !== undefined) manifest.project.fps = positiveInteger(args.fps, manifest.project.fps, 1, 120);
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
      createdAt: now(),
    };
    manifest.assets.push(asset);
    return { entityType: "asset", entityId: asset.id, tab: assetType === "location" ? "decors" : "personnages" };
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
      version: 1,
      status: "draft",
      createdAt: now(),
      updatedAt: now(),
    };
    manifest.shots.push(shot);
    return { entityType: "shot", entityId: shot.id, tab: "production" };
  }

  if (name === "update_shot") {
    const shot = requireShot(manifest, cleanText(args.shotId, 128));
    const patch = args.patch && typeof args.patch === "object" && !Array.isArray(args.patch) ? args.patch : {};
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
    shot.version += 1;
    shot.updatedAt = now();
    return { entityType: "shot", entityId: shot.id, tab: "production" };
  }

  if (name === "add_timeline_clip") {
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
  let manifest = initialState ? clone(initialState) : createEmptyManifest(now);
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
        manifest = loaded;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        await save();
      }
      return clone(manifest);
    },

    snapshot() {
      return clone(manifest);
    },

    async propose(name, args = {}, source = "assistant") {
      if (!OPERATION_NAMES.has(name)) fail("Opération inconnue.");
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

    async decide(approvalId, decision) {
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
      const result = applyOperation(next, nextApproval.operation, now);
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
      ? { title: manifest.project.title, brief: manifest.project.brief, aspectRatio: manifest.project.aspectRatio, fps: manifest.project.fps }
      : null,
    assets: manifest.assets.map(({ id, type, name }) => ({ id, type, name })).slice(0, 40),
    sequences: manifest.sequences.map(({ id, title, order }) => ({ id, title, order })).slice(0, 30),
    shots: manifest.shots.map(({ id, sequenceId, title, description, durationMs, strategy, version }) => ({
      id, sequenceId, title, description, durationMs, strategy, version,
    })).slice(0, 50),
    timelineDurationMs: manifest.timeline.durationMs,
    pendingApprovals: manifest.approvals.filter((item) => item.status === "pending").length,
    activeJobs: manifest.queue.filter((item) => !new Set(["succeeded", "failed", "cancelled"]).has(item.status)).length,
  };
}
