import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { createVertexAuth, signServiceAccountJwt, vertexConfig, vertexEndpoint } from "../vertex-auth.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const credentials = {
  type: "service_account",
  project_id: "cinemai-test",
  client_email: "agent@cinemai-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
};

test("vertex config needs a project and a credential source", () => {
  assert.equal(vertexConfig({}), null);
  assert.equal(vertexConfig({ GOOGLE_CLOUD_PROJECT: "p" }), null, "un projet sans clé ne suffit pas");
  const fromFile = vertexConfig({ GOOGLE_CLOUD_PROJECT: "p", GOOGLE_APPLICATION_CREDENTIALS: "/k.json" });
  assert.equal(fromFile.keyFile, "/k.json");
  assert.equal(fromFile.location, "global", "la région par défaut sert les modèles récents");
  // En conteneur, la clé arrive par variable d'environnement.
  const inline = vertexConfig({ GOOGLE_CLOUD_PROJECT: "p", GOOGLE_APPLICATION_CREDENTIALS_JSON: '{"a":1}' });
  assert.equal(inline.inline, '{"a":1}');
});

test("the endpoint differs for the global region", () => {
  assert.match(
    vertexEndpoint({ project: "p", location: "global" }, "gemini-3.5-flash"),
    /^https:\/\/aiplatform\.googleapis\.com\/v1\/projects\/p\/locations\/global\//,
  );
  assert.match(
    vertexEndpoint({ project: "p", location: "us-central1" }, "gemini-3.5-flash"),
    /^https:\/\/us-central1-aiplatform\.googleapis\.com\//,
  );
});

test("the signed assertion is a real RS256 JWT for the right audience", () => {
  const jwt = signServiceAccountJwt(credentials, { now: 1_000 });
  const [header, claims, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  const body = JSON.parse(Buffer.from(claims, "base64url").toString());
  assert.equal(body.iss, credentials.client_email);
  assert.equal(body.aud, "https://oauth2.googleapis.com/token");
  assert.equal(body.exp - body.iat, 3_600);
  assert.match(body.scope, /cloud-platform/);
  // La signature doit être vérifiable par la clé publique correspondante.
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${claims}`);
  assert.ok(verifier.verify(publicKey, Buffer.from(signature, "base64url")));

  assert.throws(() => signServiceAccountJwt({ client_email: "x" }), /incomplète/);
});

test("the access token is fetched once and reused until it nears expiry", async () => {
  let calls = 0;
  let clock = 1_000_000;
  const auth = createVertexAuth({
    config: { project: "p", location: "global", inline: JSON.stringify(credentials) },
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, "https://oauth2.googleapis.com/token");
      assert.match(options.body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
      return new Response(JSON.stringify({ access_token: `jeton-${calls}`, expires_in: 3600 }), { status: 200 });
    },
    now: () => clock,
  });

  assert.equal(await auth.accessToken(), "jeton-1");
  assert.equal(await auth.accessToken(), "jeton-1", "le jeton est réutilisé");
  assert.equal(calls, 1);

  // Passé l'expiration moins la marge, on en redemande un.
  clock += 3_600_000;
  assert.equal(await auth.accessToken(), "jeton-2");
  assert.equal(calls, 2);
});

test("a refused authentication reports the upstream detail", async () => {
  const auth = createVertexAuth({
    config: { project: "p", location: "global", inline: JSON.stringify(credentials) },
    fetchImpl: async () => new Response('{"error":"invalid_grant"}', { status: 400 }),
  });
  await assert.rejects(() => auth.accessToken(), /invalid_grant/);
});
