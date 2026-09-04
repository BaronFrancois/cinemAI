import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { clickhouseMcpEnv, createMcpClient } from "../mcp-client.mjs";

// Faux serveur MCP : répond aux requêtes JSON-RPC ligne par ligne.
function fakeServer(handler) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => child.emit("exit", 0);
  let buffer = "";
  child.stdin.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const reply = handler(message);
      if (reply) child.stdout.write(`${JSON.stringify(reply)}\n`);
    }
  });
  return child;
}

test("clickhouse credentials become the MCP server environment", () => {
  const env = clickhouseMcpEnv({
    url: "https://abc.europe.clickhouse.cloud:8443",
    user: "default",
    password: "secret",
    database: "cinemai",
  });
  assert.equal(env.CLICKHOUSE_HOST, "abc.europe.clickhouse.cloud");
  assert.equal(env.CLICKHOUSE_PORT, "8443");
  assert.equal(env.CLICKHOUSE_SECURE, "true");
  assert.equal(env.CLICKHOUSE_PASSWORD, "secret");
});

test("the client handshakes, lists tools and reads text blocks", async () => {
  const seen = [];
  const child = fakeServer((message) => {
    seen.push(message.method);
    if (message.method === "initialize") {
      return { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18" } };
    }
    if (message.method === "notifications/initialized") return null;
    if (message.method === "tools/list") {
      return { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "run_query", description: "Execute SQL" }] } };
    }
    if (message.method === "tools/call") {
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: '{"rows":[[1]]}' }, { type: "image", data: "ignore" }] },
      };
    }
    return { jsonrpc: "2.0", id: message.id, error: { message: "méthode inconnue" } };
  });
  const client = createMcpClient({ spawnImpl: () => child, logger: { info() {} } });

  await client.start();
  assert.deepEqual(seen, ["initialize", "notifications/initialized"]);
  assert.equal(client.running, true);

  const tools = await client.listTools();
  assert.equal(tools[0].name, "run_query");

  const result = await client.callTool("run_query", { query: "SELECT 1" });
  // Seuls les blocs texte sont conservés.
  assert.equal(result.text, '{"rows":[[1]]}');
  assert.equal(result.isError, false);

  await client.stop();
  assert.equal(client.running, false);
});

test("banner noise on stdout is ignored and errors surface", async () => {
  const child = fakeServer((message) => {
    if (message.method === "initialize") return { jsonrpc: "2.0", id: message.id, result: {} };
    if (message.method === "notifications/initialized") return null;
    return { jsonrpc: "2.0", id: message.id, error: { message: "table inconnue" } };
  });
  const client = createMcpClient({ spawnImpl: () => child, logger: { info() {} } });
  await client.start();
  // FastMCP écrit une bannière : elle ne doit pas casser le parseur.
  child.stdout.write("╭─── FastMCP 4.0.2 ───╮\n");
  await assert.rejects(() => client.callTool("run_query", {}), /table inconnue/);
  await client.stop();
});

test("a crashed server rejects the calls still waiting", async () => {
  const child = fakeServer((message) => {
    if (message.method === "initialize") return { jsonrpc: "2.0", id: message.id, result: {} };
    return null; // ne répond jamais aux appels suivants
  });
  const client = createMcpClient({ spawnImpl: () => child, logger: { info() {} } });
  await client.start();
  const pending = client.callTool("run_query", { query: "SELECT 1" });
  child.emit("exit", 1);
  await assert.rejects(() => pending, /s'est arrêté/);
});
