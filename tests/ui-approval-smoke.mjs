import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createCinemaiServer } from "../server.mjs";
import { createProductionStore } from "../production-store.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const config = {
  mode: "mock",
  host: "127.0.0.1",
  port: 0,
  model: "gemini-3.5-flash",
  apiKey: "",
  requestTimeoutMs: 1_000,
};

const store = createProductionStore({ persist: false });
const server = createCinemaiServer({ config, store, logger: { info() {}, warn() {} } });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const proposalResponse = await fetch(`${baseUrl}/api/operations/propose`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "set_project", args: { title: "Contrat UI" } }),
});
assert.equal(proposalResponse.status, 201);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  assert.equal(await page.locator("#project-title").textContent(), "Projet sans titre");
  await page.locator('[data-decision="approve"]').click();
  await page.locator("#project-title", { hasText: "Contrat UI" }).waitFor();
  assert.equal(store.snapshot().project.title, "Contrat UI");

  let proposal = await store.propose("create_asset", { assetType: "character", name: "Asset test" }, "test");
  await store.decide(proposal.id, "approve");
  proposal = await store.propose("create_sequence", { title: "Séquence test" }, "test");
  const sequence = (await store.decide(proposal.id, "approve")).approval.result.entityId;
  proposal = await store.propose("create_shot", { sequenceId: sequence, title: "Plan test", description: "Contrat visuel", durationMs: 2_000 }, "test");
  const shot = (await store.decide(proposal.id, "approve")).approval.result.entityId;
  proposal = await store.propose("add_timeline_clip", { shotId: shot, startMs: 0, durationMs: 2_000 }, "test");
  await store.decide(proposal.id, "approve");
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-tab="personnages"]').click();
  await page.locator("#workspace", { hasText: "Asset test" }).waitFor();
  await page.locator('[data-tab="script"]').click();
  await page.locator("#workspace", { hasText: "2 s" }).waitFor();
  await page.locator('[data-tab="production"]').click();
  await page.locator("#workspace", { hasText: "2 s" }).waitFor();
  console.log("UI approval smoke: gate humain, assets, plans et durée canonique OK");
} finally {
  await browser.close();
  server.close();
  await once(server, "close");
}
