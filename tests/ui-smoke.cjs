const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.CINEMAI_TEST_URL || "http://127.0.0.1:4175";
const tabs = ["projet", "script", "production", "personnages", "decors", "export"];

async function exerciseViewport(browser, name, viewport, useButton) {
  const page = await browser.newPage({ viewport });
  const consoleErrors = [];
  const externalRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (!request.url().startsWith(baseUrl)) externalRequests.push(request.url());
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  for (const tab of tabs) {
    await page.locator(`.rail-item[data-tab="${tab}"]`).click();
    const input = page.locator("#composer-input");
    await input.fill(`Vérification ${name} ${tab}`);
    if (useButton) await page.locator(".composer .send").click();
    else await input.press("Enter");
    const thread = page.locator(`[data-thread="${tab}"]`);
    await thread.locator(".chat-source", { hasText: "Simulation locale" }).last().waitFor();
    await assert.doesNotReject(() => page.locator(".composer .send").isEnabled());
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(overflow, false, `${name}: débordement horizontal`);
  assert.deepEqual(consoleErrors, [], `${name}: erreurs console`);
  assert.deepEqual(externalRequests, [], `${name}: requêtes externes`);
  await page.screenshot({ path: `tests/cinemai-gemini-mock-${name}.png`, fullPage: true });
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await exerciseViewport(browser, "desktop", { width: 1440, height: 1000 }, false);
    await exerciseViewport(browser, "mobile", { width: 390, height: 844 }, true);
    console.log("UI smoke: desktop + mobile, 6 onglets, clavier + bouton OK");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
