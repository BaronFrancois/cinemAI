import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buildConfig, buildShotVideoPrompt, callGeminiImage, callOmniVideo, chainDepthBefore, createCinemaiServer, frameExtractorCommand } from "../server.mjs";
import { createProductionStore } from "../production-store.mjs";

async function withServer(config, run, options = {}) {
  const server = createCinemaiServer({
    config,
    fetchImpl: options.fetchImpl,
    logger: { info() {}, warn() {} },
    store: options.store,
    mediaDir: options.mediaDir,
    ...(options.extractFrame ? { extractFrame: options.extractFrame } : {}),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

const mockConfig = {
  mode: "mock",
  host: "127.0.0.1",
  port: 0,
  model: "gemini-3.5-flash",
  imageModel: "gemini-3.1-flash-image",
  apiKey: "",
  requestTimeoutMs: 1_000,
};

test("configuration refuses remote exposure and invalid live mode", () => {
  assert.throws(
    () => buildConfig({ CINEMAI_SERVER_HOST: "0.0.0.0" }),
    /doit rester local/i,
  );
  assert.throws(
    () => buildConfig({ CINEMAI_LLM_MODE: "google" }),
    /GEMINI_API_KEY manque/i,
  );
  assert.throws(
    () => buildConfig({ CINEMAI_LLM_TIMEOUT_MS: "10" }),
    /compris entre/i,
  );
  assert.throws(
    () => buildConfig({ CINEMAI_IMAGE_COST_USD_1K: "invalid" }),
    /montant positif/i,
  );
});

test("health exposes mode and model, never a key", async () => {
  await withServer(mockConfig, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, "mock");
    assert.equal(body.model, "gemini-3.5-flash");
    assert.equal(body.keyConfigured, false);
    assert.equal(JSON.stringify(body).includes("secret"), false);
  });
});

test("image model is configurable without exposing the key", () => {
  const config = buildConfig({ GEMINI_IMAGE_MODEL: "gemini-3.1-flash-lite-image" });
  assert.equal(config.imageModel, "gemini-3.1-flash-lite-image");
  assert.equal(config.imageCostsUsd["1K"], 0.067);
});

test("media config exposes a zero-cost deterministic test mode", async () => {
  await withServer(mockConfig, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/media/config`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.image.provider, "mock");
    assert.equal(body.image.estimatedCostUsd["1K"], 0);
    assert.equal(JSON.stringify(body).includes("apiKey"), false);
  });
});

test("asset image generation requires confirmation and persists a visible mock", async () => {
  const mediaDir = await mkdtemp(resolve(tmpdir(), "cinemai-media-"));
  const store = createProductionStore({ persist: false });
  const project = await store.propose("set_project", { title: "Test image" }, "test");
  await store.decide(project.id, "approve");
  const assetProposal = await store.propose("create_asset", {
    assetType: "character",
    name: "Nora",
    description: "Exploratrice au manteau bleu",
  }, "test");
  const assetId = (await store.decide(assetProposal.id, "approve")).approval.result.entityId;
  try {
    await withServer(mockConfig, async (baseUrl) => {
      const refused = await fetch(`${baseUrl}/api/assets/${assetId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "character_consistency" }),
      });
      assert.equal(refused.status, 400);

      const generated = await fetch(`${baseUrl}/api/assets/${assetId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE", purpose: "character_consistency", imageSize: "1K" }),
      });
      assert.equal(generated.status, 201);
      const body = await generated.json();
      assert.equal(body.media.provider, "mock");
      assert.equal(body.media.estimatedCostUsd, 0);
      assert.equal(body.manifest.media.length, 1);
      assert.deepEqual(body.manifest.assets.find((asset) => asset.id === assetId).references, [body.media.id]);

      const media = await fetch(`${baseUrl}${body.media.url}`);
      assert.equal(media.status, 200);
      assert.equal(media.headers.get("content-type"), "image/svg+xml");
      assert.match(await media.text(), /Nora/);

      const regenerated = await fetch(`${baseUrl}/api/assets/${assetId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: "GENERATE_IMAGE",
          purpose: "character_consistency",
          imageSize: "2K",
          prompt: "Conserver exactement le manteau bleu.",
        }),
      });
      assert.equal(regenerated.status, 201);
      const regeneratedBody = await regenerated.json();
      assert.equal(regeneratedBody.media.version, 2);
      assert.match(regeneratedBody.media.prompt, /manteau bleu/i);
      assert.equal(regeneratedBody.manifest.media.length, 2);
      assert.equal(regeneratedBody.manifest.assets.find((asset) => asset.id === assetId).references.length, 2);
    }, { store, mediaDir });
  } finally {
    await rm(mediaDir, { recursive: true, force: true });
  }
});

test("one derived asset image can be regenerated without replacing the approved sheet", async () => {
  const mediaDir = await mkdtemp(resolve(tmpdir(), "cinemai-asset-variant-"));
  const store = createProductionStore({ persist: false });
  const project = await store.propose("set_project", { title: "Variantes ciblées" }, "test");
  await store.decide(project.id, "approve");
  const assetProposal = await store.propose("create_asset", {
    assetType: "character",
    name: "Shadow",
    description: "Chat ninja noir aux yeux verts",
  }, "test");
  const assetId = (await store.decide(assetProposal.id, "approve")).approval.result.entityId;
  try {
    await withServer(mockConfig, async (baseUrl) => {
      const sheetResponse = await fetch(`${baseUrl}/api/assets/${assetId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE", purpose: "character_consistency" }),
      });
      const sheet = (await sheetResponse.json()).media;

      const variantResponse = await fetch(`${baseUrl}/api/assets/${assetId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE", variantKey: "trois_quarts", imageSize: "1K" }),
      });
      assert.equal(variantResponse.status, 201);
      const variant = (await variantResponse.json()).media;
      assert.equal(variant.purpose, "character_variant");
      assert.equal(variant.variantKey, "trois_quarts");
      assert.equal(variant.variantVersion, 1);
      assert.equal(variant.parentMediaId, sheet.id);
      assert.match(variant.prompt, /une seule vue/i);
      assert.match(variant.prompt, /trois-quarts/i);

      const regeneratedResponse = await fetch(`${baseUrl}/api/assets/${assetId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE", variantKey: "trois_quarts", prompt: "Expression plus calme." }),
      });
      const regenerated = (await regeneratedResponse.json()).media;
      assert.equal(regenerated.variantVersion, 2);
      assert.equal(store.snapshot().assets[0].approvedMediaId, undefined);

      const invalid = await fetch(`${baseUrl}/api/assets/${assetId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE", variantKey: "inconnue" }),
      });
      assert.equal(invalid.status, 400);
    }, { store, mediaDir });
  } finally {
    await rm(mediaDir, { recursive: true, force: true });
  }
});

test("shot keyframes are generated per shot and reuse validated asset references", async () => {
  const mediaDir = await mkdtemp(resolve(tmpdir(), "cinemai-shot-media-"));
  const store = createProductionStore({ persist: false });
  const project = await store.propose("set_project", { title: "Ninja félin" }, "test");
  await store.decide(project.id, "approve");
  const assetProposal = await store.propose("create_asset", {
    assetType: "character",
    name: "Shadow",
    description: "Chat noir au foulard rouge",
  }, "test");
  const assetId = (await store.decide(assetProposal.id, "approve")).approval.result.entityId;
  const shotProposal = await store.propose("create_shot", {
    title: "L'approche furtive",
    description: "Shadow se faufile entre les dossiers.",
    durationMs: 4_000,
    assetIds: [assetId],
  }, "test");
  const shotId = (await store.decide(shotProposal.id, "approve")).approval.result.entityId;
  try {
    await withServer(mockConfig, async (baseUrl) => {
      const refused = await fetch(`${baseUrl}/api/shots/${shotId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(refused.status, 400);

      const missing = await fetch(`${baseUrl}/api/shots/shot_inconnu/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE" }),
      });
      assert.equal(missing.status, 404);

      // Sans planche validée, le plan se génère quand même, mais sans référence.
      const first = await fetch(`${baseUrl}/api/shots/${shotId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE", imageSize: "1K" }),
      });
      assert.equal(first.status, 201);
      const firstBody = await first.json();
      assert.equal(firstBody.media.targetType, "shot");
      assert.equal(firstBody.media.targetId, shotId);
      assert.equal(firstBody.media.purpose, "storyboard");
      assert.equal(firstBody.referencesUsed, 0);
      assert.match(firstBody.media.prompt, /approche furtive/i);

      // Une planche d'asset devient une référence réutilisée par le plan suivant.
      const sheet = await fetch(`${baseUrl}/api/assets/${assetId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE", purpose: "character_consistency" }),
      });
      assert.equal(sheet.status, 201);

      const second = await fetch(`${baseUrl}/api/shots/${shotId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE" }),
      });
      assert.equal(second.status, 201);
      const secondBody = await second.json();
      assert.equal(secondBody.referencesUsed, 1);
      assert.equal(secondBody.media.version, 2);
      assert.match(secondBody.media.prompt, /Shadow/);

      // Chaque plan garde ses propres images, distinctes de la planche d'identité.
      const shotMedia = secondBody.manifest.media.filter((item) => item.targetType === "shot");
      const assetMedia = secondBody.manifest.media.filter((item) => item.targetType === "asset");
      assert.equal(shotMedia.length, 2);
      assert.equal(assetMedia.length, 1);
    }, { store, mediaDir });
  } finally {
    await rm(mediaDir, { recursive: true, force: true });
  }
});

test("an approved media becomes the reference instead of the latest one", async () => {
  const mediaDir = await mkdtemp(resolve(tmpdir(), "cinemai-approval-"));
  const store = createProductionStore({ persist: false });
  const project = await store.propose("set_project", { title: "Validation" }, "test");
  await store.decide(project.id, "approve");
  const assetProposal = await store.propose("create_asset", {
    assetType: "character",
    name: "Shadow",
    description: "Chat noir",
  }, "test");
  const assetId = (await store.decide(assetProposal.id, "approve")).approval.result.entityId;
  const shotProposal = await store.propose("create_shot", {
    title: "Approche",
    description: "Shadow avance.",
    durationMs: 4_000,
    assetIds: [assetId],
  }, "test");
  const shotId = (await store.decide(shotProposal.id, "approve")).approval.result.entityId;
  try {
    await withServer(mockConfig, async (baseUrl) => {
      const sheet = (body) => fetch(`${baseUrl}/api/assets/${assetId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE", purpose: "character_consistency", ...body }),
      }).then((r) => r.json());

      const v1 = (await sheet({})).media;
      const v2 = (await sheet({})).media;
      assert.equal(v1.status, "ready");
      assert.equal(v2.version, 2);

      // Sans validation explicite, un plan mentionne une référence provisoire.
      const provisional = await fetch(`${baseUrl}/api/shots/${shotId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE" }),
      }).then((r) => r.json());
      assert.match(provisional.media.prompt, /non validées/i);

      // On valide explicitement la v1, plus ancienne que la v2.
      const approval = await fetch(`${baseUrl}/api/media/${v1.id}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true, review: { angles: true, postures: true, emotions: true } }),
      });
      assert.equal(approval.status, 200);
      const approvalBody = await approval.json();
      assert.equal(approvalBody.media.status, "approved");
      assert.equal(approvalBody.manifest.assets.find((a) => a.id === assetId).approvedMediaId, v1.id);

      // La régénération s'ancre désormais sur la version validée, pas la dernière.
      const anchored = await sheet({});
      assert.match(anchored.media.prompt, /explicitement validée/i);
      const shotAfter = await fetch(`${baseUrl}/api/shots/${shotId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE" }),
      }).then((r) => r.json());
      assert.doesNotMatch(shotAfter.media.prompt, /non validées/i);

      // Une seule version approuvée à la fois.
      const v3 = anchored.media;
      await fetch(`${baseUrl}/api/media/${v3.id}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true, review: { angles: true, postures: true, emotions: true } }),
      });
      const state = await fetch(`${baseUrl}/api/workspace`).then((r) => r.json());
      const approved = state.manifest.media.filter((item) => item.status === "approved");
      assert.equal(approved.length, 1);
      assert.equal(approved[0].id, v3.id);
    }, { store, mediaDir });
  } finally {
    await rm(mediaDir, { recursive: true, force: true });
  }
});

test("regenerating a sheet anchors on the validated version unless restart is asked", async () => {
  const mediaDir = await mkdtemp(resolve(tmpdir(), "cinemai-anchor-"));
  const store = createProductionStore({ persist: false });
  const project = await store.propose("set_project", { title: "Ancrage" }, "test");
  await store.decide(project.id, "approve");
  const proposal = await store.propose("create_asset", {
    assetType: "character",
    name: "Shadow",
    description: "Chat noir au foulard rouge",
  }, "test");
  const assetId = (await store.decide(proposal.id, "approve")).approval.result.entityId;
  try {
    await withServer(mockConfig, async (baseUrl) => {
      const generate = (body) => fetch(`${baseUrl}/api/assets/${assetId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE", purpose: "character_consistency", ...body }),
      });

      // Première planche : aucune version antérieure, donc aucun ancrage.
      const first = await generate({});
      assert.equal(first.status, 201);
      assert.doesNotMatch((await first.json()).media.prompt, /déjà validée/i);

      // Sans validation, la dernière version reste une ancre provisoire.
      const second = await generate({});
      assert.equal(second.status, 201);
      const secondBody = await second.json();
      assert.match(secondBody.media.prompt, /version provisoire/i);
      assert.doesNotMatch(secondBody.media.prompt, /explicitement validée/i);

      await fetch(`${baseUrl}/api/media/${secondBody.media.id}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true, review: { angles: true, postures: true, emotions: true } }),
      });
      const anchored = await generate({});
      assert.equal(anchored.status, 201);
      assert.match((await anchored.json()).media.prompt, /explicitement validée/i);

      // Repartir de zéro reste possible explicitement.
      const restarted = await generate({ restart: true });
      assert.equal(restarted.status, 201);
      assert.doesNotMatch((await restarted.json()).media.prompt, /explicitement validée/i);
    }, { store, mediaDir });
  } finally {
    await rm(mediaDir, { recursive: true, force: true });
  }
});

test("reference images take authority over style wording in the shot text", async () => {
  const mediaDir = await mkdtemp(resolve(tmpdir(), "cinemai-style-"));
  const store = createProductionStore({ persist: false });
  const project = await store.propose("set_project", { title: "Ninja félin" }, "test");
  await store.decide(project.id, "approve");
  const styleProposal = await store.propose("create_asset", {
    assetType: "style",
    name: "Style Ninja-Félin",
    description: "Animation 3D stylisée, ombres marquées",
  }, "test");
  const styleId = (await store.decide(styleProposal.id, "approve")).approval.result.entityId;
  const characterProposal = await store.propose("create_asset", {
    assetType: "character",
    name: "Shadow",
    description: "Chat noir au foulard rouge",
  }, "test");
  const characterId = (await store.decide(characterProposal.id, "approve")).approval.result.entityId;
  const shotProposal = await store.propose("create_shot", {
    title: "L'approche furtive",
    description: "Shadow se faufile entre les dossiers. Style animation 3D dynamique.",
    durationMs: 4_000,
    assetIds: [characterId],
  }, "test");
  const shotId = (await store.decide(shotProposal.id, "approve")).approval.result.entityId;
  try {
    await withServer(mockConfig, async (baseUrl) => {
      // Sans référence, la direction textuelle reste la seule source.
      const noReference = await fetch(`${baseUrl}/api/shots/${shotId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE" }),
      });
      const noReferenceBody = await noReference.json();
      assert.equal(noReferenceBody.referencesUsed, 0);
      assert.match(noReferenceBody.media.prompt, /Style animation 3D dynamique/i);

      // La planche du personnage hérite du style validé du film.
      const sheet = await fetch(`${baseUrl}/api/assets/${characterId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE", purpose: "character_consistency" }),
      });
      assert.equal(sheet.status, 201);
      assert.match((await sheet.json()).media.prompt, /Animation 3D stylisée/i);

      // Avec une référence, l'image fait autorité et la mention de style disparaît du texte.
      const withReference = await fetch(`${baseUrl}/api/shots/${shotId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE" }),
      });
      const withReferenceBody = await withReference.json();
      assert.equal(withReferenceBody.referencesUsed, 1);
      assert.match(withReferenceBody.media.prompt, /font autorité/i);
      assert.match(withReferenceBody.media.prompt, /se faufile entre les dossiers/i);
      assert.doesNotMatch(withReferenceBody.media.prompt, /Action :.*Style animation 3D/i);
      assert.ok(styleId);
    }, { store, mediaDir });
  } finally {
    await rm(mediaDir, { recursive: true, force: true });
  }
});

test("google image adapter forwards reference images before the prompt", async () => {
  let observed;
  const fetchImpl = async (url, options) => {
    observed = { url, options };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from("img").toString("base64") } }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  await callGeminiImage({
    config: { ...mockConfig, mode: "google", apiKey: "secret" },
    asset: { name: "Shadow", description: "Chat noir" },
    imageRequest: { prompt: "Frame", aspectRatio: "16:9", imageSize: "1K" },
    referenceImages: [{ mimeType: "image/jpeg", data: "AAAA" }],
    fetchImpl,
  });
  const parts = JSON.parse(observed.options.body).contents[0].parts;
  assert.equal(parts.length, 2);
  assert.equal(parts[0].inlineData.mimeType, "image/jpeg");
  assert.equal(parts[1].text, "Frame");
});

test("google image adapter requests IMAGE output and accepts inline data", async () => {
  let observed;
  const imageBytes = Buffer.from("fake-png");
  const fetchImpl = async (url, options) => {
    observed = { url, options };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: imageBytes.toString("base64") } }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await callGeminiImage({
    config: { ...mockConfig, mode: "google", apiKey: "image-secret" },
    asset: { name: "Nora", description: "Exploratrice" },
    imageRequest: { prompt: "Planche", aspectRatio: "16:9", imageSize: "1K" },
    fetchImpl,
  });
  const requestBody = JSON.parse(observed.options.body);
  assert.match(observed.url, /gemini-3\.1-flash-image:generateContent$/);
  assert.deepEqual(requestBody.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
  assert.equal(requestBody.generationConfig.imageConfig.aspectRatio, "16:9");
  assert.equal(requestBody.generationConfig.imageConfig.imageSize, "1K");
  assert.equal(requestBody.generationConfig.responseFormat, undefined);
  assert.equal(observed.options.headers["x-goog-api-key"], "image-secret");
  assert.deepEqual(result.bytes, imageBytes);
});

test("mock chat is deterministic and scoped by tab", async () => {
  await withServer(mockConfig, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: "script", message: "Raccourcis la scène 03." }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, "mock");
    assert.match(body.text, /structure narrative/i);
  });
});

test("chat rejects invalid tabs and malformed input", async () => {
  await withServer(mockConfig, async (baseUrl) => {
    const invalidTab = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: "admin", message: "test" }),
    });
    assert.equal(invalidTab.status, 400);

    const invalidJson = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(invalidJson.status, 400);

    const wrongType = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "test",
    });
    assert.equal(wrongType.status, 415);
  });
});

test("google mode forwards the key only to Google and returns usage", async () => {
  let observed;
  const fetchImpl = async (url, options) => {
    observed = { url, options };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Réponse Gemini contrôlée." }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, totalTokenCount: 17 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const config = { ...mockConfig, mode: "google", apiKey: "test-secret" };
  await withServer(config, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: "projet", message: "Propose une palette." }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.text, "Réponse Gemini contrôlée.");
    assert.deepEqual(body.usage, { promptTokens: 12, outputTokens: 5, totalTokens: 17 });
    assert.match(observed.url, /gemini-3\.5-flash:generateContent$/);
    assert.equal(observed.options.headers["x-goog-api-key"], "test-secret");
    assert.equal(JSON.stringify(body).includes("test-secret"), false);
  }, { fetchImpl });
});

test("workflow continuation forces structured Gemini function calls", async () => {
  let observedBody;
  const fetchImpl = async (_url, options) => {
    observedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [
        { functionCall: { name: "create_sequence", args: { title: "Suite structurée" } } },
      ] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const store = createProductionStore({ persist: false });
  const projectProposal = await store.propose("set_project", { title: "Projet cadré" }, "test");
  await store.decide(projectProposal.id, "approve");
  const config = { ...mockConfig, mode: "google", apiKey: "test-secret" };
  await withServer(config, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tab: "projet",
        message: "Continue le workflow.",
        workflowContinuation: true,
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(observedBody.toolConfig.functionCallingConfig.mode, "ANY");
    assert.equal(body.proposals.length, 1);
    assert.match(body.text, /proposition.*validation/i);
  }, { fetchImpl, store });
});

test("upstream errors stay actionable without leaking provider details", async () => {
  const fetchImpl = async () => new Response("sensitive provider detail", { status: 403 });
  const config = { ...mockConfig, mode: "google", apiKey: "test-secret" };
  await withServer(config, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: "projet", message: "test" }),
    });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.match(body.error, /clé|modèle|facturation/i);
    assert.equal(JSON.stringify(body).includes("sensitive provider detail"), false);
    assert.equal(JSON.stringify(body).includes("test-secret"), false);
  }, { fetchImpl });
});

test("invalid successful upstream payload becomes a sanitized 502", async () => {
  const fetchImpl = async () => new Response("not-json", { status: 200 });
  const config = { ...mockConfig, mode: "google", apiKey: "test-secret" };
  await withServer(config, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: "projet", message: "test" }),
    });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.match(body.error, /réponse illisible/i);
    assert.equal(JSON.stringify(body).includes("not-json"), false);
  }, { fetchImpl });
});

test("encoded Windows traversal cannot escape the static directory", async () => {
  await withServer(mockConfig, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/%2e%2e%5cserver.mjs`);
    assert.equal(response.status, 403);
    assert.equal((await response.text()).includes("GEMINI_API_KEY"), false);
  });
});

test("serves the canonical Odyssey UI with restrictive headers", async () => {
  await withServer(mockConfig, async (baseUrl) => {
    const response = await fetch(baseUrl);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /connect-src 'self'/);
    assert.match(await response.text(), /CinemAI (?:&mdash;|—) Odyssey/);
  });
});

test("serves the coded LLM home experience", async () => {
  await withServer(mockConfig, async (baseUrl) => {
    const [bridgeResponse, styleResponse] = await Promise.all([
      fetch(`${baseUrl}/workspace-bridge.js`),
      fetch(`${baseUrl}/workspace-bridge.css`),
    ]);
    assert.equal(bridgeResponse.status, 200);
    assert.equal(styleResponse.status, 200);
    assert.match(await bridgeResponse.text(), /Tout le studio à portée de prompt/);
    assert.match(await styleResponse.text(), /\.home-thread-welcome/);
    const htmlResponse = await fetch(baseUrl);
    const html = await htmlResponse.text();
    assert.match(html, /continueWorkflow/);
    assert.match(html, /set\(0\);[\s\S]*var dragging/, "the left workspace starts collapsed");
  });
});

test("assistant function calls become pending proposals before mutation", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [
      { text: "Je prépare le projet." },
      { functionCall: { name: "set_project", args: { title: "Projet test", brief: "Brief test" } } },
    ] } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const store = createProductionStore({ persist: false });
  const config = { ...mockConfig, mode: "google", apiKey: "test-secret" };
  await withServer(config, async (baseUrl) => {
    const chat = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: "projet", message: "Prépare mon projet." }),
    });
    assert.equal(chat.status, 200);
    const chatBody = await chat.json();
    assert.equal(chatBody.proposals.length, 1);
    assert.equal(chatBody.manifest.project.id, null);

    const decision = await fetch(`${baseUrl}/api/approvals/${chatBody.proposals[0].id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approve" }),
    });
    assert.equal(decision.status, 200);
    assert.equal((await decision.json()).manifest.project.title, "Projet test");
  }, { fetchImpl, store });
});

test("assistant can propose a targeted asset update for human approval", async () => {
  const store = createProductionStore({ persist: false });
  const project = await store.propose("set_project", { title: "Ninja félin" }, "test");
  await store.decide(project.id, "approve");
  const created = await store.propose("create_asset", {
    assetType: "character",
    name: "Shadow",
    description: "Chat ninja au regard sévère.",
  }, "test");
  const assetId = (await store.decide(created.id, "approve")).approval.result.entityId;
  let observedBody;
  const fetchImpl = async (_url, options) => {
    observedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [
        { text: "Je prépare cette correction sans toucher aux images." },
        { functionCall: { name: "update_asset", args: { assetId, description: "Chat ninja au regard plus calme." } } },
      ] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const config = { ...mockConfig, mode: "google", apiKey: "test-secret" };
  await withServer(config, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: "personnages", message: "Adoucis le regard de Shadow." }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.proposals.length, 1);
    assert.equal(body.proposals[0].operation.name, "update_asset");
    assert.equal(store.snapshot().assets[0].description, "Chat ninja au regard sévère.");
    assert.match(observedBody.systemInstruction.parts[0].text, /update_asset/);

    const decision = await fetch(`${baseUrl}/api/approvals/${body.proposals[0].id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approve" }),
    });
    assert.equal(decision.status, 200);
    assert.equal((await decision.json()).manifest.assets[0].description, "Chat ninja au regard plus calme.");
  }, { fetchImpl, store });
});

test("first assistant response exposes only the structured project gate", async () => {
  const calls = [
    { name: "set_project", args: { title: "Projet" } },
    { name: "create_asset", args: { assetType: "character", name: "Personnage" } },
    { name: "create_asset", args: { assetType: "location", name: "Décor" } },
    { name: "create_sequence", args: { title: "Séquence" } },
  ];
  const fetchImpl = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: calls.map((call) => ({ functionCall: call })) } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const store = createProductionStore({ persist: false });
  const config = { ...mockConfig, mode: "google", apiKey: "test-secret" };
  await withServer(config, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: "projet", message: "Prépare le projet." }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.proposals.length, 1);
    assert.equal(body.proposals[0].operation.name, "set_project");
    assert.equal(body.omittedProposalCount, 3);
    assert.equal(body.manifest.approvals.length, 1);
  }, { fetchImpl, store });
});

test("framed projects expose at most three proposals", async () => {
  const calls = [
    { name: "create_asset", args: { assetType: "character", name: "Personnage A" } },
    { name: "create_asset", args: { assetType: "location", name: "Décor A" } },
    { name: "create_sequence", args: { title: "Séquence A" } },
    { name: "create_sequence", args: { title: "Séquence B" } },
  ];
  const fetchImpl = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: calls.map((call) => ({ functionCall: call })) } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const store = createProductionStore({ persist: false });
  const projectProposal = await store.propose("set_project", { title: "Projet cadré" }, "test");
  await store.decide(projectProposal.id, "approve");
  const config = { ...mockConfig, mode: "google", apiKey: "test-secret" };
  await withServer(config, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab: "projet", message: "Poursuis le cadrage." }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.proposals.length, 3);
    assert.equal(body.omittedProposalCount, 1);
  }, { fetchImpl, store });
});

test("workspace reset requires an explicit confirmation", async () => {
  const store = createProductionStore({ persist: false });
  await withServer(mockConfig, async (baseUrl) => {
    const refused = await fetch(`${baseUrl}/api/workspace/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: false }),
    });
    assert.equal(refused.status, 400);
    const accepted = await fetch(`${baseUrl}/api/workspace/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "RESET" }),
    });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).manifest.project.id, null);
  }, { store });
});

test("shot video prompt declares frame roles, duration and spoken lines", () => {
  const shot = {
    title: "Le coup de patte fatal",
    description: "Shadow fait basculer la tasse.",
    dialogue: [{ speaker: "Shadow", line: "Mission accomplie." }],
  };
  const paired = buildShotVideoPrompt({ shot, seconds: 6, hasStart: true, hasEnd: true });
  assert.match(paired, /6 secondes/);
  assert.match(paired, /PREMIÈRE image.*DÉBUT/s);
  assert.match(paired, /SECONDE est la frame de FIN/);
  assert.match(paired, /synchronisation labiale/);
  assert.match(paired, /Mission accomplie/);

  // Sans frame de fin, on n'annonce pas une transition qui n'existe pas.
  const single = buildShotVideoPrompt({ shot, seconds: 4, hasStart: true, hasEnd: false });
  assert.doesNotMatch(single, /frame de FIN/);
  assert.match(single, /frame de DÉBUT/);

  // Un plan muet doit le dire, sinon le modèle improvise des répliques.
  const silent = buildShotVideoPrompt({ shot: { ...shot, dialogue: [] }, seconds: 4, hasStart: true, hasEnd: false });
  assert.match(silent, /Aucun personnage ne parle/);
});

test("omni adapter posts a flat step_list with the prompt before the frames", async () => {
  let observed;
  const fetchImpl = async (url, options) => {
    observed = { url, options };
    return new Response(JSON.stringify({
      status: "completed",
      steps: [
        { type: "thought" },
        { type: "video", content: [{ type: "video", mime_type: "video/mp4", data: Buffer.from("clip").toString("base64") }] },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await callOmniVideo({
    config: { ...mockConfig, mode: "google", apiKey: "omni-secret", omniModel: "gemini-omni-1.1-flash" },
    prompt: "Plan de 4 secondes",
    frames: [
      { mimeType: "image/jpeg", data: "AAAA" },
      { mimeType: "image/jpeg", data: "BBBB" },
    ],
    fetchImpl,
  });
  assert.match(observed.url, /\/v1beta\/interactions$/);
  const body = JSON.parse(observed.options.body);
  assert.equal(body.model, "models/gemini-omni-1.1-flash");
  assert.deepEqual(body.response_modalities, ["video"]);
  // Format step_list : liste plate, pas de role/content.
  assert.equal(body.input.length, 3);
  assert.equal(body.input[0].type, "text");
  assert.equal(body.input[1].type, "image");
  assert.equal(body.input[2].data, "BBBB");
  assert.equal(body.input[0].role, undefined);
  assert.equal(observed.options.headers["x-goog-api-key"], "omni-secret");
  assert.deepEqual(result.bytes, Buffer.from("clip"));
});

test("shot video uses the next shot keyframe only when continuity is continuous", async () => {
  const mediaDir = await mkdtemp(resolve(tmpdir(), "cinemai-video-"));
  const store = createProductionStore({ persist: false });
  const project = await store.propose("set_project", { title: "Ninja félin" }, "test");
  await store.decide(project.id, "approve");
  const makeShot = async (title, continuity, durationMs) => {
    const proposal = await store.propose("create_shot", {
      title, description: `${title} en action.`, durationMs, continuity,
    }, "test");
    return (await store.decide(proposal.id, "approve")).approval.result.entityId;
  };
  const shotA = await makeShot("Approche", "cut", 6_000);
  const shotB = await makeShot("Coup de patte", "cut", 4_000);
  try {
    await withServer(mockConfig, async (baseUrl) => {
      const keyframe = (shotId) => fetch(`${baseUrl}/api/shots/${shotId}/images/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE" }),
      });
      const video = (shotId) => fetch(`${baseUrl}/api/shots/${shotId}/videos/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_VIDEO" }),
      });

      // Sans image de storyboard, l'animation est refusée plutôt qu'inventée.
      const tooEarly = await video(shotA);
      assert.equal(tooEarly.status, 409);

      await keyframe(shotA);
      await keyframe(shotB);

      // Une confirmation explicite reste obligatoire.
      const unconfirmed = await fetch(`${baseUrl}/api/shots/${shotA}/videos/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(unconfirmed.status, 400);

      // Plan suivant en coupe : une seule frame, pas de transition imposée.
      const cut = await video(shotA);
      assert.equal(cut.status, 201);
      const cutBody = await cut.json();
      assert.equal(cutBody.framesUsed, 1);
      assert.equal(cutBody.seconds, 6);
      assert.equal(cutBody.media.kind, "video");
      assert.equal(cutBody.media.mimeType, "video/mp4");

      // Déclarer le plan suivant continu fournit la frame de fin.
      await store.decide((await store.propose("update_shot", {
        shotId: shotB, patch: { continuity: "continuous" },
      }, "test")).id, "approve");
      const continuous = await video(shotA);
      assert.equal(continuous.status, 201);
      assert.equal((await continuous.json()).framesUsed, 2);

      // La durée reste dans les bornes mesurées d'Omni.
      const short = await video(shotB);
      assert.equal((await short.json()).seconds, 4);
    }, { store, mediaDir });
  } finally {
    await rm(mediaDir, { recursive: true, force: true });
  }
});

test("omni video launches in background and polls until the clip is ready", async () => {
  const calls = [];
  let polls = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    if (options.method === "POST") {
      return new Response(JSON.stringify({ id: "v1_abc", status: "in_progress", steps: [] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    polls += 1;
    // Les deux premières interrogations n'ont pas encore la vidéo.
    const body = polls < 3
      ? { id: "v1_abc", status: "in_progress", steps: [{ type: "thought" }] }
      : {
          id: "v1_abc",
          status: "completed",
          steps: [{ type: "video", content: [{ type: "video", mime_type: "video/mp4", data: Buffer.from("clip").toString("base64") }] }],
        };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await callOmniVideo({
    config: { ...mockConfig, mode: "google", apiKey: "k", videoPollIntervalMs: 0, videoMaxWaitMs: 60_000 },
    prompt: "Plan",
    frames: [{ mimeType: "image/jpeg", data: "AAAA" }],
    fetchImpl,
    sleep: async () => {},
  });
  assert.deepEqual(result.bytes, Buffer.from("clip"));
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/interactions$/);
  assert.equal(polls, 3);
  assert.match(calls[1].url, /\/interactions\/v1_abc$/);
});

test("omni video reports upstream failure and polling timeout distinctly", async () => {
  const failing = async (url, options = {}) => new Response(JSON.stringify(
    options.method === "POST"
      ? { id: "v1_x", status: "in_progress", steps: [] }
      : { id: "v1_x", status: "failed", steps: [] },
  ), { status: 200, headers: { "Content-Type": "application/json" } });
  await assert.rejects(
    () => callOmniVideo({
      config: { ...mockConfig, mode: "google", apiKey: "k", videoPollIntervalMs: 0, videoMaxWaitMs: 60_000 },
      prompt: "Plan", frames: [], fetchImpl: failing, sleep: async () => {},
    }),
    /a échoué pendant la génération/,
  );

  const stalling = async (url, options = {}) => new Response(JSON.stringify({ id: "v1_y", status: "in_progress", steps: [] }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
  await assert.rejects(
    () => callOmniVideo({
      config: { ...mockConfig, mode: "google", apiKey: "k", videoPollIntervalMs: 0, videoMaxWaitMs: 0 },
      prompt: "Plan", frames: [], fetchImpl: stalling, sleep: async () => {},
    }),
    /n'a pas abouti dans le délai/,
  );
});

test("a set layout guides geography without becoming the identity reference", async () => {
  const mediaDir = await mkdtemp(resolve(tmpdir(), "cinemai-layout-"));
  const store = createProductionStore({ persist: false });
  const project = await store.propose("set_project", { title: "Ninja félin" }, "test");
  await store.decide(project.id, "approve");
  const assetProposal = await store.propose("create_asset", {
    assetType: "location", name: "Le Bureau", description: "Open space terne",
  }, "test");
  const assetId = (await store.decide(assetProposal.id, "approve")).approval.result.entityId;
  const shotProposal = await store.propose("create_shot", {
    title: "Approche", description: "Shadow traverse le bureau.", durationMs: 4_000, assetIds: [assetId],
  }, "test");
  const shotId = (await store.decide(shotProposal.id, "approve")).approval.result.entityId;
  try {
    await withServer(mockConfig, async (baseUrl) => {
      const generateAsset = (purpose) => fetch(`${baseUrl}/api/assets/${assetId}/images/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE", purpose }),
      }).then((r) => r.json());
      const generateShot = () => fetch(`${baseUrl}/api/shots/${shotId}/images/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE" }),
      }).then((r) => r.json());

      const sheet = await generateAsset("location_consistency");
      assert.equal(sheet.media.purpose, "location_consistency");

      const before = await generateShot();
      assert.equal(before.referencesUsed, 1);
      assert.doesNotMatch(before.media.prompt, /plan de masse/i);

      const layout = await generateAsset("set_layout");
      assert.equal(layout.media.purpose, "set_layout");
      assert.match(layout.media.prompt, /vu strictement du DESSUS/);

      // Le plan de masse s'ajoute aux références sans remplacer la planche du décor.
      const after = await generateShot();
      assert.equal(after.referencesUsed, 2);
      assert.match(after.media.prompt, /plan de masse vu du dessus/i);
      assert.match(after.media.prompt, /ne reproduis jamais la vue du dessus/i);
    }, { store, mediaDir });
  } finally {
    await rm(mediaDir, { recursive: true, force: true });
  }
});

test("a continuous shot chains on the previous clip, then re-anchors on drift", async () => {
  const mediaDir = await mkdtemp(resolve(tmpdir(), "cinemai-chain-"));
  const store = createProductionStore({ persist: false });
  const project = await store.propose("set_project", { title: "Chaîne" }, "test");
  await store.decide(project.id, "approve");
  const makeShot = async (title, continuity) => {
    const proposal = await store.propose("create_shot", {
      title, description: `${title} en action.`, durationMs: 4_000, continuity,
    }, "test");
    return (await store.decide(proposal.id, "approve")).approval.result.entityId;
  };
  const a = await makeShot("Ouverture", "cut");
  const b = await makeShot("Suite", "continuous");
  const c = await makeShot("Fin", "continuous");

  let extractions = 0;
  const extractFrame = async () => {
    extractions += 1;
    return { mimeType: "image/jpeg", data: Buffer.from("frame-extraite").toString("base64") };
  };
  try {
    await withServer(mockConfig, async (baseUrl) => {
      const keyframe = (id) => fetch(`${baseUrl}/api/shots/${id}/images/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_IMAGE" }),
      });
      const video = (id, body = {}) => fetch(`${baseUrl}/api/shots/${id}/videos/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_VIDEO", ...body }),
      }).then((r) => r.json());
      for (const id of [a, b, c]) await keyframe(id);

      // Premier plan : rien à enchaîner, il part de sa propre keyframe.
      const first = await video(a);
      assert.equal(first.startFrom, "keyframe");
      assert.equal(first.chainDepth, 0);
      assert.equal(first.reanchored, false);
      assert.equal(extractions, 0);

      // Plan continu suivant un plan animé : on repart de la dernière image du clip.
      const second = await video(b);
      assert.equal(second.startFrom, "chain");
      assert.equal(second.chainDepth, 1);
      assert.equal(extractions, 1);
      assert.match(second.media.prompt, /dernière image du plan précédent/);

      // Demander explicitement un ré-ancrage repasse par la keyframe.
      const forced = await video(b, { reanchor: true });
      assert.equal(forced.startFrom, "keyframe");
      assert.equal(forced.reanchored, true);
      assert.doesNotMatch(forced.media.prompt, /dernière image du plan précédent/);
    }, { store, mediaDir, extractFrame });
  } finally {
    await rm(mediaDir, { recursive: true, force: true });
  }
});

test("chaining falls back to the keyframe when frame extraction is unavailable", async () => {
  const mediaDir = await mkdtemp(resolve(tmpdir(), "cinemai-nochain-"));
  const store = createProductionStore({ persist: false });
  const project = await store.propose("set_project", { title: "Sans Swift" }, "test");
  await store.decide(project.id, "approve");
  const mk = async (title, continuity) => {
    const proposal = await store.propose("create_shot", {
      title, description: `${title}.`, durationMs: 4_000, continuity,
    }, "test");
    return (await store.decide(proposal.id, "approve")).approval.result.entityId;
  };
  const a = await mk("Un", "cut");
  const b = await mk("Deux", "continuous");
  try {
    await withServer(mockConfig, async (baseUrl) => {
      for (const id of [a, b]) {
        await fetch(`${baseUrl}/api/shots/${id}/images/generate`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: "GENERATE_IMAGE" }),
        });
      }
      await fetch(`${baseUrl}/api/shots/${a}/videos/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_VIDEO" }),
      });
      const chained = await fetch(`${baseUrl}/api/shots/${b}/videos/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "GENERATE_VIDEO" }),
      }).then((r) => r.json());
      // L'extracteur absent ne doit pas faire échouer la génération.
      assert.equal(chained.startFrom, "keyframe");
      assert.equal(chained.media.kind, "video");
    }, { store, mediaDir, extractFrame: async () => null });
  } finally {
    await rm(mediaDir, { recursive: true, force: true });
  }
});

test("chain depth stops at a cut and at an unanimated shot", async () => {
  const shots = [
    { id: "s1", continuity: "cut" },
    { id: "s2", continuity: "continuous" },
    { id: "s3", continuity: "continuous" },
    { id: "s4", continuity: "cut" },
    { id: "s5", continuity: "continuous" },
  ];
  const clip = (targetId) => ({ targetType: "shot", targetId, kind: "video", status: "ready" });
  const full = { media: [clip("s1"), clip("s2"), clip("s3"), clip("s4")] };
  assert.equal(chainDepthBefore(full, shots, 0), 0);
  assert.equal(chainDepthBefore(full, shots, 2), 2);
  // Une coupe interrompt la chaîne même si les plans précédents sont animés.
  assert.equal(chainDepthBefore(full, shots, 3), 0);
  assert.equal(chainDepthBefore(full, shots, 4), 1);
  // Un plan précédent non animé interrompt aussi la chaîne.
  assert.equal(chainDepthBefore({ media: [clip("s1")] }, shots, 2), 0);
});

test("frame extraction prefers ffmpeg, falls back to the macOS tool, else gives up", () => {
  // ffmpeg disponible : c'est lui qui gagne, même si l'outil Swift existe.
  const withFfmpeg = frameExtractorCommand("/clip.mp4", "/out.jpg", { ffmpegPath: "/usr/bin/ffmpeg", hasSwiftTool: true });
  assert.equal(withFfmpeg.file, "/usr/bin/ffmpeg");
  assert.ok(withFfmpeg.args.includes("-sseof"), "doit reculer depuis la fin du fichier");
  assert.equal(withFfmpeg.args.at(-1), "/out.jpg");
  assert.ok(withFfmpeg.args.includes("/clip.mp4"));

  // Sans ffmpeg, l'outil macOS prend le relais en développement.
  const swiftOnly = frameExtractorCommand("/clip.mp4", "/out.jpg", { hasSwiftTool: true });
  assert.match(swiftOnly.file, /tools\/extract-frame$/);
  assert.deepEqual(swiftOnly.args, ["/clip.mp4", "/out.jpg"]);

  // Aucun des deux : on renvoie null pour retomber sur la keyframe.
  assert.equal(frameExtractorCommand("/clip.mp4", "/out.jpg", {}), null);
});
