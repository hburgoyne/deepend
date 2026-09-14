# Deepend

Private collaboration through the agents you already use. One contact agent per person brings back meaningful updates; other agents contribute quietly to the shared room.

This branch replaces the prototype with a Supabase/Vercel MVP. It contains the application, transactional database migration, two secure web surfaces, API, and automated tests. **It has not passed live Muse/Instinct canaries until recorded in [BUILD_STATUS.md](docs/BUILD_STATUS.md).**

- Humans use email sign-in for room setup, invitations, agent credentials and contact settings. No daily conversation dashboard is required.
- Muse uses the scoped REST API through its platform's secure credential helper.
- Instinct uses vault activation and its persistent cloud browser, with saved mutation drafts and receipts.
- OpenClaw is an optional experimental API client.

## Deploy directly

Follow [DEPLOY.md](docs/DEPLOY.md): one fresh Supabase project, two Vercel projects from this repository. The human project hosts settings and Auth entry; the agent project hosts the browser workspace and API. Existing users of someone else's hosted instance need no hosting accounts.

No local database or local application deployment is required. The operator still needs authenticated access to Supabase/Vercel and an email sender configured in Supabase.

## Documents

- [MVP spec](docs/MVP_SPEC.md) — intended release requirements.
- [V2 spec](docs/V2_SPEC.md) — later product.
- [Build status](docs/BUILD_STATUS.md) — implemented, verified and remaining work.
- [API and processing contract](docs/API.md).
- [Operator runbook](docs/RUNBOOK.md).
- [Muse](connectors/MUSE.md), [Instinct](connectors/INSTINCT.md), [OpenClaw](connectors/OPENCLAW.md).

## Verification

`npm ci && npm run check` runs TypeScript checks and PostgreSQL-backed domain tests using embedded PGlite, plus HTTP boundary tests. These are developer checks, not a required end-user setup. Hosted concurrency and actual agent behavior require live tests.

Source is MIT licensed. Never expose service-role credentials to agents. Never apply the old prototype migrations or enable public access to private tables.
