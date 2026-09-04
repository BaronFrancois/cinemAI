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
  body: JSON.stringify({ name: "set_project", args: { title: "Contrat UI", aspectRatio: "16:9", durationSeconds: 8 } }),
});
assert.equal(proposalResponse.status, 201);
const duplicateResponse = await fetch(`${baseUrl}/api/operations/propose`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "set_project", args: { title: "Contrat UI", aspectRatio: "16:9", durationSeconds: 8 } }),
});
assert.equal(duplicateResponse.status, 201);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator('.project-context-head h1', { hasText: "Nouveau projet" }).waitFor();
  assert.equal(await page.locator(".bridge-choice").count(), 1);
  await page.locator('[data-choice-field="aspectRatio"]').selectOption("9:16");
  await page.locator('[data-choice-field="durationSeconds"]').selectOption("4");
  await page.locator('[data-choice="approve"]').click();
  await page.locator('.project-context-head h1', { hasText: "Contrat UI" }).waitFor();
  assert.equal(store.snapshot().project.title, "Contrat UI");
  assert.equal(store.snapshot().project.aspectRatio, "9:16");
  assert.equal(store.snapshot().project.durationSeconds, 4);

  let proposal = await store.propose("create_asset", { assetType: "character", name: "Asset test" }, "test");
  await store.decide(proposal.id, "approve");
  proposal = await store.propose("create_sequence", { title: "Séquence test" }, "test");
  const sequence = (await store.decide(proposal.id, "approve")).approval.result.entityId;
  proposal = await store.propose("create_shot", { sequenceId: sequence, title: "Plan test", description: "Contrat visuel", durationMs: 2_000 }, "test");
  const shot = (await store.decide(proposal.id, "approve")).approval.result.entityId;
  proposal = await store.propose("add_timeline_clip", { shotId: shot, startMs: 0, durationMs: 2_000 }, "test");
  await store.decide(proposal.id, "approve");
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('.project-workflow [data-context-tab="personnages"]').click();
  await page.locator('.panes-host > [data-tab="personnages"]', { hasText: "Asset test" }).waitFor();
  await page.locator('[data-open-asset]').click();
  assert.equal(await page.locator('[data-select-variant]').count(), 11);
  assert.equal(await page.locator('#composer-input').isVisible(), true);
  await page.locator('[data-workspace-split="50"]').click();
  assert.equal(await page.locator('[data-workspace-resize]').getAttribute('aria-valuenow'), '50');
  await page.locator('[data-workspace-fullscreen]').click();
  assert.equal(await page.locator('[data-chat-dock]').isVisible(), false);
  await page.locator('[data-workspace-fullscreen]').click();
  assert.equal(await page.locator('[data-chat-dock]').isVisible(), true);
  await page.locator('.project-workflow [data-context-tab="script"]').click();
  await page.locator('.panes-host > [data-tab="script"]', { hasText: "2 s" }).waitFor();
  await page.locator('.project-workflow [data-context-tab="production"]').click();
  await page.locator('.panes-host > [data-tab="production"]', { hasText: "2 s" }).waitFor();
  await page.locator('.project-workflow [data-context-tab="export"]').click();
  assert.equal(await page.locator('.export-option').count(), 13);
  console.log("UI approval smoke: gate humain, assets, plans et durée canonique OK");
} finally {
  await browser.close();
  server.close();
  await once(server, "close");
}
