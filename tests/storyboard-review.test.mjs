import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewStoryboard } from '../storyboard-review.mjs';
import { createProductionStore } from '../production-store.mjs';

async function approve(store, name, args) {
  const proposal = await store.propose(name, args, 'test');
  return store.decide(proposal.id, 'approve');
}

test('screenplay proposal is atomic and cannot overwrite an existing film', async () => {
  const store = createProductionStore({ persist: false });
  await approve(store, 'set_project', { title: 'Film', durationSeconds: 8 });
  const args = { sequences: [{ title: 'Ouverture', shots: [{ title: 'Entrée', description: 'Nora entre.', durationMs: 4000 }, { title: 'Découverte', description: 'Elle trouve une lettre.', durationMs: 4000 }] }] };
  const proposal = await store.propose('create_screenplay', args);
  assert.equal(store.snapshot().shots.length, 0);
  await store.decide(proposal.id, 'approve');
  const before = store.snapshot();
  assert.equal(before.shots.length, 2);
  assert.equal(before.shots[0].sequenceId, before.sequences[0].id);
  assert.equal(before.media.length, 0);
  assert.equal(before.queue.length, 0);
  await assert.rejects(approve(store, 'create_screenplay', args), /découpage existe/);
  assert.deepEqual(store.snapshot().shots, before.shots);
});

test('invalid second screenplay shot rolls back the entire proposal', async () => {
  const store = createProductionStore({ persist: false });
  await approve(store, 'set_project', { title: 'Film' });
  await assert.rejects(approve(store, 'create_screenplay', { sequences: [{ title: 'Début', shots: [{ description: 'Valide' }, { description: '' }] }] }), /description/);
  assert.equal(store.snapshot().shots.length, 0);
  assert.equal(store.snapshot().sequences.length, 0);
});

test('editing saves history, preserves media and neighbours, rejects stale writes', async () => {
  const store = createProductionStore({ persist: false });
  await approve(store, 'set_project', { title: 'Film' });
  const a = (await approve(store, 'create_shot', { description: 'Ancien texte' })).approval.result.entityId;
  await approve(store, 'create_shot', { description: 'Voisin' });
  await store.attachMedia({ id: 'm1', targetType: 'shot', targetId: a, url: '/api/media/m1', fileName: 'm1.png', mimeType: 'image/png', sourceShotVersion: 1 });
  const before = store.snapshot();
  await store.editShot(a, { description: 'Texte corrigé' }, 1);
  const after = store.snapshot();
  assert.equal(after.shots[0].version, 2);
  assert.equal(after.shots[0].history[0].description, 'Ancien texte');
  assert.deepEqual(after.media, before.media);
  assert.deepEqual(after.shots[1], before.shots[1]);
  assert.ok(reviewStoryboard(after).issues.some(i => i.code === 'stale_frame'));
  await assert.rejects(store.editShot(a, { description: 'Écriture concurrente' }, 1), /modifié ailleurs/);
  assert.deepEqual(store.snapshot(), after);
  await assert.rejects(store.editShot(a, { assetIds: ['missing'] }, 2), /introuvable/);
  assert.deepEqual(store.snapshot(), after);
});

test('structural review is read-only and distinguishes legacy media from visual analysis', () => {
  const manifest = { revision: 3, project: { durationSeconds: 8 }, assets: [{ id: 'room', type: 'location', name: 'Bureau' }], media: [{ id: 'frame', targetType: 'shot', targetId: 'b', kind: 'image', status: 'approved' }], shots: [{ id: 'a', description: 'Entrée', durationMs: 3000, version: 1, assetIds: ['room'], continuity: 'continuous' }, { id: 'b', description: 'Suite', durationMs: 3000, version: 1, assetIds: [], continuity: 'continuous', dialogue: [{ speaker: 'Nora', line: 'Bonjour' }] }] };
  const copy = structuredClone(manifest);
  const report = reviewStoryboard(manifest);
  assert.deepEqual(manifest, copy);
  for (const code of ['duration', 'first_continuous', 'missing_frame', 'unapproved_reference', 'location_change', 'speaker', 'unknown_source']) assert.ok(report.issues.some(i => i.code === code), code);
  assert.equal(report.scope, 'structure');
  assert.equal(report.approvedFrames, 1);
});

test('human revalidation clears stale frame after text changes without new generation', async () => {
  const store = createProductionStore({ persist: false });
  await approve(store, 'set_project', { title: 'Film' });
  const id = (await approve(store, 'create_shot', { description: 'Entrée' })).approval.result.entityId;
  await store.attachMedia({ id: 'frame', targetType: 'shot', targetId: id, url: '/api/media/frame', fileName: 'frame.png', mimeType: 'image/png', sourceShotVersion: 1 });
  await store.editShot(id, { description: 'Même action, texte précisé' }, 1);
  assert.ok(reviewStoryboard(store.snapshot()).issues.some(i => i.code === 'stale_frame'));
  await store.approveMedia('frame');
  assert.equal(reviewStoryboard(store.snapshot()).issues.some(i => i.code === 'stale_frame'), false);
  assert.equal(store.snapshot().media.length, 1);
  assert.equal(store.snapshot().media[0].sourceShotVersion, 1);
});

test('a frame generated from a superseded reference is flagged for review', () => {
  const manifest = {
    project: { id: 'p1', durationSeconds: 4 },
    shots: [{ id: 's1', title: 'Plan', description: 'Action.', durationMs: 4000, version: 1, assetIds: ['a1'], continuity: 'cut' }],
    assets: [{ id: 'a1', name: 'Shadow', type: 'character' }],
    media: [
      // Référence validée aujourd'hui.
      { id: 'm_ref_v2', targetType: 'asset', targetId: 'a1', kind: 'image', purpose: 'character_consistency', status: 'approved', version: 2 },
      // Image du plan, produite depuis la version précédente de cette référence.
      {
        id: 'm_frame', targetType: 'shot', targetId: 's1', kind: 'image', status: 'approved', version: 1,
        sourceShotVersion: 1,
        sourceRefs: [{ assetId: 'a1', mediaId: 'm_ref_v1', mediaVersion: 1 }],
      },
    ],
  };
  const codes = reviewStoryboard(manifest).issues.map(issue => issue.code);
  assert.ok(codes.includes('reference_changed'), 'le changement de référence doit être signalé');

  // Même image, mais produite depuis la référence actuelle : aucune alerte.
  manifest.media[1].sourceRefs = [{ assetId: 'a1', mediaId: 'm_ref_v2', mediaVersion: 2 }];
  assert.equal(reviewStoryboard(manifest).issues.some(i => i.code === 'reference_changed'), false);

  // Image ancienne sans provenance : on ne peut rien affirmer, donc rien n'est
  // signalé à ce titre.
  delete manifest.media[1].sourceRefs;
  assert.equal(reviewStoryboard(manifest).issues.some(i => i.code === 'reference_changed'), false);
});

test('a locked storyboard reports exactly what moved since validation', () => {
  const base = () => ({
    project: { id: 'p1', durationSeconds: 8 },
    shots: [
      { id: 's1', title: 'Un', description: 'Action un.', durationMs: 4000, version: 2, assetIds: [], continuity: 'cut' },
      { id: 's2', title: 'Deux', description: 'Action deux.', durationMs: 4000, version: 1, assetIds: [], continuity: 'cut' },
    ],
    assets: [],
    media: [{ id: 'm1', targetType: 'shot', targetId: 's1', kind: 'image', status: 'approved', version: 1 }],
    storyboardLock: {
      lockedAt: '2026-09-05T10:00:00Z',
      shots: [{ shotId: 's1', version: 2, mediaId: 'm1' }, { shotId: 's2', version: 1, mediaId: null }],
    },
  });

  // Rien n'a bougé : aucune alerte liée à la validation.
  const stable = reviewStoryboard(base()).issues.map(i => i.code);
  assert.equal(stable.some(code => code.endsWith('_since_lock')), false);

  // Texte modifié après validation.
  const edited = base();
  edited.shots[0].version = 3;
  assert.ok(reviewStoryboard(edited).issues.some(i => i.code === 'edited_since_lock'));

  // Image remplacée après validation.
  const reframed = base();
  reframed.media.push({ id: 'm2', targetType: 'shot', targetId: 's1', kind: 'image', status: 'approved', version: 2 });
  reframed.media[0].status = 'ready';
  assert.ok(reviewStoryboard(reframed).issues.some(i => i.code === 'frame_changed_since_lock'));

  // Plan ajouté, puis plan supprimé.
  const added = base();
  added.shots.push({ id: 's3', title: 'Trois', description: 'Action trois.', durationMs: 1000, version: 1, assetIds: [], continuity: 'cut' });
  assert.ok(reviewStoryboard(added).issues.some(i => i.code === 'added_since_lock'));

  const removed = base();
  removed.shots.pop();
  assert.ok(reviewStoryboard(removed).issues.some(i => i.code === 'removed_since_lock'));

  // Sans validation enregistrée, aucun de ces contrôles ne s'applique.
  const unlocked = base();
  unlocked.storyboardLock = null;
  assert.equal(reviewStoryboard(unlocked).issues.some(i => i.code.endsWith('_since_lock')), false);
});
