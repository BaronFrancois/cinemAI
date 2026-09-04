// Authentification Vertex AI par compte de service, sans dépendance.
//
// Vertex n'accepte pas de clé d'API : il faut un jeton OAuth. On signe donc un
// JWT avec la clé privée du compte de service, puis on l'échange contre un
// jeton d'accès. C'est ce qui fait la différence entre « appeler Gemini » et
// « utiliser Google Cloud », que le concours vérifie.

import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

const base64url = (input) => Buffer.from(input).toString("base64url");

export function signServiceAccountJwt(credentials, { now = Math.floor(Date.now() / 1000), lifetimeSeconds = 3_600 } = {}) {
  if (!credentials?.client_email || !credentials?.private_key) {
    throw new Error("La clé de compte de service est incomplète.");
  }
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + lifetimeSeconds,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(credentials.private_key).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

export function vertexConfig(values = {}) {
  const project = String(values.GOOGLE_CLOUD_PROJECT || "").trim();
  if (!project) return null;
  // En conteneur il n'y a pas de fichier à monter : la clé arrive en variable
  // d'environnement. En local, un chemin reste plus commode et plus sûr.
  const inline = String(values.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  const keyFile = String(values.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (!inline && !keyFile) return null;
  return {
    inline: inline || null,
    keyFile: keyFile || null,
    project,
    location: String(values.GOOGLE_CLOUD_LOCATION || "global").trim(),
  };
}

export function vertexEndpoint({ project, location }, model) {
  // La région "global" a son propre hôte, sans préfixe.
  const host = location === "global"
    ? "https://aiplatform.googleapis.com"
    : `https://${location}-aiplatform.googleapis.com`;
  return `${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

export function createVertexAuth({ config, fetchImpl = fetch, readFileImpl = readFile, now = () => Date.now() } = {}) {
  if (!config) return null;
  let credentials = null;
  let token = null;
  let expiresAt = 0;

  return {
    project: config.project,
    location: config.location,

    async accessToken() {
      // Un jeton vaut une heure : on le réutilise, avec une marge de sécurité.
      if (token && now() < expiresAt - 60_000) return token;
      if (!credentials) {
        const raw = config.inline ?? await readFileImpl(config.keyFile, "utf8");
        try {
          credentials = JSON.parse(raw);
        } catch {
          throw Object.assign(new Error("La clé de compte de service est illisible."), { status: 500 });
        }
      }
      const assertion = signServiceAccountJwt(credentials, { now: Math.floor(now() / 1000) });
      const response = await fetchImpl(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }).toString(),
      });
      const body = await response.text();
      if (!response.ok) {
        throw Object.assign(
          new Error(`Vertex a refusé l'authentification : ${body.slice(0, 200)}`),
          { status: 502 },
        );
      }
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        throw Object.assign(new Error("Réponse d'authentification illisible."), { status: 502 });
      }
      token = payload.access_token;
      expiresAt = now() + Number(payload.expires_in || 3_600) * 1_000;
      return token;
    },
  };
}
