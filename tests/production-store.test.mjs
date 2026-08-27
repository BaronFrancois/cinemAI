import test from "node:test";
import assert from "node:assert/strict";
import { createProductionStore } from "../production-store.mjs";

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
  assert.deepEqual(manifest.sequences, []);
  assert.deepEqual(manifest.shots, []);
  assert.deepEqual(manifest.queue, []);
  assert.equal(manifest.timeline.durationMs, 0);
  assert.equal(manifest.timeline.tracks.length, 6);
  assert.equal(manifest.timeline.tracks.every((track) => track.clips.length === 0), true);
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
