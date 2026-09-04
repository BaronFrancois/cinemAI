// Client MCP minimal, en stdio, sans dépendance.
//
// Le concours exige que l'agent lise ClickHouse *à travers* le serveur MCP
// officiel (mcp-clickhouse), et non par un accès direct. Ce client parle le
// JSON-RPC 2.0 du protocole, en messages délimités par des sauts de ligne.

import { spawn } from "node:child_process";

const PROTOCOL_VERSION = "2025-06-18";

export function clickhouseMcpEnv(config) {
  const url = new URL(config.url);
  return {
    CLICKHOUSE_HOST: url.hostname,
    CLICKHOUSE_PORT: url.port || "8443",
    CLICKHOUSE_USER: config.user,
    CLICKHOUSE_PASSWORD: config.password,
    CLICKHOUSE_DATABASE: config.database,
    CLICKHOUSE_SECURE: "true",
  };
}

export function createMcpClient({
  command = "uvx",
  args = ["--from", "mcp-clickhouse", "mcp-clickhouse"],
  env = {},
  spawnImpl = spawn,
  timeoutMs = 60_000,
  logger = console,
} = {}) {
  let child = null;
  let nextId = 1;
  let buffer = "";
  const pending = new Map();

  function handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return; // Le serveur écrit aussi des bannières sur stdout : on les ignore.
    }
    if (message.id === undefined || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timer);
    if (message.error) reject(Object.assign(new Error(message.error.message || "Erreur MCP."), { status: 502 }));
    else resolve(message.result);
  }

  function send(method, params, { notify = false } = {}) {
    if (!child) throw Object.assign(new Error("Le serveur MCP n'est pas démarré."), { status: 500 });
    if (notify) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
      return Promise.resolve();
    }
    const id = nextId++;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Object.assign(new Error(`Le serveur MCP n'a pas répondu à ${method}.`), { status: 504 }));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return promise;
  }

  return {
    get running() {
      return Boolean(child);
    },

    async start() {
      if (child) return;
      child = spawnImpl(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...env },
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) handleLine(line);
      });
      child.stderr?.setEncoding?.("utf8");
      child.on("exit", (code) => {
        child = null;
        for (const { reject, timer } of pending.values()) {
          clearTimeout(timer);
          reject(new Error(`Le serveur MCP s'est arrêté (code ${code}).`));
        }
        pending.clear();
      });

      await send("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "cinemai", version: "0.1.0" },
      });
      await send("notifications/initialized", {}, { notify: true });
      logger.info?.("Serveur MCP ClickHouse démarré.");
    },

    async listTools() {
      const result = await send("tools/list", {});
      return result?.tools || [];
    },

    async callTool(name, args = {}) {
      const result = await send("tools/call", { name, arguments: args });
      // Le contenu MCP est une liste de blocs ; on ne garde que le texte.
      const text = (result?.content || [])
        .filter((block) => block?.type === "text")
        .map((block) => block.text)
        .join("\n");
      return { text, isError: Boolean(result?.isError) };
    },

    async stop() {
      if (!child) return;
      const current = child;
      child = null;
      current.stdin.end();
      current.kill();
    },
  };
}
