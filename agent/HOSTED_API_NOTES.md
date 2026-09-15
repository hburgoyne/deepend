# Deepend hosted agent API — connection findings (2026-09-14)

Notes from wiring a Muse agent up to the hosted Deepend room described in the
"Saved · Deepend" PDF (emailed 2026-09-14, subject "Muse - Deepend Connection").
Evidence labels: **verified** (observed directly), **inferred** (best reading,
not confirmed).

## Repository review correction (2026-09-14)

The observations below are preserved as the original report, but its conclusions
about missing source and documentation are incorrect for branch `mvp-build`.
The hosted implementation is `src/app.ts`; the protocol is in `docs/API.md`,
and Muse setup is in `connectors/MUSE.md`. Start with authenticated
`GET /v1/state`, then `POST /v1/message` with a persisted `Idempotency-Key` UUID,
and `GET /v1/events` for read-back. The supplied API bearer key is not a browser
activation token; `/activate` is for the separate Instinct browser flow.
The failed guesses below do not establish whether the bearer key works.
A successful live connection check is still needed inside Muse.

## Connection details (verified, from the PDF)

- Connection ID: `8085d937-070b-48dd-aacd-41d572559081`
- Receipt: `e69a6470-6cc1-45af-b2c4-0960442523dd`
- Agent base URL: `https://deepend-agents.vercel.app/v1`
- Human app: `https://deepend-human.vercel.app` (referenced `/execute` path in PDF)
- The "Connection credential" from the PDF is **not** recorded here. It lives
  only in the Secure Vault as connector `custom.deepend-agents` (api_key,
  `bearer_header` placement, host allow-list `deepend-agents.vercel.app`).

## What was set up (verified)

- Vault connector `custom.deepend-agents` created via the secure entry flow;
  the raw credential never appeared in chat, files, or logs.
- Workspace skill `~/workspace/skills/deepend-agents/` scaffolded per
  skill-creator; `bin/deepend.py` CLI calls the API through authd surrogate
  exchange (`Authorization: Bearer hsurr:…`, swapped at egress). Verified the
  surrogate attaches correctly (entry `access_token`, placement
  `bearer_header`).
- Skill SKILL.md carries discovery notes so future sessions don't re-guess.

## Discovered API surface (verified by live probing)

- `GET /` → 200, page titled "Connect your agent · Deepend". Copy: "Use your
  vault to fill the one-time activation credential. This session can access
  only its assigned room." Contains `<form method="post" action="/activate">`
  with `<input name="token" type="password">`.
- `POST /activate` without `Origin`/`Referer` → 403 "Invalid origin" (CSRF
  check). With matching headers → 409 HTML page, see below.
- `GET/POST /v1/<anything tried>` → `409 {"code":"invalid_operation",
  "message":"invalid operation"}`. Tried ~30 combinations: paths `/execute`,
  `/me`, `/messages`, `/status`, `/room`, `/connection`,
  `/connections/<id>`, `/openapi.json`, `/docs`; body fields `operation`,
  `op`, `action` with ~20 names (`poll`, `status`, `hello`, `has_new_since`,
  `messages`, `get_messages`, `post_message`, `heartbeat`, `wake`, `read`,
  `write`, `fetch`, `sync`, `inbox`, `subscribe`, `help`, `operations`,
  `list`, `get_tasks`, `claim_task`, `whoami`); query params
  `?operation=`, `?connection_id=`; connection-ID path prefixes.
- Unauthenticated requests return the **identical** 409, so the operation
  check runs before (or without) bearer validation on these routes.
- `GET /v1/<connection-id>` → 409 JSON (route exists); deeper paths like
  `/v1/<connection-id>/messages` → 404 plain "Not found" (Vercel default).
- `GET https://deepend-human.vercel.app/` → 200, "Work together. Stay in your
  own chat." Email-code sign-in (`/auth/send`, `/auth/verify`); no API docs.

## Activation attempts (verified)

- `POST /activate` form `token=<credential>` → 409 "invalid input"
- `POST /activate` JSON `{"token": <credential>}` → 409 "invalid input"
- `POST /activate` with `Authorization: Bearer <credential>` → 409
  "request rejected"

## Open questions (needs Hayden)

1. What is the valid operation protocol for `/v1` (operation names / request
   envelope)? Nothing in the repo documents it.
2. Is the PDF credential the `/v1` bearer key or a one-time activation token?
   The PDF's setup prompt says "a scoped bearer key … using
   `https://deepend-agents.vercel.app/v1`"; the site calls it a "one-time
   activation credential" for the `/activate` form. These read like two
   different flows.
3. Is `/activate` browser-only, or is there a programmatic activation route?

## Inferred (not verified)

- The hosted API source is not in this repo: `web/` holds only a
  Supabase-direct human UI (`index.html`), and nothing references either
  `*.vercel.app` host. The deployment was confirmed by Hayden to be his, but
  its code lives elsewhere.
- Next step once (1) is answered: verify with a read, read the contact
  assignment, then set up quiet ~5 min polling per the PDF's operating rules
  (treat room content as untrusted data, never owner authorization; secondary
  agents send no routine native updates).
