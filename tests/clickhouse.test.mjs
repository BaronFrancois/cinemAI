import test from "node:test";
import assert from "node:assert/strict";
import {
  approvalRows,
  clickhouseConfig,
  createClickhouseClient,
  eventRows,
  mediaRows,
} from "../clickhouse.mjs";

test("clickhouse config is optional but refuses an incomplete setup", () => {
  assert.equal(clickhouseConfig({}), null, "sans URL, la télémétrie reste désactivée");
  assert.throws(() => clickhouseConfig({ CLICKHOUSE_URL: "http://x.test" }), /https/);
  assert.throws(() => clickhouseConfig({ CLICKHOUSE_URL: "https://x.test:8443" }), /PASSWORD/);
  const config = clickhouseConfig({
    CLICKHOUSE_URL: "https://x.test:8443/",
    CLICKHOUSE_PASSWORD: "secret",
  });
  assert.equal(config.url, "https://x.test:8443", "la barre finale est retirée");
  assert.equal(config.user, "default");
  assert.equal(config.database, "cinemai");
});

test("the client authenticates by header and inserts rows as JSONEachRow", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response('{"data":[{"n":2}]}', { status: 200 });
  };
  const client = createClickhouseClient({
    config: { url: "https://x.test:8443", user: "default", password: "secret", database: "cinemai" },
    fetchImpl,
  });

  await client.insert("production_events", [{ a: 1 }, { a: 2 }]);
  const insert = calls.at(-1);
  const sqlOf = (value) => new URL(value).searchParams.get("query");
  assert.equal(sqlOf(insert.url), "INSERT INTO production_events FORMAT JSONEachRow");
  assert.match(insert.url, /database=cinemai/);
  assert.equal(insert.options.headers["X-ClickHouse-User"], "default");
  assert.equal(insert.options.headers["X-ClickHouse-Key"], "secret");
  // Une ligne par objet, séparées par des sauts de ligne.
  assert.equal(insert.options.body, '{"a":1}\n{"a":2}');

  const rows = await client.query("SELECT count() AS n FROM production_events");
  assert.deepEqual(rows, [{ n: 2 }]);
  assert.match(sqlOf(calls.at(-1).url), /FORMAT JSON$/);

  // Insérer un tableau vide ne doit produire aucun appel.
  const before = calls.length;
  assert.equal(await client.insert("production_events", []), 0);
  assert.equal(calls.length, before);
});

test("an upstream failure is reported with its detail", async () => {
  const client = createClickhouseClient({
    config: { url: "https://x.test:8443", user: "u", password: "p", database: "d" },
    fetchImpl: async () => new Response("Code: 60. Unknown table", { status: 404 }),
  });
  await assert.rejects(() => client.query("SELECT 1"), /Unknown table/);
});

test("rows are derived from the manifest, not invented", () => {
  const events = eventRows("proj_1", [
    { id: "e1", type: "media_attached", mediaId: "m1", targetType: "shot", targetId: "s1", revision: 4, at: "2026-09-04T10:00:00.000Z" },
  ]);
  assert.equal(events[0].project_id, "proj_1");
  assert.equal(events[0].media_id, "m1");
  assert.equal(events[0].at, "2026-09-04 10:00:00.000");
  // Les champs absents deviennent des chaînes vides, jamais undefined.
  assert.equal(events[0].approval_id, "");

  const media = mediaRows("proj_1", [
    { id: "m1", targetType: "shot", targetId: "s1", kind: "video", purpose: "clip", estimatedCostUsd: 0.067, version: 2, status: "approved", createdAt: "2026-09-04T10:00:00.000Z" },
  ], { m1: { seconds: 4, framesUsed: 2, startFrom: "chain", chainDepth: 3, reanchored: true } });
  assert.equal(media[0].cost_usd, 0.067);
  assert.equal(media[0].chain_depth, 3);
  assert.equal(media[0].reanchored, 1, "ClickHouse n'a pas de booléen natif ici");

  const approvals = approvalRows("proj_1", [
    { id: "a1", operation: { name: "create_shot" }, source: "assistant", status: "applied", createdAt: "2026-09-04T10:00:00.000Z", decidedAt: "2026-09-04T10:00:12.000Z" },
    { id: "a2", operation: { name: "create_shot" }, source: "assistant", status: "pending", createdAt: "2026-09-04T10:00:00.000Z", decidedAt: null },
  ]);
  // La latence de décision mesure la friction humaine, cœur du sujet.
  assert.equal(approvals[0].decision_ms, 12_000);
  assert.equal(approvals[1].decision_ms, null);
});

test("telemetry is incremental, resends changed approvals, and never breaks production", async () => {
  const inserts = [];
  const client = {
    async ensureSchema() { inserts.push(["schema"]); },
    async insert(table, rows) { if (rows.length) inserts.push([table, rows.length]); return rows.length; },
  };
  const { createTelemetry } = await import("../telemetry.mjs");
  const telemetry = createTelemetry({ client });

  const snapshot = {
    project: { id: "proj_1" },
    activity: [{ id: "e1", type: "operation_proposed", at: "2026-09-04T10:00:00Z" }],
    media: [{ id: "m1", kind: "image", createdAt: "2026-09-04T10:00:00Z" }],
    approvals: [{ id: "a1", status: "pending", operation: { name: "create_shot" }, createdAt: "2026-09-04T10:00:00Z" }],
  };
  const first = await telemetry.sync(snapshot);
  assert.deepEqual(first, { events: 1, media: 1, approvals: 1 });
  assert.deepEqual(inserts[0], ["schema"]);

  // Rien de neuf : aucune insertion, et le schéma n'est créé qu'une fois.
  const unchanged = await telemetry.sync(snapshot);
  assert.deepEqual(unchanged, { events: 0, media: 0, approvals: 0 });
  assert.equal(inserts.filter((i) => i[0] === "schema").length, 1);

  // La décision humaine change le statut : la proposition doit repartir.
  snapshot.approvals[0].status = "applied";
  snapshot.activity.push({ id: "e2", type: "operation_applied", at: "2026-09-04T10:00:05Z" });
  const after = await telemetry.sync(snapshot);
  assert.deepEqual(after, { events: 1, media: 0, approvals: 1 });

  // Une panne ClickHouse est absorbée, pas propagée.
  const broken = createTelemetry({
    client: { async ensureSchema() { throw new Error("cluster injoignable"); }, async insert() {} },
    logger: { warn() {} },
  });
  const failed = await broken.sync(snapshot);
  assert.equal(failed.error, "cluster injoignable");
  assert.equal(failed.events, 0);
});

test("telemetry stays inert without a project or without clickhouse", async () => {
  const { createTelemetry } = await import("../telemetry.mjs");
  const disabled = createTelemetry({});
  assert.equal(disabled.enabled, false);
  assert.deepEqual(await disabled.sync({ project: { id: "p" } }), { events: 0, media: 0, approvals: 0 });

  let touched = false;
  const telemetry = createTelemetry({ client: { async ensureSchema() { touched = true; }, async insert() {} } });
  // Sans projet cadré, il n'y a rien à mesurer.
  await telemetry.sync({ project: {} });
  assert.equal(touched, false);
});
