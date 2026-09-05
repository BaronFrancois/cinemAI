// Run with Playwright on NODE_PATH; uses an isolated, provider-free server.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { once } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');

(async () => {
  const { createCinemaiServer } = await import(pathToFileURL(resolve(__dirname, '../server.mjs')));
  const { createProductionStore } = await import(pathToFileURL(resolve(__dirname, '../production-store.mjs')));
  const browser = await chromium.launch({ channel: process.env.CINEMAI_BROWSER_CHANNEL || 'chrome', headless: true });
  const output = process.env.CINEMAI_SCREENSHOT_DIR || await mkdtemp(resolve(tmpdir(), 'cinemai-narrative-ui-'));
  try {
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      const store = createProductionStore({ persist: false });
      const approve = async (operation, args) => store.decide((await store.propose(operation, args)).id, 'approve');
      await approve('set_project', { title: 'Continuité — test isolé', durationSeconds: 8 });
      const assetId = (await approve('create_asset', { assetType: 'prop', name: 'Tasse' })).approval.result.entityId;
      const facts = (before, after) => [{ assetId, property: 'position', before, after }];
      await approve('create_shot', { title: 'Plan 3 — Poser la tasse', description: 'Elle pose la tasse sur le bureau.', durationMs: 4000, assetIds: [assetId], narrativeStates: facts('en main', 'sur le bureau') });
      const shotId = (await approve('create_shot', { title: 'Plan 4 — Boire', description: 'Elle reprend la tasse et boit.', durationMs: 4000, assetIds: [assetId], narrativeStates: facts('en main', 'en main'), narrativeTransition: 'direct' })).approval.result.entityId;
      await store.propose('update_shot', { shotId, patch: { narrativeStates: facts('sur le bureau', 'en main'), narrativeTransition: 'direct' } });
      const mediaDir = await mkdtemp(resolve(tmpdir(), 'cinemai-narrative-media-'));
      const server = createCinemaiServer({ config: { mode: 'mock', model: 'offline', apiKey: '', requestTimeoutMs: 1000 }, store, mediaDir, fetchImpl: () => { throw new Error('Provider access forbidden in UI test'); }, logger: { info() {}, warn() {} } });
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      const base = `http://127.0.0.1:${server.address().port}`;
      const page = await browser.newPage({ viewport: { width, height } });
      try {
        const errors = [], writes = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('request', request => { if (request.url().includes('/api/chat') || request.url().includes('/generate')) writes.push(request.url()); });
        await page.goto(base, { waitUntil: 'networkidle' });
        await page.getByText('Continuité narrative proposée', { exact: true }).waitFor();
        await page.locator('.project-workflow [data-context-tab="script"]:visible').click();
        await page.getByText('États déclarés incompatibles', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Préparer une correction', exact: true }).click();
        assert.ok((await page.locator('#composer-input').innerText()).includes('sur le bureau'));
        assert.deepEqual(writes, []);
        await page.locator(`.storyboard-tile [data-edit-shot="${shotId}"]`).click();
        await page.locator('[data-state-field="before"]').fill('sur le bureau');
        await page.locator('[data-storyboard-overview]').click();
        await page.locator(`.storyboard-tile [data-edit-shot="${shotId}"]`).click();
        assert.equal(await page.locator('[data-state-field="before"]').inputValue(), 'sur le bureau');
        await page.getByRole('button', { name: 'Enregistrer le texte', exact: true }).click();
        await page.locator('[data-shot-save-status]', { hasText: 'Texte enregistré' }).waitFor();
        await page.waitForFunction(() => !document.querySelector('[data-storyboard-review]')?.textContent.includes('États déclarés incompatibles') && document.querySelector('.narrative-coverage'));
        assert.equal(store.snapshot().shots[1].version, 2);
        assert.equal(store.snapshot().shots[1].narrativeStates[0].before, 'sur le bureau');
        // Restoring the earlier version must restore its states and the finding.
        await page.locator('.storyboard-history summary').click();
        await page.locator('[data-restore-version]').click();
        await page.getByText('États déclarés incompatibles', { exact: true }).waitFor();
        assert.equal(store.snapshot().shots[1].version, 3);
        assert.equal(await page.locator('[data-state-field="before"]').inputValue(), 'en main');
        // Add a row, preserve it in the draft, then remove it without losing fields.
        await page.getByRole('button', { name: 'Ajouter un état', exact: true }).click();
        const row = page.locator('[data-narrative-state]').last();
        await row.locator('select').selectOption(assetId);
        await row.locator('[data-state-field="property"]').fill('contenu');
        await row.locator('[data-state-field="before"]').fill('café');
        await row.locator('[data-state-field="after"]').fill('vide');
        await row.getByRole('button', { name: 'Retirer cet état' }).click();
        assert.equal(await page.locator('[data-narrative-state]').count(), 1);
        await page.locator('[name="narrativeTransition"]').selectOption('ellipsis');
        await page.getByRole('button', { name: 'Enregistrer le texte', exact: true }).click();
        await page.locator('[data-shot-save-status]', { hasText: 'Texte enregistré' }).waitFor();
        assert.equal(store.snapshot().shots[1].version, 4);
        assert.equal(store.snapshot().shots[1].narrativeTransition, 'ellipsis');
        await page.locator('.narrative-fields').scrollIntoViewIfNeeded();
        await page.screenshot({ path: resolve(output, `narrative-${name}.png`), fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        console.log(`${name}: correction draft, save, restore, state rows and ellipsis verified`);
      } finally {
        await page.close(); server.close(); await once(server, 'close'); await rm(mediaDir, { recursive: true, force: true });
      }
    }
    console.log('Screenshots:', output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
