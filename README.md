# CinemAI

**A production agent for generative film-making, where every expensive step is validated before it is paid for.**

Live app: **https://cinemai.fly.dev**
Track: **ClickHouse** · Built for *Agentic Cinema: The Blockbuster Hackathon*

---

## The problem

Generating a short film with AI is not hard. Generating one that stays *coherent* is.

In practice the friction is not the pixels, it is everything around them:

- a character silently drifts between shots — costume details vanish, props change orientation;
- you pay for a video clip to discover the action never happened;
- nobody can say what the film has cost so far, or which shot swallowed the budget;
- rejecting a bad proposal costs far more human time than accepting a good one.

CinemAI is an agent that drives the whole pipeline — idea, visual bible, storyboard, video —
with an explicit human gate at each step, and it **measures its own production** so those costs
stop being invisible.

## What the agent actually does

The agent never mutates the project directly. It **proposes** operations (create a shot, define a
character, queue a generation) that a human approves or rejects. Approved operations are applied to
a manifest that is the single source of truth.

On top of that, the agent can **query its own production telemetry** in ClickHouse to answer
questions it could not otherwise answer, and to justify what it proposes:

> *"Query the production telemetry: how many images were generated and at what total cost?"*
>
> → the agent lists the tables through MCP, writes its own SQL, runs it through MCP, and answers
> *16 image generations for 1.072 USD, plus 3 video clips.*

Those reads are **read-only and need no approval**. Only operations that change the film do.

## Required integrations, and where to verify them

Both are called at runtime, not merely named here.

### Google Cloud — Vertex AI

The agent's reasoning and function calling run on **Vertex AI**, authenticated with a service
account, not an API key.

| What | Where |
|---|---|
| JWT signed with the service-account key, exchanged for an OAuth token | [`vertex-auth.mjs`](vertex-auth.mjs) — `signServiceAccountJwt`, `createVertexAuth` |
| Vertex endpoint selection | [`vertex-auth.mjs`](vertex-auth.mjs) — `vertexEndpoint` |
| The agent call itself | [`server.mjs`](server.mjs) — `callGemini`, `Authorization: Bearer` branch |

Startup logs print the active backend, e.g. `LLM : google · gemini-3.5-flash · Vertex AI (project/global)`.

### ClickHouse — official MCP server

Telemetry is **written** over ClickHouse's HTTP interface and **read by the agent through the
official `mcp-clickhouse` MCP server**, spawned as a child process and driven over stdio JSON-RPC.

| What | Where |
|---|---|
| MCP client: handshake, `tools/list`, `tools/call` | [`mcp-client.mjs`](mcp-client.mjs) |
| Tools exposed to Gemini (`list_production_tables`, `query_production_data`) | [`llm-tools.mjs`](llm-tools.mjs) |
| Tool-call loop: execute, feed the result back, let the model continue | [`server.mjs`](server.mjs) — `callGemini` |
| Schema and ingestion | [`clickhouse.mjs`](clickhouse.mjs), [`telemetry.mjs`](telemetry.mjs) |
| `mcp-clickhouse` installed into the image | [`Dockerfile`](Dockerfile) |

Three tables, all derived from what the pipeline already produces — nothing is invented for the demo:

- `production_events` — the activity log;
- `media_generations` — one row per generated image or clip, with `cost_usd`, `version`,
  `chain_depth`, `reanchored`;
- `approvals` — every agent proposal with `status` and `decision_ms`, the human decision latency.

## How coherence is enforced

This is the part that took the most iteration, and it is measurable.

**References are chained.** A style board conditions the character and location sheets, which
condition each shot's keyframe, which conditions the video. Images have authority over rendering;
text only describes the action. When a reference exists, style wording is stripped from the shot
description so it cannot fight the image.

**Regeneration is anchored.** Re-rendering a character sheet uses the *approved* version as the
first reference, so identity does not drift. Deliberately redesigning a character requires an
explicit `restart` flag.

**Shots can chain on the previous clip.** When a shot is marked `continuous`, generation starts
from the last frame of the previous clip — extracted with ffmpeg — so the cut is exact by
construction. Measured over three chained clips: the joins are perfect, but fidelity degrades each
link (a katana flips orientation, costume details simplify). Chaining is therefore capped, and
falls back to the keyframe — which is anchored on approved sheets — beyond
`CINEMAI_CHAIN_MAX_LINKS`.

**An animatic costs nothing.** Approved keyframes play back at each shot's real duration, so
rhythm, action legibility and continuity are validated *before* paying for video.

## Storyboard workspace

Open **Storyboard** to see the film as image cards with the action and duration beneath each frame.
Select a plan to edit its action, dialogue, duration, continuity and linked references. Saving creates
one new text version (the latest 50 prior versions remain readable) and never regenerates a media file.
Concurrent edits are rejected using the shot version. Image generation and approval remain separate.

For a structured project without a breakdown, **Proposer le scénario** asks the agent for a complete
`create_screenplay` proposal: up to 12 sequences and 24 shots, applied atomically after human approval.
Existing films use targeted `update_shot` proposals instead. The offline mock does not write creative
content; the live agent uses the configured Google backend.

The **Continuity** panel checks duration totals, missing/unapproved references and frames, location
changes on continuous cuts, dialogue speakers and frame/scenario version mismatches. This is structural
validation, **not computer vision**: costume, identity and prop consistency still need visual review.
Older images with no source version are explicitly marked unknown. Revalidating a frame records the
current script version without generating another image.

- Review API: `GET /api/storyboard/review` (read-only, no provider call).
- Manual edit API: `PATCH /api/shots/:id` with `{ baseVersion, patch }`.
- Editable design: [CinemAI storyboard workspace](https://www.figma.com/design/wuoR5ZeF6ReBvmd1kuclNN).

## Architecture

```
Browser  ──►  server.mjs  ──►  Vertex AI            (agent reasoning, function calling)
                   │
                   ├────────►  Gemini Developer API (images, and video via Omni)
                   │
                   ├────────►  mcp-clickhouse ──► ClickHouse Cloud   (agent reads)
                   │
                   └────────►  ClickHouse HTTP      (telemetry writes)
```

No npm dependencies. Everything — MCP JSON-RPC, RS256 JWT signing, ClickHouse HTTP — is written
against the Node standard library.

**Honest scope note:** image and video generation deliberately stay on the Gemini Developer API.
Omni, the video model this pipeline depends on, is not published on Vertex AI, and its
`/v1beta/interactions` surface has no Vertex equivalent. The *agent* runs on Google Cloud; the
media generators do not.

## Run it

Requires Node 20+. `ffmpeg` is optional locally (a macOS AVFoundation fallback exists in
[`tools/`](tools/README.md)); it is included in the container image.

```bash
git clone https://github.com/BaronFrancois/cinemAI.git
cd cinemAI
cp .env.example .env      # then fill in the values below
node server.mjs           # http://127.0.0.1:4175
npm test                  # offline tests, no provider access required
```

### Configuration

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Image and video generation (Developer API) |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS` | Vertex AI for the agent. In a container, use `GOOGLE_APPLICATION_CREDENTIALS_JSON` instead of a file path |
| `GOOGLE_CLOUD_LOCATION` | `global` — named regions return 404 for `gemini-3.5-flash` |
| `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE` | Telemetry and MCP |
| `CINEMAI_LLM_MODE` | `mock` for offline work — no provider is ever called |

Without ClickHouse the app runs normally, simply without the analytics tools. Without Vertex it
falls back to the Developer API. Telemetry failures never interrupt a generation.

### Deploy

```bash
fly volumes create cinemai_data --region cdg --size 3
fly secrets import < your-secrets.env
fly deploy
```

The volume matters: the manifest and every generated asset live on it. Without it they would be
destroyed on each deploy.

## Safety model

Every provider call that costs money requires an explicit confirmation string (`GENERATE_IMAGE`,
`GENERATE_VIDEO`) — the agent cannot spend on its own. Estimated costs are shown before each
generation and recorded afterwards. In `mock` mode nothing reaches a provider, which is how the
whole test suite runs.

## License

MIT — see [LICENSE](LICENSE).
