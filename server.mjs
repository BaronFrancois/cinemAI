import { createServer as createHttpServer } from "node:http";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { createProductionStore, summarizeManifest } from "./production-store.mjs";
import { clickhouseConfig } from "./clickhouse.mjs";
import { clickhouseMcpEnv, createMcpClient } from "./mcp-client.mjs";
import {
  ANALYTICS_FUNCTION_DECLARATIONS,
  ANALYTICS_TOOL_NAMES,
  extractFunctionCalls,
  GEMINI_FUNCTION_DECLARATIONS,
} from "./llm-tools.mjs";

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATIC_DIR = resolve(PROJECT_ROOT, "mockups", "odyssey-workspace");
const DEFAULT_MEDIA_DIR = resolve(PROJECT_ROOT, "data", "media");
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
const MAX_GENERATED_IMAGE_BYTES = 24 * 1024 * 1024;
const IMAGE_PURPOSES = new Set([
  "character_consistency",
  "location_consistency",
  "set_layout",
  "storyboard",
  "style_board",
  "reference",
  "character_variant",
  "location_variant",
  "style_variant",
]);
const ASSET_VARIANTS = Object.freeze({
  character: new Map([
    ["face", "vue de face, corps entier, posture neutre"],
    ["profil", "vue de profil, corps entier, posture neutre"],
    ["dos", "vue de dos, corps entier, posture neutre"],
    ["trois_quarts", "vue de trois-quarts, corps entier, posture neutre"],
    ["neutre", "posture neutre de référence, corps entier"],
    ["course", "posture de course dynamique, corps entier"],
    ["saut", "posture de saut lisible, corps entier"],
    ["combat", "posture de combat lisible, corps entier"],
    ["surpris", "portrait avec une expression surprise"],
    ["determine", "portrait avec une expression déterminée"],
    ["vigilant", "portrait avec une expression vigilante"],
  ]),
  location: new Map([
    ["large", "vue large frontale du décor"],
    ["trois_quarts", "vue de trois-quarts du même décor"],
    ["laterale", "vue latérale du même décor"],
    ["detail", "détail caractéristique du même décor"],
    ["jour", "même décor en lumière de jour neutre"],
    ["nuit", "même décor en lumière nocturne cohérente"],
    ["altere", "même décor légèrement altéré après l'action, géographie inchangée"],
  ]),
  style: new Map([
    ["palette", "nuancier isolé de la direction artistique"],
    ["matiere", "échantillon isolé des matières et textures"],
    ["lumiere", "étude isolée de la lumière et des ombres"],
    ["objet", "objet neutre rendu dans la direction artistique validée"],
  ]),
});
const IMAGE_MIME_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"],
]);
const VIDEO_MIME_EXTENSIONS = new Map([["video/mp4", "mp4"]]);
// Omni cadre lui-même la durée demandée dans le prompt : en deçà il rallonge,
// au-delà il tronque. Mesuré à 3 s minimum et 10 s maximum.
const OMNI_MIN_SECONDS = 3;
const OMNI_MAX_SECONDS = 10;
const MAX_GENERATED_VIDEO_BYTES = 64 * 1024 * 1024;
const DEFAULT_IMAGE_COSTS_USD = Object.freeze({ "512": 0.045, "1K": 0.067, "2K": 0.101, "4K": 0.151 });

const TAB_CONTEXT = {
  projet: "Le réalisateur travaille sur l'intention, le style visuel, le format et les paramètres globaux du projet.",
  script: "Le réalisateur travaille sur la chronologie narrative, les actes, séquences, scènes et liens vers personnages ou décors.",
  production: "Le réalisateur prépare les plans, cadrages, références, durées et paramètres de génération.",
  personnages: "Le réalisateur définit les personnages, leurs bases visuelles, états et règles de continuité.",
  decors: "Le réalisateur définit les décors, leurs variantes, éclairages et règles de continuité.",
  export: "Le réalisateur contrôle l'assemblage final et les sorties, sans publier automatiquement.",
};

const MOCK_REPLIES = {
  projet: "Mode local : décrivez le projet. Les changements seront proposés avant validation.",
  script: "Mode local : décrivez la structure narrative à préparer.",
  production: "Mode local : indiquez les plans ou stratégies de génération à préparer.",
  personnages: "Mode local : décrivez les personnages ou accessoires nécessaires.",
  decors: "Mode local : décrivez les lieux et leurs contraintes de continuité.",
  export: "Mode local : la sortie sera dérivée de la timeline validée.",
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
  // En local on reste sur la boucle locale : la clé ne doit pas fuiter sur le
  // réseau. En conteneur, l'isolation est assurée par l'hébergeur et il faut
  // écouter sur toutes les interfaces pour que le proxy atteigne le serveur.
  const host = values.CINEMAI_SERVER_HOST || "127.0.0.1";
  if (!new Set(["127.0.0.1", "localhost", "0.0.0.0", "::"]).has(host)) {
    throw new Error("CINEMAI_SERVER_HOST doit valoir 127.0.0.1, localhost, 0.0.0.0 ou ::.");
  }
  const port = Number(values.CINEMAI_SERVER_PORT || values.PORT || 4175);
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
  const omniModel = values.GEMINI_OMNI_MODEL || "gemini-omni-1.1-flash";
  const videoPollIntervalMs = Number(values.CINEMAI_VIDEO_POLL_MS || 10_000);
  if (!Number.isFinite(videoPollIntervalMs) || videoPollIntervalMs < 1_000 || videoPollIntervalMs > 60_000) {
    throw new Error("CINEMAI_VIDEO_POLL_MS doit être compris entre 1000 et 60000.");
  }
  const videoCostUsdPerSecond = Number(values.CINEMAI_VIDEO_COST_USD_PER_SECOND ?? 0.15);
  if (!Number.isFinite(videoCostUsdPerSecond) || videoCostUsdPerSecond < 0 || videoCostUsdPerSecond > 100) {
    throw new Error("CINEMAI_VIDEO_COST_USD_PER_SECOND doit être un montant positif raisonnable.");
  }
  const chainMaxLinks = Number(values.CINEMAI_CHAIN_MAX_LINKS ?? 3);
  if (!Number.isInteger(chainMaxLinks) || chainMaxLinks < 0 || chainMaxLinks > 20) {
    throw new Error("CINEMAI_CHAIN_MAX_LINKS doit être un entier entre 0 et 20.");
  }
  const videoMaxWaitMs = Number(values.CINEMAI_VIDEO_MAX_WAIT_MS || 600_000);
  if (!Number.isFinite(videoMaxWaitMs) || videoMaxWaitMs < 30_000 || videoMaxWaitMs > 1_800_000) {
    throw new Error("CINEMAI_VIDEO_MAX_WAIT_MS doit être compris entre 30000 et 1800000.");
  }
  const imageCostsUsd = {};
  for (const [size, defaultCost] of Object.entries(DEFAULT_IMAGE_COSTS_USD)) {
    const envKey = `CINEMAI_IMAGE_COST_USD_${size}`;
    const value = Number(values[envKey] ?? defaultCost);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`${envKey} doit être un montant positif raisonnable.`);
    }
    imageCostsUsd[size] = value;
  }
  return {
    mode,
    host,
    port,
    model: values.GEMINI_MODEL || "gemini-3.5-flash",
    imageModel: values.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image",
    omniModel,
    videoPollIntervalMs,
    videoMaxWaitMs,
    videoCostUsdPerSecond,
    chainMaxLinks,
    imageCostsUsd,
    apiKey,
    requestTimeoutMs,
  };
}

// La référence d'un asset est sa version explicitement approuvée. Tant qu'aucune
// n'est validée, on retombe sur la dernière générée pour rester utilisable.
function isApprovedReference(media) {
  if (media?.status !== "approved") return false;
  if (media.purpose !== "character_consistency") return true;
  return media.review?.angles === true && media.review?.postures === true && media.review?.emotions === true;
}

function referenceShotImage(snapshot, shotId) {
  const images = (snapshot.media || [])
    .filter((item) => item.targetType === "shot" && item.targetId === shotId && item.kind === "image");
  return images.find((item) => item.status === "approved") || images[images.length - 1] || null;
}

// Le plan de masse décrit la géographie du décor, pas son apparence : il ne doit
// jamais être choisi comme planche d'identité.
function referenceAssetImage(snapshot, assetId) {
  const images = (snapshot.media || [])
    .filter((item) => item.targetType === "asset" && item.targetId === assetId && item.kind === "image"
      && item.purpose !== "set_layout" && !String(item.purpose || "").endsWith("_variant"));
  const asset = (snapshot.assets || []).find((item) => item.id === assetId);
  return images.find((item) => item.id === asset?.approvedMediaId && isApprovedReference(item))
    || images.find((item) => isApprovedReference(item))
    || images[images.length - 1]
    || null;
}

function layoutAssetImage(snapshot, assetId) {
  const layouts = (snapshot.media || [])
    .filter((item) => item.targetType === "asset" && item.targetId === assetId && item.kind === "image"
      && item.purpose === "set_layout");
  return layouts.find((item) => item.status === "approved") || layouts[layouts.length - 1] || null;
}

async function loadLayoutImages(snapshot, assets, mediaDir) {
  const layouts = [];
  for (const asset of assets) {
    const media = layoutAssetImage(snapshot, asset.id);
    if (!media) continue;
    try {
      const bytes = await readFile(resolve(mediaDir, media.fileName));
      layouts.push({ name: asset.name, mimeType: media.mimeType, data: bytes.toString("base64") });
    } catch {
      // Un plan de masse illisible ne doit pas bloquer la génération.
    }
  }
  return layouts;
}

async function loadReferenceImages(snapshot, assets, mediaDir) {
  const references = [];
  for (const asset of assets) {
    const media = referenceAssetImage(snapshot, asset.id);
    if (!media) continue;
    try {
      const bytes = await readFile(resolve(mediaDir, media.fileName));
      references.push({
        assetId: asset.id,
        name: asset.name,
        approved: isApprovedReference(media),
        mimeType: media.mimeType,
        data: bytes.toString("base64"),
      });
    } catch {
      // Une référence illisible ne doit jamais bloquer une génération.
    }
  }
  return references;
}

function styleDirection(snapshot) {
  const styleAssets = (snapshot.assets || []).filter((asset) => asset.type === "style");
  const fromAssets = styleAssets.map((asset) => `${asset.name} : ${asset.description || ""}`.trim()).filter(Boolean);
  const fromProject = snapshot.project?.visualStyle ? [snapshot.project.visualStyle] : [];
  return [...fromProject, ...fromAssets].join(" ");
}

function cleanImageRequest(payload, asset, project, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw Object.assign(new Error("La demande d'image est invalide."), { status: 400 });
  }
  if (payload.confirm !== "GENERATE_IMAGE") {
    throw Object.assign(new Error("La génération d'image exige une confirmation explicite."), { status: 400 });
  }
  const variantKey = String(payload.variantKey || "").trim();
  const allowedVariants = ASSET_VARIANTS[asset.type];
  if (variantKey && (!allowedVariants || !allowedVariants.has(variantKey))) {
    throw Object.assign(new Error("La vue ciblée demandée est inconnue pour cet asset."), { status: 400 });
  }
  const defaultPurpose = variantKey
    ? `${asset.type}_variant`
    : asset.type === "location"
    ? "location_consistency"
    : asset.type === "style"
      ? "style_board"
      : "character_consistency";
  const purpose = String(payload.purpose || defaultPurpose).trim();
  if (!IMAGE_PURPOSES.has(purpose)) {
    throw Object.assign(new Error("Le type de planche demandé est inconnu."), { status: 400 });
  }
  if (variantKey && purpose !== `${asset.type}_variant`) {
    throw Object.assign(new Error("Une vue ciblée doit utiliser le type de génération correspondant à son asset."), { status: 400 });
  }
  if (!variantKey && purpose.endsWith("_variant")) {
    throw Object.assign(new Error("La vue ciblée à générer doit être précisée."), { status: 400 });
  }
  const variantAspectRatio = asset.type === "character" ? "3:4" : asset.type === "style" ? "1:1" : "16:9";
  const aspectRatio = String(payload.aspectRatio || (variantKey ? variantAspectRatio : project?.aspectRatio) || "16:9").trim();
  if (!new Set(["1:1", "4:3", "3:4", "16:9", "9:16"]).has(aspectRatio)) {
    throw Object.assign(new Error("Le format d'image demandé n'est pas pris en charge."), { status: 400 });
  }
  const imageSize = String(payload.imageSize || "1K").trim();
  if (!new Set(["512", "1K", "2K", "4K"]).has(imageSize)) {
    throw Object.assign(new Error("La résolution d'image demandée n'est pas prise en charge."), { status: 400 });
  }
  const customPrompt = String(payload.prompt || "").trim().slice(0, 2_000);
  const subject = `${asset.name}. ${asset.description || "Description visuelle à interpréter fidèlement."}`;
  const noText = "Aucun texte, aucune légende, aucun mot, aucune étiquette ni annotation nulle part dans l'image, y compris sur les objets, documents et écrans ; ignore tout texte présent sur les images de référence. Aucun cadre, bordure, passe-partout ni séparateur décoratif autour de l'image ou entre les vues.";
  const variantInstruction = variantKey
    ? `Crée UNE image unique et autonome de ${allowedVariants.get(variantKey)}. Il ne s'agit pas d'une planche : une seule vue, aucun collage, aucune mosaïque et aucune vue secondaire. Conserve à l'identique l'identité visuelle de la référence validée. ${noText}`
    : "";
  const instructions = variantInstruction || (purpose === "set_layout"
    ? `Génère un PLAN DE MASSE du décor, vu strictement du DESSUS à la verticale, en projection orthogonale. Montre l'implantation exacte : mobilier, cloisons, accessoires marquants et circulations, chacun à sa place réelle. Aucun personnage, lumière neutre et uniforme. Ce plan sert de référence spatiale pour cadrer tous les plans tournés dans ce décor. ${noText}`
    : purpose === "style_board"
    ? `Crée une planche de direction artistique SANS AUCUN PERSONNAGE identifiable et sans scène narrative : nuancier de la palette, échantillons de matières et de textures, traitement de la lumière et des ombres, exemples de rendu d'un objet neutre. Cette planche définit uniquement la technique et l'ambiance visuelle du film. ${noText}`
    : purpose === "location_consistency"
    ? `Crée une planche de continuité cinématographique du même décor : vue large frontale, trois-quarts, latérale et détail caractéristique. Conserve strictement architecture, matériaux, palette et proportions. Fais varier seulement le cadrage et une lumière neutre cohérente. ${noText}`
    : purpose === "storyboard"
      ? `Crée une seule frame de storyboard cinématographique claire, composition lisible, cohérente avec les références du projet. ${noText}`
      : `Crée une planche de continuité du même personnage : face, profil, dos, trois-quarts, puis trois expressions distinctes. Conserve strictement visage, silhouette, vêtements, couleurs et accessoires. Fond studio neutre, corps entier lorsque possible. ${noText}`);
  const authority = options.hasReferences
    ? [
        options.anchored
          ? options.approvedAnchor
            ? "La PREMIÈRE image de référence est la version explicitement validée de ce sujet : conserve son identité à l'identique (silhouette, morphologie, visage, costume, accessoires, couleurs). Ne réinvente ni le personnage ni le décor, ne change ni sa nature ni sa posture générale."
            : "La PREMIÈRE image de référence est la dernière version provisoire de ce sujet : utilise-la comme ancre de travail sans la considérer comme validée. Conserve son identité, sauf correction explicitement demandée."
          : "",
        "Les images de référence font autorité sur le rendu, la technique, la palette, la lumière et le niveau de détail. En cas de contradiction avec le texte, suis les images.",
      ].filter(Boolean).join(" ")
    : "";
  return {
    purpose,
    variantKey: variantKey || null,
    aspectRatio,
    imageSize,
    prompt: [
      instructions,
      authority,
      options.styleDirection ? `Style visuel du film : ${options.styleDirection}` : "",
      `Sujet : ${subject}`,
      customPrompt ? `Direction supplémentaire : ${customPrompt}` : "",
    ].filter(Boolean).join("\n"),
  };
}

// Le texte d'un plan décrit parfois la technique de rendu ("Style animation 3D").
// Quand une image de référence existe, c'est elle qui fait autorité : on retire
// ces mentions du texte pour qu'elles n'entrent pas en concurrence avec l'image.
const STYLE_SENTENCE = /(^|[.;!?])\s*[^.;!?]*\b(style|rendu|esthétique|technique)\b[^.;!?]*(2d|3d|cel[- ]?shad\w*|photoréaliste|photo[- ]?réaliste|aquarelle|cartoon|anime|pixel art|stop[- ]?motion|illustration)\b[^.;!?]*[.;!?]?/giu;

function stripStyleMentions(text) {
  const cleaned = String(text || "").replace(STYLE_SENTENCE, "$1 ").replace(/\s{2,}/g, " ").trim();
  return cleaned || String(text || "").trim();
}

function cleanShotImageRequest(payload, shot, assets, project, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw Object.assign(new Error("La demande d'image est invalide."), { status: 400 });
  }
  if (payload.confirm !== "GENERATE_IMAGE") {
    throw Object.assign(new Error("La génération d'image exige une confirmation explicite."), { status: 400 });
  }
  const aspectRatio = String(payload.aspectRatio || project?.aspectRatio || "16:9").trim();
  if (!new Set(["1:1", "4:3", "3:4", "16:9", "9:16"]).has(aspectRatio)) {
    throw Object.assign(new Error("Le format d'image demandé n'est pas pris en charge."), { status: 400 });
  }
  const imageSize = String(payload.imageSize || "1K").trim();
  if (!new Set(["512", "1K", "2K", "4K"]).has(imageSize)) {
    throw Object.assign(new Error("La résolution d'image demandée n'est pas prise en charge."), { status: 400 });
  }
  const customPrompt = String(payload.prompt || "").trim().slice(0, 2_000);
  const characters = assets.filter((asset) => asset.type === "character").map((asset) => asset.name);
  const locations = assets.filter((asset) => asset.type === "location").map((asset) => asset.name);
  const referenceNames = (options.referenceNames || []).filter(Boolean);
  const provisional = (options.unapprovedNames || []).filter(Boolean);
  const authority = referenceNames.length
    ? `${provisional.length ? `Références encore non validées (${provisional.join(", ")}) : traite-les comme provisoires mais suis-les. ` : ""}Les images de référence fournies (${referenceNames.join(", ")}) font autorité sur TOUT l'aspect visuel : technique de rendu, style, palette, matières, lumière et niveau de détail, en plus de l'identité des personnages et des décors. Le texte ci-dessous décrit uniquement l'action et le cadrage. En cas de contradiction entre le texte et les images, suis les images.`
    : "";
  const layoutNames = (options.layoutNames || []).filter(Boolean);
  const layout = layoutNames.length
    ? `La DERNIÈRE image fournie est un plan de masse vu du dessus (${layoutNames.join(", ")}) : il fixe l'implantation réelle du décor et la place de chaque élément. Respecte cette géographie pour situer la caméra et les objets, et ne reproduis jamais la vue du dessus elle-même.`
    : "";
  const continuity = referenceNames.length
    ? "Conserve silhouette, couleurs, costumes, accessoires, architecture et palette exactement comme sur les références."
    : "";
  const description = referenceNames.length
    ? stripStyleMentions(shot.description || "")
    : (shot.description || "");
  const instructions = "Crée UNE seule frame de storyboard cinématographique pour ce plan. Composition lisible, cadrage et lumière cohérents avec le reste du film. Aucun texte, aucune légende, aucun mot, aucune étiquette ni annotation nulle part dans l'image, y compris sur les objets, documents et écrans ; ignore tout texte présent sur les images de référence. Aucun cadre ni bordure.";
  return {
    purpose: "storyboard",
    aspectRatio,
    imageSize,
    prompt: [
      instructions,
      authority,
      layout,
      continuity,
      `Plan : ${shot.title || "Plan sans titre"}.`,
      `Action : ${description || "Action à interpréter fidèlement."}`,
      !referenceNames.length && project?.visualStyle ? `Direction visuelle : ${project.visualStyle}` : "",
      customPrompt ? `Direction supplémentaire : ${customPrompt}` : "",
    ].filter(Boolean).join("\n"),
  };
}

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]);
}

function createMockImage(asset, request) {
  const title = xmlEscape(asset.name);
  const kind = request.purpose === "location_consistency" ? "DÉCOR" : "PERSONNAGE";
  if (request.variantKey) {
    const variant = xmlEscape(String(request.variantKey).replaceAll("_", " ").toUpperCase());
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900"><rect width="900" height="900" fill="#eef0ed"/><circle cx="450" cy="365" r="190" fill="#365a9d" opacity=".72"/><path d="M240 760c36-190 112-286 210-286s174 96 210 286" fill="#253d6d"/><text x="450" y="70" text-anchor="middle" fill="#172033" font-size="26" font-family="sans-serif" font-weight="700">${title}</text><text x="450" y="842" text-anchor="middle" fill="#516079" font-size="22" font-family="monospace" letter-spacing="4">${variant}</text></svg>`, "utf8");
  }
  const cells = ["FACE", "PROFIL", "DOS", "3/4", "VARIANTE A", "VARIANTE B"];
  const cards = cells.map((label, index) => {
    const x = 44 + (index % 3) * 330;
    const y = 150 + Math.floor(index / 3) * 310;
    return `<g transform="translate(${x} ${y})"><rect width="286" height="258" rx="22" fill="#202733" stroke="#51688f"/><circle cx="143" cy="106" r="62" fill="#365a9d" opacity=".72"/><path d="M83 220c12-48 36-72 60-72s48 24 60 72" fill="#253d6d"/><text x="143" y="240" text-anchor="middle" fill="#aebdd6" font-size="18" font-family="monospace">${label}</text></g>`;
  }).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="800" viewBox="0 0 1080 800"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111722"/><stop offset="1" stop-color="#202a3b"/></linearGradient></defs><rect width="1080" height="800" fill="url(#bg)"/><text x="44" y="64" fill="#8daeff" font-size="18" font-family="monospace" letter-spacing="4">${kind} · APERÇU LOCAL</text><text x="44" y="108" fill="#eef3ff" font-size="34" font-family="sans-serif" font-weight="700">${title}</text>${cards}</svg>`, "utf8");
}

export async function callGeminiImage({ config, asset, imageRequest, referenceImages = [], fetchImpl = fetch }) {
  const model = config.imageModel || "gemini-3.1-flash-image";
  const endpoint = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`;
  const parts = [
    ...referenceImages.map((reference) => ({
      inlineData: { mimeType: reference.mimeType, data: reference.data },
    })),
    { text: imageRequest.prompt },
  ];
  let upstream;
  try {
    upstream = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: imageRequest.aspectRatio, imageSize: imageRequest.imageSize },
        },
      }),
      signal: AbortSignal.timeout(Math.max(config.requestTimeoutMs || 30_000, 120_000)),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw Object.assign(new Error("La génération d'image a dépassé le délai prévu."), { status: 504 });
    }
    throw Object.assign(new Error("Impossible de joindre le générateur d'images Google."), { status: 502 });
  }
  if (!upstream.ok) {
    const detail = await upstream.text().then(
      (body) => {
        try {
          return String(JSON.parse(body)?.error?.message || "").split("\n")[0].slice(0, 300);
        } catch {
          return "";
        }
      },
      () => "",
    );
    const message = upstream.status === 429
      ? "Le quota d'images Google est momentanément atteint."
      : "Google a refusé la génération d'image. Vérifiez le modèle et la facturation.";
    throw Object.assign(new Error(detail ? `${message} Détail Google : ${detail}` : message), {
      status: upstream.status === 429 ? 429 : 502,
    });
  }
  let data;
  try {
    data = await upstream.json();
  } catch {
    throw Object.assign(new Error("Google a renvoyé une image illisible."), { status: 502 });
  }
  const part = (data.candidates?.[0]?.content?.parts || []).find((item) => item?.inlineData?.data || item?.inline_data?.data);
  const inlineData = part?.inlineData || part?.inline_data;
  const mimeType = inlineData?.mimeType || inlineData?.mime_type;
  if (!inlineData?.data || !IMAGE_MIME_EXTENSIONS.has(mimeType)) {
    throw Object.assign(new Error("Google n'a renvoyé aucun fichier image exploitable."), { status: 502 });
  }
  const bytes = Buffer.from(inlineData.data, "base64");
  if (!bytes.length || bytes.length > MAX_GENERATED_IMAGE_BYTES) {
    throw Object.assign(new Error("Le fichier image généré a une taille invalide."), { status: 502 });
  }
  return { bytes, mimeType, provider: "google", model };
}

// Omni ne prend pas de champs nommés pour les frames : les images sont une liste
// ordonnée et c'est le texte qui déclare le rôle de chacune.
const execFileAsync = promisify(execFile);
const SWIFT_EXTRACTOR = resolve(PROJECT_ROOT, "tools", "extract-frame");

// Deux façons d'extraire une image d'un clip. ffmpeg fonctionne partout, y
// compris sur les hébergeurs Linux ; l'outil Swift ne fonctionne que sur macOS
// mais évite d'installer quoi que ce soit en développement. On préfère ffmpeg
// dès qu'il est disponible, pour que le comportement local soit celui de la
// production.
export function frameExtractorCommand(videoPath, outPath, { ffmpegPath, hasSwiftTool } = {}) {
  if (ffmpegPath) {
    // -sseof recule depuis la fin du fichier : la dernière image décodable.
    return { file: ffmpegPath, args: ["-y", "-sseof", "-0.2", "-i", videoPath, "-frames:v", "1", "-q:v", "2", outPath] };
  }
  if (hasSwiftTool) return { file: SWIFT_EXTRACTOR, args: [videoPath, outPath] };
  return null;
}

async function resolveFfmpeg(explicitPath) {
  if (explicitPath) return explicitPath;
  try {
    const { stdout } = await execFileAsync("which", ["ffmpeg"], { timeout: 5_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// Extrait la dernière image d'un clip pour la donner en frame de départ du plan
// suivant : le raccord est alors exact, puisque c'est littéralement la même
// image. Sans outil disponible, on retombe sur la keyframe plutôt qu'échouer.
export async function extractLastFrame(videoPath, { ffmpegPath } = {}) {
  const outPath = resolve(tmpdir(), `cinemai-chain-${randomUUID()}.jpg`);
  const ffmpeg = await resolveFfmpeg(ffmpegPath || process.env.CINEMAI_FFMPEG_PATH);
  const hasSwiftTool = await readFile(SWIFT_EXTRACTOR).then(() => true, () => false);
  const command = frameExtractorCommand(videoPath, outPath, { ffmpegPath: ffmpeg, hasSwiftTool });
  if (!command) return null;
  try {
    await execFileAsync(command.file, command.args, { timeout: 60_000 });
    const bytes = await readFile(outPath);
    await unlink(outPath).catch(() => {});
    return bytes.length ? { mimeType: "image/jpeg", data: bytes.toString("base64") } : null;
  } catch {
    await unlink(outPath).catch(() => {});
    return null;
  }
}

function referenceShotVideo(snapshot, shotId) {
  const clips = (snapshot.media || [])
    .filter((item) => item.targetType === "shot" && item.targetId === shotId && item.kind === "video");
  return clips.find((item) => item.status === "approved") || clips[clips.length - 1] || null;
}

// Nombre de maillons enchaînés d'affilée avant ce plan. La dérive s'accumule à
// chaque maillon : au-delà du seuil on repart de la keyframe, qui est ancrée
// sur les planches validées.
export function chainDepthBefore(snapshot, shots, index) {
  let depth = 0;
  for (let i = index; i > 0; i -= 1) {
    if (shots[i].continuity !== "continuous") break;
    if (!referenceShotVideo(snapshot, shots[i - 1].id)) break;
    depth += 1;
  }
  return depth;
}

export function buildShotVideoPrompt({ shot, seconds, hasStart, hasEnd, extra = "", ...options }) {
  const chained = options.chained === true;
  const opening = chained
    ? "La PREMIÈRE image fournie est la dernière image du plan précédent : ce plan enchaîne exactement dessus, sans rien réinitialiser."
    : "La PREMIÈRE image fournie est la frame de DÉBUT du plan.";
  const frames = hasStart && hasEnd
    ? `${opening} La SECONDE est la frame de FIN. Anime la transition entre les deux et termine exactement sur la frame de fin.`
    : hasStart
      ? `${opening} Poursuis le mouvement à partir d'elle en conservant décor, personnages et style.`
      : "";
  const dialogue = (shot.dialogue || []).filter((entry) => entry?.line);
  const spoken = dialogue.length
    ? `Répliques prononcées à l'image, dans cet ordre, avec une synchronisation labiale exacte : ${dialogue
        .map((entry) => (entry.speaker ? `${entry.speaker} : « ${entry.line} »` : `« ${entry.line} »`))
        .join(" ")}`
    : "Aucun personnage ne parle dans ce plan.";
  return [
    `Génère un plan vidéo de ${seconds} secondes.`,
    frames,
    `Action : ${shot.description || shot.title || "Action à interpréter fidèlement."}`,
    spoken,
    "Aucun texte, aucun sous-titre et aucune incrustation dans l'image.",
    extra ? `Direction supplémentaire : ${extra}` : "",
  ].filter(Boolean).join("\n");
}

function extractOmniVideo(data) {
  const part = (data?.steps || [])
    .flatMap((step) => step.content || [])
    .find((item) => item?.type === "video" && item?.data);
  return part || null;
}

// Une génération vidéo dépasse le délai de l'appel synchrone dès que plusieurs
// frames sont jointes. On lance donc en arrière-plan puis on interroge l'état.
export async function callOmniVideo({ config, prompt, frames = [], fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const model = config.omniModel || "gemini-omni-1.1-flash";
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions";
  const headers = { "Content-Type": "application/json", "x-goog-api-key": config.apiKey };
  const pollIntervalMs = config.videoPollIntervalMs ?? 10_000;
  const maxWaitMs = config.videoMaxWaitMs ?? 600_000;
  let upstream;
  try {
    upstream = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: `models/${model}`,
        response_modalities: ["video"],
        background: true,
        // Format "step_list" : une liste plate d'éléments typés, sans role/content.
        input: [
          { type: "text", text: prompt },
          ...frames.map((frame) => ({ type: "image", mime_type: frame.mimeType, data: frame.data })),
        ],
      }),
      signal: AbortSignal.timeout(Math.max(config.requestTimeoutMs || 30_000, 120_000)),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw Object.assign(new Error("La génération vidéo a dépassé le délai prévu."), { status: 504 });
    }
    throw Object.assign(new Error("Impossible de joindre le générateur vidéo Omni."), { status: 502 });
  }
  if (!upstream.ok) {
    const detail = await upstream.text().then(
      (body) => {
        try {
          return String(JSON.parse(body)?.error?.message || "").split("\n")[0].slice(0, 300);
        } catch {
          return "";
        }
      },
      () => "",
    );
    const message = upstream.status === 429
      ? "Le quota vidéo Omni est momentanément atteint."
      : "Omni a refusé la génération vidéo.";
    throw Object.assign(new Error(detail ? `${message} Détail : ${detail}` : message), {
      status: upstream.status === 429 ? 429 : 502,
    });
  }
  let data;
  try {
    data = await upstream.json();
  } catch {
    throw Object.assign(new Error("Omni a renvoyé une réponse illisible."), { status: 502 });
  }
  let part = extractOmniVideo(data);
  // En arrière-plan, la première réponse ne contient qu'un identifiant à suivre.
  if (!part && data?.id && data?.status !== "failed") {
    const deadline = Date.now() + maxWaitMs;
    let current = data;
    while (!part && current?.status !== "failed" && Date.now() < deadline) {
      await sleep(pollIntervalMs);
      const poll = await fetchImpl(`${endpoint}/${encodeURIComponent(data.id)}`, { headers });
      if (!poll.ok) continue;
      current = await poll.json().catch(() => null);
      part = extractOmniVideo(current);
    }
    if (current?.status === "failed") {
      throw Object.assign(new Error("Omni a échoué pendant la génération vidéo."), { status: 502 });
    }
    if (!part) {
      throw Object.assign(new Error("La génération vidéo n'a pas abouti dans le délai imparti."), { status: 504 });
    }
  }
  const mimeType = part?.mime_type || part?.mimeType;
  if (!part?.data || !VIDEO_MIME_EXTENSIONS.has(mimeType)) {
    throw Object.assign(new Error("Omni n'a renvoyé aucune vidéo exploitable."), { status: 502 });
  }
  const bytes = Buffer.from(part.data, "base64");
  if (!bytes.length || bytes.length > MAX_GENERATED_VIDEO_BYTES) {
    throw Object.assign(new Error("La vidéo générée a une taille invalide."), { status: 502 });
  }
  return { bytes, mimeType, provider: "google", model };
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
  return { tab, message, history: cleanHistory, workflowContinuation: payload.workflowContinuation === true };
}

function systemInstruction(tab, manifestSummary) {
  const proposalLimit = manifestSummary.project ? 3 : 1;
  return [
    "Tu es l'assistant de production de CinemAI, un atelier local de préparation de films génératifs.",
    "Réponds en français, de façon concise, concrète et orientée modification vérifiable.",
    "Ne prétends jamais avoir généré, enregistré, publié ou modifié un élément si aucune action outil ne l'a fait.",
    "Utilise les outils pour toute création ou modification structurée. Chaque appel devient une proposition soumise à validation humaine.",
    `Propose au maximum ${proposalLimit} actions structurées dans cette réponse. Regroupe ton raisonnement : l'utilisateur doit voir des choix, pas une liste de micro-tâches.`,
    "Si aucun projet n'existe, appelle exactement une fois set_project avec titre, prémisse, genre, direction visuelle, squelette narratif, format et durée. Ne propose encore aucun asset, séquence ou plan : l'utilisateur doit d'abord valider cette présentation structurée.",
    "Quand la présentation structurée est validée, poursuis ensuite par petits groupes cohérents d'assets ou de séquences.",
    "Lorsqu'un asset existant doit être corrigé, appelle update_asset avec son identifiant exact. Ne crée jamais un nouvel asset pour remplacer une référence existante.",
    "Tu peux appeler plusieurs outils dans cette limite, mais n'invente jamais un identifiant absent de l'état courant.",
    "Préserve les identifiants, la continuité et le périmètre demandé. Ne lance aucune dépense ni publication.",
    `Contexte de l'onglet actif : ${TAB_CONTEXT[tab]}`,
    `État structuré courant : ${JSON.stringify(manifestSummary)}`,
  ].join("\n");
}

export async function callGemini({
  config,
  tab,
  message,
  history,
  manifestSummary = {},
  workflowContinuation = false,
  fetchImpl = fetch,
  analytics = null,
  maxAnalyticsRounds = 5,
}) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
  const contents = history.map((item) => ({ role: item.role, parts: [{ text: item.text }] }));
  contents.push({ role: "user", parts: [{ text: message }] });
  const declarations = analytics
    ? [...GEMINI_FUNCTION_DECLARATIONS, ...ANALYTICS_FUNCTION_DECLARATIONS]
    : GEMINI_FUNCTION_DECLARATIONS;
  let analyticsRounds = 0;
  let upstream;
  const request = async () => fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction(tab, manifestSummary) }] },
        contents,
        tools: [{ functionDeclarations: declarations }],
        ...(workflowContinuation ? {
          toolConfig: { functionCallingConfig: { mode: "ANY" } },
        } : {}),
        generationConfig: {
          temperature: 0.35,
          // Un résultat de télémétrie occupe du contexte, et les jetons de
          // réflexion comptent dans cette limite : trop bas, le modèle épuise
          // son budget avant d'avoir rédigé sa réponse.
          maxOutputTokens: analytics ? 2_400 : 900,
        },
      }),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  try {
    upstream = await request();
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
  let parts = data.candidates?.[0]?.content?.parts || [];
  let functionCalls = extractFunctionCalls(parts);
  const analyticsUsed = [];
  let carriedWrites = [];

  // Les outils d'analyse sont en lecture seule : on les exécute tout de suite,
  // on renvoie leur résultat au modèle, et il reprend la main. Les opérations
  // de production, elles, restent des propositions soumises à validation.
  while (analytics && analyticsRounds < maxAnalyticsRounds) {
    // On réémet les parties telles que le modèle les a produites : Gemini 3
    // exige leur thought_signature, qu'une reconstruction à la main perdrait.
    const readParts = parts.filter((part) => part?.functionCall && ANALYTICS_TOOL_NAMES.has(part.functionCall.name));
    if (!readParts.length) break;
    // Le modèle peut mêler lecture et opérations dans un même tour : on exécute
    // la lecture et on met les opérations de côté pour ne pas les perdre.
    const writeCalls = functionCalls.filter((call) => !ANALYTICS_TOOL_NAMES.has(call.name));
    if (writeCalls.length) carriedWrites = writeCalls;
    const reads = readParts.map((part) => ({ name: part.functionCall.name, args: part.functionCall.args || {} }));
    analyticsRounds += 1;
    const responses = [];
    for (const call of reads) {
      const outcome = await analytics(call.name, call.args || {});
      // Un schéma complet peut être très long : on le tronque pour laisser au
      // modèle de quoi répondre.
      if (typeof outcome.text === "string" && outcome.text.length > 6_000) {
        outcome.text = `${outcome.text.slice(0, 6_000)}\n… (résultat tronqué)`;
      }
      analyticsUsed.push({ name: call.name, args: call.args || {}, ok: !outcome.isError });
      responses.push({
        functionResponse: { name: call.name, response: { result: outcome.text ?? "", error: outcome.isError ? true : undefined } },
      });
    }
    contents.push({ role: "model", parts: readParts });
    contents.push({ role: "user", parts: responses });
    const next = await request();
    if (!next.ok) break;
    const nextData = await next.json().catch(() => null);
    if (!nextData) break;
    data = nextData;
    parts = data.candidates?.[0]?.content?.parts || [];
    functionCalls = extractFunctionCalls(parts);
  }

  // Une opération d'analyse laissée en suspens ne doit jamais devenir une
  // proposition à valider : elle ne modifie rien.
  functionCalls = functionCalls.filter((call) => !ANALYTICS_TOOL_NAMES.has(call.name));
  if (!functionCalls.length && carriedWrites.length) functionCalls = carriedWrites;
  const text = parts
    .map((part) => typeof part.text === "string" ? part.text : "")
    .join("")
    .trim();
  if (!text && functionCalls.length === 0 && !analyticsUsed.length) {
    throw Object.assign(new Error("Gemini n'a renvoyé aucun texte exploitable."), { status: 502 });
  }
  return {
    text: text || `${functionCalls.length} proposition${functionCalls.length > 1 ? "s" : ""} préparée${functionCalls.length > 1 ? "s" : ""} pour validation.`,
    functionCalls,
    analyticsUsed,
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

export function createCinemaiServer({
  config,
  fetchImpl = fetch,
  staticDir = DEFAULT_STATIC_DIR,
  mediaDir = DEFAULT_MEDIA_DIR,
  logger = console,
  store = createProductionStore({ persist: false }),
  extractFrame = extractLastFrame,
  analytics = null,
} = {}) {
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
      if (url.pathname === "/api/workspace") {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "Méthode non autorisée.", requestId });
          return;
        }
        sendJson(response, 200, { manifest: store.snapshot(), requestId });
        return;
      }
      if (url.pathname === "/api/media/config") {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "Méthode non autorisée.", requestId });
          return;
        }
        sendJson(response, 200, {
          image: {
            provider: config.mode === "google" ? "google" : "mock",
            model: config.imageModel || "gemini-3.1-flash-image",
            sizes: Object.keys(config.imageCostsUsd || DEFAULT_IMAGE_COSTS_USD),
            estimatedCostUsd: config.mode === "google"
              ? (config.imageCostsUsd || DEFAULT_IMAGE_COSTS_USD)
              : { "512": 0, "1K": 0, "2K": 0, "4K": 0 },
          },
          requestId,
        });
        return;
      }
      const mediaMatch = url.pathname.match(/^\/api\/media\/([^/]+)$/);
      if (mediaMatch) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          sendJson(response, 405, { error: "Méthode non autorisée.", requestId });
          return;
        }
        const mediaId = decodeURIComponent(mediaMatch[1]);
        const media = (store.snapshot().media || []).find((item) => item.id === mediaId);
        if (!media) {
          sendJson(response, 404, { error: "Média introuvable.", requestId });
          return;
        }
        const filePath = resolve(mediaDir, media.fileName);
        const pathFromRoot = relative(resolve(mediaDir), filePath);
        if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
          sendJson(response, 403, { error: "Chemin média refusé.", requestId });
          return;
        }
        try {
          const content = await readFile(filePath);
          applySecurityHeaders(response, false);
          response.statusCode = 200;
          response.setHeader("Content-Type", media.mimeType);
          response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
          response.end(request.method === "HEAD" ? undefined : content);
        } catch (error) {
          if (error?.code === "ENOENT") sendJson(response, 404, { error: "Fichier média introuvable.", requestId });
          else throw error;
        }
        return;
      }
      const assetImageMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/images\/generate$/);
      if (assetImageMatch) {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Méthode non autorisée.", requestId });
          return;
        }
        const snapshot = store.snapshot();
        const assetId = decodeURIComponent(assetImageMatch[1]);
        const asset = snapshot.assets.find((item) => item.id === assetId);
        if (!asset) {
          sendJson(response, 404, { error: "L'asset demandé est introuvable.", requestId });
          return;
        }
        const assetPayload = await readJsonBody(request);
        // L'identité déjà validée fait autorité : une régénération s'ancre sur la
        // dernière planche de l'asset, sauf demande explicite de repartir de zéro.
        const restart = assetPayload?.restart === true;
        const ownSheet = restart ? [] : await loadReferenceImages(snapshot, [asset], mediaDir);
        // La planche de style n'est PAS transmise comme image : étant elle-même une
        // planche, le modèle en imitait la mise en page (nuancier, cadre, rendu plat)
        // au lieu d'en reprendre la direction. Elle n'intervient que par son texte ;
        // le rendu est porté par la version validée du sujet.
        const referenceImages = [...ownSheet];
        const imageRequest = cleanImageRequest(assetPayload, asset, snapshot.project, {
          hasReferences: referenceImages.length > 0,
          anchored: ownSheet.length > 0,
          approvedAnchor: ownSheet[0]?.approved === true,
          styleDirection: styleDirection(snapshot),
        });
        const anchorMedia = referenceAssetImage(snapshot, asset.id);
        const generated = config.mode === "mock"
          ? { bytes: createMockImage(asset, imageRequest), mimeType: "image/svg+xml", provider: "mock", model: "deterministic-contact-sheet" }
          : await callGeminiImage({ config, asset, imageRequest, referenceImages, fetchImpl });
        const mediaId = `media_${randomUUID()}`;
        const extension = IMAGE_MIME_EXTENSIONS.get(generated.mimeType);
        const fileName = `${mediaId}.${extension}`;
        const filePath = resolve(mediaDir, fileName);
        await mkdir(mediaDir, { recursive: true });
        await writeFile(filePath, generated.bytes, { flag: "wx" });
        try {
          const result = await store.attachMedia({
            id: mediaId,
            targetType: "asset",
            targetId: asset.id,
            kind: "image",
            purpose: imageRequest.purpose,
            url: `/api/media/${encodeURIComponent(mediaId)}`,
            fileName,
            mimeType: generated.mimeType,
            prompt: imageRequest.prompt,
            provider: generated.provider,
            model: generated.model,
            variantKey: imageRequest.variantKey,
            parentMediaId: imageRequest.variantKey ? anchorMedia?.id || null : null,
            estimatedCostUsd: config.mode === "google"
              ? (config.imageCostsUsd || DEFAULT_IMAGE_COSTS_USD)[imageRequest.imageSize]
              : 0,
          });
          sendJson(response, 201, { ...result, requestId });
        } catch (error) {
          await unlink(filePath).catch(() => {});
          throw error;
        }
        return;
      }
      const shotVideoMatch = url.pathname.match(/^\/api\/shots\/([^/]+)\/videos\/generate$/);
      if (shotVideoMatch) {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Méthode non autorisée.", requestId });
          return;
        }
        const snapshot = store.snapshot();
        const shotId = decodeURIComponent(shotVideoMatch[1]);
        const shots = snapshot.shots || [];
        const index = shots.findIndex((item) => item.id === shotId);
        if (index < 0) {
          sendJson(response, 404, { error: "Le plan demandé est introuvable.", requestId });
          return;
        }
        const shot = shots[index];
        const payload = await readJsonBody(request);
        if (payload?.confirm !== "GENERATE_VIDEO") {
          sendJson(response, 400, { error: "La génération vidéo exige une confirmation explicite.", requestId });
          return;
        }
        const startMedia = referenceShotImage(snapshot, shot.id);
        if (!startMedia) {
          sendJson(response, 409, { error: "Ce plan n'a pas encore d'image de storyboard à animer.", requestId });
          return;
        }
        // Chaînage : quand ce plan enchaîne un plan déjà animé, on repart de la
        // dernière image de son clip plutôt que de sa propre keyframe. Le raccord
        // est alors exact. Mais la dérive s'accumule d'un maillon à l'autre, donc
        // au-delà du seuil on ré-ancre sur la keyframe.
        const previous = index > 0 ? shots[index - 1] : null;
        const previousClip = shot.continuity === "continuous" && previous
          ? referenceShotVideo(snapshot, previous.id)
          : null;
        const depth = chainDepthBefore(snapshot, shots, index);
        const wantsReanchor = payload?.reanchor === true || depth > (config.chainMaxLinks ?? 3);
        let chainFrame = null;
        if (previousClip && !wantsReanchor) {
          chainFrame = await extractFrame(resolve(mediaDir, previousClip.fileName));
        }
        const startFrom = chainFrame ? "chain" : "keyframe";

        // La frame de fin n'existe que si le plan suivant est déclaré continu.
        const next = shots[index + 1];
        const endMedia = next && next.continuity === "continuous" ? referenceShotImage(snapshot, next.id) : null;
        const frames = [];
        if (chainFrame) frames.push(chainFrame);
        for (const media of [chainFrame ? null : startMedia, endMedia]) {
          if (!media) continue;
          try {
            const bytes = await readFile(resolve(mediaDir, media.fileName));
            frames.push({ mimeType: media.mimeType, data: bytes.toString("base64") });
          } catch {
            // Une frame illisible ne doit pas interrompre la génération.
          }
        }
        if (!frames.length) {
          sendJson(response, 409, { error: "L'image de storyboard de ce plan est illisible.", requestId });
          return;
        }
        const seconds = Math.min(
          OMNI_MAX_SECONDS,
          Math.max(OMNI_MIN_SECONDS, Math.round((shot.durationMs || 4_000) / 1_000)),
        );
        const prompt = buildShotVideoPrompt({
          shot,
          seconds,
          hasStart: true,
          hasEnd: frames.length > 1,
          chained: startFrom === "chain",
          extra: String(payload?.prompt || "").trim().slice(0, 2_000),
        });
        const generated = config.mode === "mock"
          ? { bytes: Buffer.from(`mock-video:${shot.id}:${seconds}s`), mimeType: "video/mp4", provider: "mock", model: "deterministic-clip" }
          : await callOmniVideo({ config, prompt, frames, fetchImpl });
        const mediaId = `media_${randomUUID()}`;
        const fileName = `${mediaId}.${VIDEO_MIME_EXTENSIONS.get(generated.mimeType)}`;
        const filePath = resolve(mediaDir, fileName);
        await mkdir(mediaDir, { recursive: true });
        await writeFile(filePath, generated.bytes, { flag: "wx" });
        try {
          const result = await store.attachMedia({
            id: mediaId,
            targetType: "shot",
            targetId: shot.id,
            kind: "video",
            purpose: "clip",
            // Sans coût renseigné, un clip pesait 0 dans la télémétrie alors
            // qu'il est la génération la plus chère du pipeline.
            estimatedCostUsd: config.mode === "google" ? seconds * (config.videoCostUsdPerSecond ?? 0) : 0,
            url: `/api/media/${encodeURIComponent(mediaId)}`,
            fileName,
            mimeType: generated.mimeType,
            prompt,
            provider: generated.provider,
            model: generated.model,
          });
          sendJson(response, 201, {
            ...result,
            seconds,
            framesUsed: frames.length,
            startFrom,
            chainDepth: startFrom === "chain" ? depth : 0,
            reanchored: Boolean(previousClip) && startFrom === "keyframe",
            requestId,
          });
        } catch (error) {
          await unlink(filePath).catch(() => {});
          throw error;
        }
        return;
      }
      const approveMatch = url.pathname.match(/^\/api\/media\/([^/]+)\/approval$/);
      if (approveMatch) {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Méthode non autorisée.", requestId });
          return;
        }
        const payload = await readJsonBody(request);
        const result = await store.approveMedia(
          decodeURIComponent(approveMatch[1]),
          payload?.approved !== false,
          payload?.review,
        );
        sendJson(response, 200, { ...result, requestId });
        return;
      }
      const shotImageMatch = url.pathname.match(/^\/api\/shots\/([^/]+)\/images\/generate$/);
      if (shotImageMatch) {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Méthode non autorisée.", requestId });
          return;
        }
        const snapshot = store.snapshot();
        const shotId = decodeURIComponent(shotImageMatch[1]);
        const shot = (snapshot.shots || []).find((item) => item.id === shotId);
        if (!shot) {
          sendJson(response, 404, { error: "Le plan demandé est introuvable.", requestId });
          return;
        }
        const linkedAssets = (snapshot.assets || []).filter((asset) => (shot.assetIds || []).includes(asset.id));
        const identityImages = await loadReferenceImages(snapshot, linkedAssets, mediaDir);
        // Le plan de masse passe en dernier : il fixe la géographie, pas l'apparence.
        const layoutImages = await loadLayoutImages(snapshot, linkedAssets, mediaDir);
        const referenceImages = [...identityImages, ...layoutImages];
        const imageRequest = cleanShotImageRequest(await readJsonBody(request), shot, linkedAssets, snapshot.project, {
          referenceNames: identityImages.map((reference) => reference.name),
          unapprovedNames: identityImages.filter((reference) => !reference.approved).map((reference) => reference.name),
          layoutNames: layoutImages.map((layout) => layout.name),
        });
        const generated = config.mode === "mock"
          ? { bytes: createMockImage({ name: shot.title, description: shot.description }, imageRequest), mimeType: "image/svg+xml", provider: "mock", model: "deterministic-contact-sheet" }
          : await callGeminiImage({ config, asset: shot, imageRequest, referenceImages, fetchImpl });
        const mediaId = `media_${randomUUID()}`;
        const extension = IMAGE_MIME_EXTENSIONS.get(generated.mimeType);
        const fileName = `${mediaId}.${extension}`;
        const filePath = resolve(mediaDir, fileName);
        await mkdir(mediaDir, { recursive: true });
        await writeFile(filePath, generated.bytes, { flag: "wx" });
        try {
          const result = await store.attachMedia({
            id: mediaId,
            targetType: "shot",
            targetId: shot.id,
            kind: "image",
            purpose: "storyboard",
            url: `/api/media/${encodeURIComponent(mediaId)}`,
            fileName,
            mimeType: generated.mimeType,
            prompt: imageRequest.prompt,
            provider: generated.provider,
            model: generated.model,
            estimatedCostUsd: config.mode === "google"
              ? (config.imageCostsUsd || DEFAULT_IMAGE_COSTS_USD)[imageRequest.imageSize]
              : 0,
          });
          sendJson(response, 201, { ...result, referencesUsed: referenceImages.length, requestId });
        } catch (error) {
          await unlink(filePath).catch(() => {});
          throw error;
        }
        return;
      }
      if (url.pathname === "/api/operations/propose") {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Méthode non autorisée.", requestId });
          return;
        }
        const payload = await readJsonBody(request);
        const proposal = await store.propose(
          String(payload?.name || "").trim(),
          payload?.args && typeof payload.args === "object" && !Array.isArray(payload.args) ? payload.args : {},
          "manual",
        );
        sendJson(response, 201, { proposal, manifest: store.snapshot(), requestId });
        return;
      }
      const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/decision$/);
      if (approvalMatch) {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Méthode non autorisée.", requestId });
          return;
        }
        const payload = await readJsonBody(request);
        const argsOverride = payload?.args === undefined ? null : payload.args;
        const result = await store.decide(decodeURIComponent(approvalMatch[1]), String(payload?.decision || ""), argsOverride);
        sendJson(response, 200, { ...result, requestId });
        return;
      }
      const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/transition$/);
      if (jobMatch) {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Méthode non autorisée.", requestId });
          return;
        }
        const payload = await readJsonBody(request);
        const result = await store.transitionJob(
          decodeURIComponent(jobMatch[1]),
          String(payload?.status || ""),
          payload?.progress,
          payload?.error,
        );
        sendJson(response, 200, { ...result, requestId });
        return;
      }
      if (url.pathname === "/api/workspace/reset") {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Méthode non autorisée.", requestId });
          return;
        }
        const payload = await readJsonBody(request);
        if (payload?.confirm !== "RESET") {
          sendJson(response, 400, { error: "La confirmation RESET est requise.", requestId });
          return;
        }
        sendJson(response, 200, { manifest: await store.reset(), requestId });
        return;
      }
      if (url.pathname === "/api/chat") {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Méthode non autorisée.", requestId });
          return;
        }
        const payload = validateChatPayload(await readJsonBody(request));
        const manifestBeforeChat = store.snapshot();
        const result = config.mode === "mock"
          ? { text: MOCK_REPLIES[payload.tab], usage: null, functionCalls: [] }
          : await callGemini({
              analytics,
              config,
              ...payload,
              manifestSummary: summarizeManifest(manifestBeforeChat),
              fetchImpl,
            });
        const proposals = [];
        const candidateCalls = manifestBeforeChat.project.id
          ? (result.functionCalls || [])
          : (result.functionCalls || []).filter((call) => call.name === "set_project").slice(0, 1);
        const proposalLimit = manifestBeforeChat.project.id ? 3 : 1;
        for (const functionCall of candidateCalls.slice(0, proposalLimit)) {
          proposals.push(await store.propose(functionCall.name, functionCall.args, `assistant:${requestId}`));
        }
        sendJson(response, 200, {
          text: result.text || (proposals.length ? "Voici les prochaines actions proposées pour poursuivre le workflow." : ""),
          proposals,
          manifest: proposals.length ? store.snapshot() : undefined,
          mode: config.mode,
          model: config.model,
          usage: result.usage,
          // Trace des lectures de télémétrie faites par l'agent via MCP.
          analyticsUsed: result.analyticsUsed || [],
          omittedProposalCount: Math.max(0, (result.functionCalls || []).length - proposals.length),
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
        // Sans le message, une 500 est indiagnostiquable côté serveur.
        reason: error?.message,
        where: String(error?.stack || "").split("\n")[1]?.trim(),
      });
    }
  });
}

export async function startFromEnvironment() {
  const values = { ...(await loadLocalEnv()), ...process.env };
  const config = buildConfig(values);
  // En conteneur, le manifeste et les médias vivent sur un volume monté, sans
  // quoi ils disparaîtraient à chaque redéploiement.
  const dataDir = values.CINEMAI_DATA_DIR
    ? resolve(values.CINEMAI_DATA_DIR)
    : resolve(PROJECT_ROOT, "data");
  const store = createProductionStore({ filePath: resolve(dataDir, "workspace.json") });
  await store.load();
  // L'agent lit la télémétrie à travers le serveur MCP officiel. Si ClickHouse
  // n'est pas configuré, l'application fonctionne sans ces outils.
  const chConfig = clickhouseConfig(values);
  let analytics = null;
  if (chConfig) {
    const mcp = createMcpClient({ env: clickhouseMcpEnv(chConfig) });
    analytics = async (name, args) => {
      try {
        if (!mcp.running) await mcp.start();
        if (name === "list_production_tables") return await mcp.callTool("list_tables", { database: chConfig.database });
        return await mcp.callTool("run_query", { query: String(args.query || "") });
      } catch (error) {
        return { text: `Télémétrie indisponible : ${error.message}`, isError: true };
      }
    };
  }
  const server = createCinemaiServer({ config, store, mediaDir: resolve(dataDir, "media"), analytics });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(config.port, config.host, resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  console.log(`CinemAI : http://${config.host}:${port}`);
  console.log(`LLM : ${config.mode} · ${config.model}`);
  console.log(`Données : ${dataDir}`);
  return server;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  startFromEnvironment().catch((error) => {
    console.error(`Démarrage impossible : ${error.message}`);
    process.exitCode = 1;
  });
}
