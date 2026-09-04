import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyManifest, createProductionStore } from "../production-store.mjs";

async function approve(store, name, args) {
  const proposal = await store.propose(name, args, "test");
  return store.decide(proposal.id, "approve");
}

test("workspace starts structurally empty", () => {
  const store = createProductionStore({ persist: false });
  const manifest = store.snapshot();
  assert.equal(manifest.project.id, null);
  assert.equal(manifest.project.title, "");
  assert.deepEqual(manifest.assets, []);
  assert.deepEqual(manifest.media, []);
  assert.deepEqual(manifest.sequences, []);
  assert.deepEqual(manifest.shots, []);
  assert.deepEqual(manifest.queue, []);
  assert.equal(manifest.timeline.durationMs, 0);
  assert.equal(manifest.timeline.tracks.length, 6);
  assert.equal(manifest.timeline.tracks.every((track) => track.clips.length === 0), true);
});

test("generated media is attached to one asset with provenance", async () => {
  const store = createProductionStore({ persist: false });
  await approve(store, "set_project", { title: "Test" });
  const assetId = (await approve(store, "create_asset", {
    assetType: "character",
    name: "Nora",
    description: "Exploratrice au manteau bleu",
  })).approval.result.entityId;
  const result = await store.attachMedia({
    id: "media_test",
    targetType: "asset",
    targetId: assetId,
    kind: "image",
    purpose: "character_consistency",
    url: "/api/media/media_test",
    fileName: "media_test.png",
    mimeType: "image/png",
    prompt: "Planche de cohérence",
    provider: "mock",
    model: "deterministic-contact-sheet",
    estimatedCostUsd: 0.067,
  });
  assert.equal(result.media.version, 1);
  assert.equal(result.media.targetId, assetId);
  assert.equal(result.media.estimatedCostUsd, 0.067);
  assert.deepEqual(result.manifest.assets.find((asset) => asset.id === assetId).references, ["media_test"]);
  assert.equal(result.manifest.activity.at(-1).type, "media_attached");
});

test("targeted asset images keep their slot history and source reference", async () => {
  const store = createProductionStore({ persist: false });
  await approve(store, "set_project", { title: "Test" });
  const assetId = (await approve(store, "create_asset", {
    assetType: "character",
    name: "Shadow",
  })).approval.result.entityId;
  await store.attachMedia({
    id: "media_sheet",
    targetType: "asset",
    targetId: assetId,
    kind: "image",
    purpose: "character_consistency",
    url: "/api/media/media_sheet",
    fileName: "media_sheet.png",
    mimeType: "image/png",
  });
  const first = await store.attachMedia({
    id: "media_face_1",
    targetType: "asset",
    targetId: assetId,
    kind: "image",
    purpose: "character_variant",
    variantKey: "face",
    parentMediaId: "media_sheet",
    url: "/api/media/media_face_1",
    fileName: "media_face_1.png",
    mimeType: "image/png",
  });
  const second = await store.attachMedia({
    id: "media_face_2",
    targetType: "asset",
    targetId: assetId,
    kind: "image",
    purpose: "character_variant",
    variantKey: "face",
    parentMediaId: "media_sheet",
    url: "/api/media/media_face_2",
    fileName: "media_face_2.png",
    mimeType: "image/png",
  });
  assert.equal(first.media.variantVersion, 1);
  assert.equal(second.media.variantVersion, 2);
  assert.equal(second.media.parentMediaId, "media_sheet");
});

test("an asset can be updated without replacing its media history", async () => {
  const store = createProductionStore({ persist: false });
  await approve(store, "set_project", { title: "Test" });
  const assetId = (await approve(store, "create_asset", {
    assetType: "character",
    name: "Shadow",
    description: "Chat ninja au regard sévère.",
  })).approval.result.entityId;
  await store.attachMedia({
    id: "media_shadow",
    targetType: "asset",
    targetId: assetId,
    kind: "image",
    purpose: "character_consistency",
    url: "/api/media/media_shadow",
    fileName: "media_shadow.png",
    mimeType: "image/png",
  });

  const result = await approve(store, "update_asset", {
    assetId,
    description: "Chat ninja au regard plus calme, costume inchangé.",
  });
  const asset = result.manifest.assets.find((item) => item.id === assetId);
  assert.equal(asset.description, "Chat ninja au regard plus calme, costume inchangé.");
  assert.equal(asset.version, 2);
  assert.deepEqual(asset.references, ["media_shadow"]);
  assert.equal(result.approval.result.entityId, assetId);
});

test("a character reference requires the full human consistency checklist", async () => {
  const store = createProductionStore({ persist: false });
  await approve(store, "set_project", { title: "Test" });
  const assetId = (await approve(store, "create_asset", {
    assetType: "character",
    name: "Nora",
  })).approval.result.entityId;
  await store.attachMedia({
    id: "media_character",
    targetType: "asset",
    targetId: assetId,
    kind: "image",
    purpose: "character_consistency",
    url: "/api/media/media_character",
    fileName: "media_character.png",
    mimeType: "image/png",
  });

  await assert.rejects(
    () => store.approveMedia("media_character", true, { angles: true, postures: false, emotions: true }),
    /angles, postures et émotions/i,
  );
  assert.equal(store.snapshot().media[0].status, "ready");

  const result = await store.approveMedia("media_character", true, {
    angles: true,
    postures: true,
    emotions: true,
  });
  assert.equal(result.media.status, "approved");
  assert.equal(result.media.review.postures, true);
  assert.equal(result.manifest.assets[0].approvedMediaId, "media_character");
});

test("proposal does not mutate project before approval", async () => {
  const store = createProductionStore({ persist: false });
  const proposal = await store.propose("set_project", { title: "Projet test", brief: "Brief test" }, "test");
  assert.equal(store.snapshot().project.id, null);
  assert.equal(store.snapshot().revision, 0);
  const result = await store.decide(proposal.id, "approve");
  assert.equal(result.manifest.project.title, "Projet test");
  assert.equal(result.manifest.revision, 1);
});

test("detailed entities stay blocked until the structured idea is approved", async () => {
  const initialState = createEmptyManifest();
  initialState.project.id = "project_waiting";
  initialState.project.title = "Idée en revue";
  initialState.project.status = "idea";
  const store = createProductionStore({ persist: false, initialState });
  const proposal = await store.propose("create_asset", { assetType: "character", name: "Trop tôt" }, "test");
  await assert.rejects(() => store.decide(proposal.id, "approve"), /présentation structurée/i);
  assert.equal(store.snapshot().assets.length, 0);
});

test("structured project fields are persisted by the approval gate", async () => {
  const store = createProductionStore({ persist: false });
  const result = await approve(store, "set_project", {
    title: "Nora",
    premise: "Une exploratrice retrouve une carte impossible.",
    genre: "Aventure contemplative",
    visualStyle: "Animation graphique bleu nuit",
    narrativeOutline: "Découverte, traversée, révélation.",
  });
  assert.equal(result.manifest.project.status, "structured");
  assert.equal(result.manifest.project.genre, "Aventure contemplative");
  assert.match(result.manifest.project.narrativeOutline, /Découverte/);
});

test("approval can apply user-adjusted presentation parameters", async () => {
  const store = createProductionStore({ persist: false });
  const proposal = await store.propose("set_project", {
    title: "Projet test",
    aspectRatio: "16:9",
    durationSeconds: 8,
  }, "test");
  const result = await store.decide(proposal.id, "approve", {
    aspectRatio: "9:16",
    durationSeconds: 4,
  });
  assert.equal(result.manifest.project.aspectRatio, "9:16");
  assert.equal(result.manifest.project.durationSeconds, 4);
});

test("rejected proposal leaves manifest unchanged", async () => {
  const store = createProductionStore({ persist: false });
  const proposal = await store.propose("set_project", { title: "Refusé" }, "test");
  const before = store.snapshot().revision;
  const result = await store.decide(proposal.id, "reject");
  assert.equal(result.approval.status, "rejected");
  assert.equal(result.manifest.project.id, null);
  assert.equal(result.manifest.revision, before);
});

test("targeted shot update leaves neighbouring shots byte-identical", async () => {
  const store = createProductionStore({ persist: false });
  await approve(store, "set_project", { title: "Test" });
  const sequence = (await approve(store, "create_sequence", { title: "Séquence" })).approval.result.entityId;
  const first = (await approve(store, "create_shot", { sequenceId: sequence, description: "Premier plan" })).approval.result.entityId;
  const second = (await approve(store, "create_shot", { sequenceId: sequence, description: "Second plan" })).approval.result.entityId;
  const secondBefore = JSON.stringify(store.snapshot().shots.find((shot) => shot.id === second));
  await approve(store, "update_shot", { shotId: first, patch: { description: "Premier plan corrigé", strategy: "image_sequence" } });
  const manifest = store.snapshot();
  assert.equal(manifest.shots.find((shot) => shot.id === first).version, 2);
  assert.equal(JSON.stringify(manifest.shots.find((shot) => shot.id === second)), secondBefore);
});

test("visual and audio clips share one canonical timeline", async () => {
  const store = createProductionStore({ persist: false });
  await approve(store, "set_project", { title: "Test" });
  const shotId = (await approve(store, "create_shot", { description: "Plan", durationMs: 2_000 })).approval.result.entityId;
  await approve(store, "add_timeline_clip", { shotId, startMs: 500, durationMs: 2_000, strategy: "first_last_video" });
  await approve(store, "add_audio_clip", { trackKind: "dialogue", title: "Dialogue", startMs: 0, durationMs: 3_000 });
  const manifest = store.snapshot();
  assert.equal(manifest.timeline.durationMs, 3_000);
  assert.equal(manifest.timeline.tracks.find((track) => track.kind === "visual").clips.length, 1);
  assert.equal(manifest.timeline.tracks.find((track) => track.kind === "dialogue").clips.length, 1);
});

test("generation jobs enforce state transitions", async () => {
  const store = createProductionStore({ persist: false });
  await approve(store, "set_project", { title: "Test" });
  const shotId = (await approve(store, "create_shot", { description: "Plan" })).approval.result.entityId;
  const jobId = (await approve(store, "queue_generation", {
    targetType: "shot",
    targetId: shotId,
    strategy: "image",
  })).approval.result.entityId;
  await assert.rejects(() => store.transitionJob(jobId, "succeeded"), /Transition pending/);
  await store.transitionJob(jobId, "running", 25);
  const result = await store.transitionJob(jobId, "review", 100);
  assert.equal(result.job.status, "review");
});

test("shots carry dialogue and continuity, and legacy shots get safe defaults", async () => {
  const store = createProductionStore({ persist: false });
  await approve(store, "set_project", { title: "Ninja félin" });
  const shotId = (await approve(store, "create_shot", {
    title: "Le coup de patte fatal",
    description: "Shadow pousse la tasse.",
    durationMs: 4_000,
    continuity: "continuous",
    dialogue: [
      { speaker: "Shadow", line: "Mission accomplie." },
      { speaker: "", line: "   " },
      { line: "Réplique sans locuteur." },
    ],
  })).approval.result.entityId;

  const shot = store.snapshot().shots.find((item) => item.id === shotId);
  assert.equal(shot.continuity, "continuous");
  // Les répliques vides sont écartées, le locuteur reste facultatif.
  assert.deepEqual(shot.dialogue, [
    { speaker: "Shadow", line: "Mission accomplie." },
    { speaker: "", line: "Réplique sans locuteur." },
  ]);

  await approve(store, "update_shot", { shotId, patch: { continuity: "cut", dialogue: [] } });
  const updated = store.snapshot().shots.find((item) => item.id === shotId);
  assert.equal(updated.continuity, "cut");
  assert.deepEqual(updated.dialogue, []);

  await assert.rejects(
    () => approve(store, "update_shot", { shotId, patch: { continuity: "fondu" } }),
    /cut ou continuous/,
  );

  // Un plan enregistré avant ces champs doit rester chargeable.
  const legacy = createEmptyManifest(() => new Date().toISOString());
  legacy.project = { id: "project_1", title: "Ancien" };
  legacy.shots = [{ id: "shot_legacy", title: "Ancien plan", description: "Sans dialogue", durationMs: 3_000 }];
  const revived = createProductionStore({ persist: false, initialState: legacy });
  const revivedShot = revived.snapshot().shots[0];
  assert.deepEqual(revivedShot.dialogue, []);
  assert.equal(revivedShot.continuity, "cut");
});
