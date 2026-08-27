import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { buildConfig, createCinemaiServer } from "../server.mjs";

async function withServer(config, run, options = {}) {
  const server = createCinemaiServer({
    config,
    fetchImpl: options.fetchImpl,
    logger: { info() {}, warn() {} },
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
    assert.match(body.text, /séquence active/i);
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
    assert.match(await response.text(), /CinemAI &mdash; Odyssey/);
  });
});
