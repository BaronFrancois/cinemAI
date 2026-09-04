#!/usr/bin/env node
// Enchaîne un plan sur le précédent : on extrait la dernière frame du clip
// existant et on l'utilise comme frame de DÉBUT du plan suivant. Le raccord est
// alors exact par construction, puisque c'est littéralement la même image.
//
//   swiftc -O tools/extract-frame.swift -o tools/extract-frame
//   node tools/chain-next-shot.mjs <clip-precedent.mp4> "<action du plan suivant>" [secondes]
//
// Écrit <sortie>.mp4 et les frames extraites à côté, puis affiche la durée.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { parseEnv } from "../server.mjs";

const [clipPath, action, secondsArg] = process.argv.slice(2);
if (!clipPath || !action) {
  console.error('usage: node tools/chain-next-shot.mjs <clip.mp4> "<action>" [secondes]');
  process.exit(2);
}
const seconds = Math.min(10, Math.max(3, Number(secondsArg) || 6));
const env = parseEnv(readFileSync(resolve(process.cwd(), ".env"), "utf8"));
const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
if (!key) throw new Error("GEMINI_API_KEY manquante dans .env");

const extractor = resolve(process.cwd(), "tools/extract-frame");
if (!existsSync(extractor)) {
  throw new Error("Compilez d'abord : swiftc -O tools/extract-frame.swift -o tools/extract-frame");
}
const out = resolve(dirname(clipPath), `${basename(clipPath, ".mp4")}-suite`);
const startFrame = `${out}-depart.jpg`;
execFileSync(extractor, [clipPath, startFrame], { stdio: "inherit" });

const endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions";
const headers = { "Content-Type": "application/json", "x-goog-api-key": key };
const prompt = [
  `Génère un plan vidéo de ${seconds} secondes.`,
  "L'image fournie est la frame de DÉBUT du plan : le plan précédent s'achève exactement sur elle.",
  "Poursuis le mouvement à partir de cette image sans rien réinitialiser : même décor, même personnage, même lumière, caméra fixe.",
  `Action : ${action}`,
  "Aucun texte, aucun sous-titre et aucune incrustation dans l'image.",
].join("\n");

const launch = await fetch(endpoint, {
  method: "POST",
  headers,
  body: JSON.stringify({
    model: `models/${env.GEMINI_OMNI_MODEL || "gemini-omni-1.1-flash"}`,
    response_modalities: ["video"],
    background: true,
    input: [
      { type: "text", text: prompt },
      { type: "image", mime_type: "image/jpeg", data: readFileSync(startFrame).toString("base64") },
    ],
  }),
});
const started = await launch.json();
if (started.error) throw new Error(started.error.message);
console.log("lancé:", started.id, started.status);

const videoPart = (payload) => (payload?.steps || [])
  .flatMap((step) => step.content || [])
  .find((item) => item?.type === "video" && item?.data);

let current = started;
let part = videoPart(current);
const deadline = Date.now() + 600_000;
while (!part && current?.status !== "failed" && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 10_000));
  const poll = await fetch(`${endpoint}/${encodeURIComponent(started.id)}`, { headers });
  if (!poll.ok) continue;
  current = await poll.json().catch(() => null);
  part = videoPart(current);
  process.stdout.write(".");
}
process.stdout.write("\n");
if (!part) throw new Error(`génération non aboutie (statut ${current?.status})`);

const clip = `${out}.mp4`;
writeFileSync(clip, Buffer.from(part.data, "base64"));
// La première frame du nouveau clip doit être identique à la frame de départ.
execFileSync(extractor, [clip, `${out}-premiere.jpg`, "0"], { stdio: "inherit" });
execFileSync(extractor, [clip, `${out}-derniere.jpg`], { stdio: "inherit" });
console.log("clip:", clip);
console.log("Comparez", startFrame, "et", `${out}-premiere.jpg`, ": le raccord doit être invisible.");
