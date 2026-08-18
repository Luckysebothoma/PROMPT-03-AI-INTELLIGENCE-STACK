# AI Gateway — Day 5 of 10
### AI Intelligence, Task Routing & Provider Orchestration

Day 5 is the **intelligence layer** of the AI Gateway. It does not execute
provider calls itself (Day 3 does that) and does not own sessions or
conversation history (Day 4 does that). Day 5 decides *what* should happen:
intent, capability, worker, model, provider — then hands execution to Day 3
and persistence to Day 4.

```
Human / Client / n8n
        |
        v
   DAY 5 :4407  --context-->  DAY 4 (session/context)
        |
   classify -> resolve worker/model/provider
        |
        v
   DAY 3 :4405  --execute-->  Groq / Gemini
        |
        v
   normalize -> validate -> respond
```

## Requirements

- Docker + Docker Compose
- Day 3 (provider execution) reachable, default `http://192.168.0.140:4405`
- Day 4 (context/session) reachable, default `http://127.0.0.1:4406`
  (Day 5 degrades gracefully — with `context_degraded`/`degraded` flags in
  responses — if either is temporarily offline; it does not hard-fail.)

## Quick start

```bash
bash deploy-ai-gateway-5-of-10.sh init      # scaffolds .env from .env.example (never overwrites an existing .env)
bash deploy-ai-gateway-5-of-10.sh build     # docker build
bash deploy-ai-gateway-5-of-10.sh up        # docker compose up -d (Postgres + Redis + App)
bash deploy-ai-gateway-5-of-10.sh test      # runs scripts/day5-testing.sh
bash deploy-ai-gateway-5-of-10.sh all       # init -> build -> push (optional) -> up -> test
```

Other commands: `down`, `restart`, `logs`, `ps`, `push` (only runs if `REGISTRY` env var is set).

Edit `.env` after `init` to add real `GROQ_API_KEY_1` / `GEMINI_API_KEY_1` (and
optional `_2` secondary credentials), and to point `DAY3_URL` / `DAY4_URL` at
your actual Day 3 / Day 4 deployments.

## API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/ready` | Readiness (Postgres required, Redis optional) |
| GET | `/dependencies` | Postgres/Redis/Day3/Day4 status |
| GET | `/help` | Route listing |
| GET | `/metrics` | Prometheus metrics |
| POST | `/v1/chat` | **Primary human-facing endpoint** |
| POST | `/v1/classify` | Intent/task/capability classification only |
| POST | `/v1/resolve` | Capability -> worker/model/provider resolution only |
| POST | `/v1/execute` | Internal-oriented direct execution via Day 3 |
| GET | `/v1/providers`, `/v1/providers/:provider` | Provider registry |
| GET | `/v1/models`, `/v1/models/:model` | Model registry |
| GET | `/v1/workers`, `/v1/workers/:worker` | Worker registry |
| GET | `/v1/capabilities` | Distinct capabilities across all models |

### `POST /v1/chat`

```json
{ "message": "Hello, my name is Mimo", "session_id": "uuid" }
```

Runs the full pipeline: resolve session (Day 4) → retrieve context (Day 4) →
classify intent/task/capability → resolve worker/model/provider → execute
(Day 3) → normalize → validate → persist turn (Day 4) → respond with
`request_id`, `trace_id`, `intent`, `task`, `worker`, `provider`, `model`,
`response`.

## Configuration model

Providers, models, workers, and credentials are **entirely configuration
driven** via `AI_PROVIDERS_JSON`, `AI_MODELS_JSON`, `AI_WORKERS_JSON`,
`AI_CREDENTIALS_JSON` in `.env` (examples in `.env.example`). If unset, the
app boots with sane defaults matching the Day 5 spec (Groq + Gemini,
`intent-classifier` / `chat-worker` / `vision-worker` / `code-worker` /
`reasoning-worker` / `summarization-worker` / `extraction-worker` /
`translation-worker` / `response-validator`).

Invalid JSON in any of these variables causes the app to **fail fast** at
boot with a clear error — it will not silently ignore bad config.

Registry precedence at boot: `.env` config → PostgreSQL (durable, survives
restarts and admin edits) → Redis (rebuildable cache; deleting Redis just
costs a cache-warm round-trip, it is never authoritative).

## Model lifecycle & decommissioning

Each model has a `lifecycle`: `stable` (normal candidate), `preview`
(candidate only when explicitly allowed), `deprecated` (never auto-selected),
`disabled` (never selected). Set `"enabled": false` and/or
`"lifecycle": "disabled"` on a model in `AI_MODELS_JSON` (or via the
`models` table in Postgres) and restart — the router will stop selecting it
without any code change.

## Normalized errors

Every failure returns:

```json
{
  "success": false,
  "error": {
    "code": "MODEL_NOT_FOUND",
    "message": "...",
    "retryable": false
  }
}
```

Codes: `MODEL_NOT_FOUND`, `PROVIDER_UNAVAILABLE`, `AUTHENTICATION_FAILED`,
`RATE_LIMITED`, `TIMEOUT`, `INVALID_REQUEST`, `UPSTREAM_ERROR`,
`CLASSIFICATION_FAILED`, `WORKER_UNAVAILABLE`, `NO_CAPABLE_MODEL`,
`NO_CAPABLE_PROVIDER`, `RESPONSE_VALIDATION_FAILED`,
`MAX_ORCHESTRATION_DEPTH`, `UNKNOWN_ERROR`. These map directly onto an n8n
Switch node on `error.code`.

## Orchestration depth

Every request carries `depth` / `max_depth` (default `MAX_ORCHESTRATION_DEPTH=3`).
If `depth >= max_depth`, Day 5 returns `MAX_ORCHESTRATION_DEPTH` immediately
rather than looping. There is no autonomous AI→AI→AI retry chain in Day 5;
that belongs to n8n.

## Security

- Secret values (`GROQ_API_KEY_*`, `GEMINI_API_KEY_*`) are only ever read
  from environment variables by Day 3 at execution time; Day 5 never logs
  them and never returns them from any endpoint. Only `secret_env` (the
  variable *name*) is ever exposed via `/v1/providers/:provider`.
- Request logs include method/path/status/latency only — no message bodies,
  no secrets.

## What Day 5 deliberately does NOT do

Per the spec: no vector databases, no RAG, no autonomous agents/tool
execution, no infinite retry loops, no model training, no advanced
hallucination detection, no complex weighted/probabilistic routing yet.
Response validation is structural only (response exists, isn't empty, has
provider/model/request_id metadata).

## Testing

```bash
bash deploy-ai-gateway-5-of-10.sh test
```

Runs `scripts/day5-testing.sh`: tooling checks, container health, Postgres/
Redis, all registry endpoints, chat/vision/code classification, capability
resolution (including a deliberately unknown capability to confirm
normalized-error behavior), disabled-model/lifecycle exposure, orchestration
depth protection, Prometheus metrics, the full human `/v1/chat` path, and
optional Day 3/Day 4/live-provider checks that `[SKIP]` cleanly when those
dependencies or API keys aren't present rather than failing the whole suite.

This was validated end-to-end during development against a mocked Day 3 and
an in-memory Postgres backend: all 25 functional checks passed, with the
only skips being genuinely-optional dependencies (Redis, Day 4, live
provider keys).
# PROMPT-03-AI-INTELLIGENCE-STACK
# PROMPT-03-AI-INTELLIGENCE-STACK
