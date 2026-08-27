import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATIC_DIR = resolve(PROJECT_ROOT, "mockups", "odyssey-workspace");
const ALLOWED_TABS = new Set([
  "projet",
  "script",
  "production",
  "personnages",
  "decors",
  "export",
]);
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_HISTORY_ITEMS = 8;

const TAB_CONTEXT = {
  projet: "Le réalisateur travaille sur l'intention, le style visuel, le format et les paramètres globaux du projet.",
  script: "Le réalisateur travaille sur la chronologie narrative, les actes, séquences, scènes et liens vers personnages ou décors.",
  production: "Le réalisateur prépare les plans, cadrages, références, durées et paramètres de génération.",
  personnages: "Le réalisateur définit les personnages, leurs bases visuelles, états et règles de continuité.",
  decors: "Le réalisateur définit les décors, leurs variantes, éclairages et règles de continuité.",
  export: "Le réalisateur contrôle l'assemblage final et les sorties, sans publier automatiquement.",
};

const MOCK_REPLIES = {
  projet: "Mode local : je peux proposer une modification structurée du style, de la palette ou du format.",
  script: "Mode local : je peux préparer une révision limitée à la séquence active sans modifier les actes voisins.",
  production: "Mode local : je peux préparer des variantes de cadrage avant toute génération payante.",
  personnages: "Mode local : je peux proposer un nouvel état en conservant la Base comme référence.",
  decors: "Mode local : je peux isoler les changements d'éclairage ou d'atmosphère sans réécrire l'architecture.",
  export: "Mode local : je peux vérifier les éléments manquants avant de préparer une sortie.",
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export function parseEnv(text) {
  const values = {};
  for (const sourceLine of String(text || "").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export async function loadLocalEnv(envPath = resolve(PROJECT_ROOT, ".env")) {
  try {
    return parseEnv(await readFile(envPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

export function buildConfig(values = {}) {
  const mode = String(values.CINEMAI_LLM_MODE || "mock").toLowerCase();
  if (!new Set(["mock", "google"]).has(mode)) {
    throw new Error("CINEMAI_LLM_MODE doit valoir mock ou google.");
  }
  const host = values.CINEMAI_SERVER_HOST || "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("CINEMAI_SERVER_HOST doit rester local (127.0.0.1 ou localhost).");
  }
  const port = Number(values.CINEMAI_SERVER_PORT || 4175);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("CINEMAI_SERVER_PORT invalide.");
  }
  const apiKey = values.GEMINI_API_KEY || values.GOOGLE_API_KEY || "";
  if (mode === "google" && !apiKey) {
    throw new Error("GEMINI_API_KEY manque pour le mode google.");
  }
  const requestTimeoutMs = Number(values.CINEMAI_LLM_TIMEOUT_MS || 30_000);
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 120_000) {
    throw new Error("CINEMAI_LLM_TIMEOUT_MS doit être compris entre 1000 et 120000.");
  }
  return {
    mode,
    host,
    port,
    model: values.GEMINI_MODEL || "gemini-3.5-flash",
    apiKey,
    requestTimeoutMs,
  };
}

function applySecurityHeaders(response, isApi = false) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  if (isApi) response.setHeader("Cache-Control", "no-store");
}

function sendJson(response, status, payload) {
  applySecurityHeaders(response, true);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const type = String(request.headers["content-type"] || "").split(";", 1)[0].trim();
  if (type !== "application/json") {
    const error = new Error("Le corps doit être envoyé en application/json.");
    error.status = 415;
    throw error;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("La requête dépasse la taille autorisée.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Le JSON envoyé est invalide.");
    error.status = 400;
    throw error;
  }
}

function validateChatPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw Object.assign(new Error("Le corps de la requête est invalide."), { status: 400 });
  }
  const tab = String(payload.tab || "").trim();
  const message = String(payload.message || "").trim();
  if (!ALLOWED_TABS.has(tab)) {
    throw Object.assign(new Error("L'onglet demandé est inconnu."), { status: 400 });
  }
  if (!message || message.length > MAX_MESSAGE_CHARS) {
    throw Object.assign(new Error(`Le message doit contenir entre 1 et ${MAX_MESSAGE_CHARS} caractères.`), { status: 400 });
  }
  const history = Array.isArray(payload.history) ? payload.history.slice(-MAX_HISTORY_ITEMS) : [];
  const cleanHistory = history
    .filter((item) => item && (item.role === "user" || item.role === "model") && typeof item.text === "string")
    .map((item) => ({ role: item.role, text: item.text.trim().slice(0, 2_000) }))
    .filter((item) => item.text);
  return { tab, message, history: cleanHistory };
}

function systemInstruction(tab) {
  return [
    "Tu es l'assistant de production de CinemAI, un atelier local de préparation de films génératifs.",
    "Réponds en français, de façon concise, concrète et orientée modification vérifiable.",
    "Ne prétends jamais avoir généré, enregistré, publié ou modifié un élément si aucune action outil ne l'a fait.",
    "Préserve les identifiants, la continuité et le périmètre demandé. Propose avant d'appliquer.",
    `Contexte de l'onglet actif : ${TAB_CONTEXT[tab]}`,
  ].join("\n");
}

export async function callGemini({ config, tab, message, history, fetchImpl = fetch }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
  const contents = history.map((item) => ({ role: item.role, parts: [{ text: item.text }] }));
  contents.push({ role: "user", parts: [{ text: message }] });
  let upstream;
  try {
    upstream = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction(tab) }] },
        contents,
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 900,
        },
      }),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw Object.assign(new Error("Gemini n'a pas répondu dans le délai prévu."), { status: 504 });
    }
    throw Object.assign(new Error("Impossible de joindre Gemini."), { status: 502 });
  }
  if (!upstream.ok) {
    const status = upstream.status === 429 ? 429 : upstream.status === 401 || upstream.status === 403 ? 502 : 502;
    const messageText = upstream.status === 429
      ? "Le quota Gemini est momentanément atteint. Réessayez plus tard."
      : "Gemini a refusé la requête. Vérifiez le modèle, la clé et la facturation côté serveur.";
    throw Object.assign(new Error(messageText), { status });
  }
  let data;
  try {
    data = await upstream.json();
  } catch {
    throw Object.assign(new Error("Gemini a renvoyé une réponse illisible."), { status: 502 });
  }
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((part) => typeof part.text === "string" ? part.text : "")
    .join("")
    .trim();
  if (!text) {
    throw Object.assign(new Error("Gemini n'a renvoyé aucun texte exploitable."), { status: 502 });
  }
  return {
    text,
    usage: data.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount ?? null,
          outputTokens: data.usageMetadata.candidatesTokenCount ?? null,
          totalTokens: data.usageMetadata.totalTokenCount ?? null,
        }
      : null,
  };
}

async function serveStatic(request, response, staticDir) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const requestUrl = new URL(request.url, "http://localhost");
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    sendJson(response, 400, { error: "Chemin invalide." });
    return true;
  }
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolvedStaticDir = resolve(staticDir);
  const filePath = resolve(resolvedStaticDir, requestedPath);
  const pathFromRoot = relative(resolvedStaticDir, filePath);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    sendJson(response, 403, { error: "Chemin refusé." });
    return true;
  }
  try {
    const content = await readFile(filePath);
    applySecurityHeaders(response, false);
    response.statusCode = 200;
    response.setHeader("Content-Type", MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") {
      sendJson(response, 404, { error: "Ressource introuvable." });
    } else {
      sendJson(response, 500, { error: "Lecture locale impossible." });
    }
  }
  return true;
}

export function createCinemaiServer({ config, fetchImpl = fetch, staticDir = DEFAULT_STATIC_DIR, logger = console } = {}) {
  if (!config) throw new Error("Configuration serveur manquante.");
  return createHttpServer(async (request, response) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/api/health") {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "Méthode non autorisée.", requestId });
          return;
        }
        sendJson(response, 200, {
          ok: true,
          mode: config.mode,
          model: config.model,
          keyConfigured: Boolean(config.apiKey),
          requestId,
        });
        return;
      }
      if (url.pathname === "/api/chat") {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Méthode non autorisée.", requestId });
          return;
        }
        const payload = validateChatPayload(await readJsonBody(request));
        const result = config.mode === "mock"
          ? { text: MOCK_REPLIES[payload.tab], usage: null }
          : await callGemini({ config, ...payload, fetchImpl });
        sendJson(response, 200, {
          text: result.text,
          mode: config.mode,
          model: config.model,
          usage: result.usage,
          requestId,
        });
        logger.info?.("chat", {
          requestId,
          tab: payload.tab,
          mode: config.mode,
          model: config.model,
          status: 200,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      if (await serveStatic(request, response, staticDir)) return;
      sendJson(response, 405, { error: "Méthode non autorisée.", requestId });
    } catch (error) {
      const status = Number(error?.status) || 500;
      sendJson(response, status, {
        error: status === 500 ? "Erreur serveur locale." : error.message,
        requestId,
      });
      logger.warn?.("request_failed", {
        requestId,
        status,
        durationMs: Date.now() - startedAt,
      });
    }
  });
}

export async function startFromEnvironment() {
  const values = { ...(await loadLocalEnv()), ...process.env };
  const config = buildConfig(values);
  const server = createCinemaiServer({ config });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(config.port, config.host, resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  console.log(`CinemAI local : http://${config.host}:${port}`);
  console.log(`LLM : ${config.mode} · ${config.model}`);
  return server;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  startFromEnvironment().catch((error) => {
    console.error(`Démarrage impossible : ${error.message}`);
    process.exitCode = 1;
  });
}
