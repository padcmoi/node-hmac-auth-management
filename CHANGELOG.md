# Changelog

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Semantic Versioning.

## [0.1.0] - 2026-06-01

Initial release. Strictly additive on top of `@naskot/node-hmac-auth >=1.3.0` (declared as a peer dependency).

- `chore(tooling): scaffold v0.1.0 package metadata (package.json, tsconfig, eslint, prettier, .vscode, .github/workflows publish.yml)`
- `feat(core): public types + HmacAuthMgmtError with 8 codes (PROPAGATION_KEY_REMOVE_FORBIDDEN, PROPAGATION_KEY_MISSING, MANAGED_ROW_NOT_FOUND, MANAGED_ROW_ALREADY_EXISTS, INVALID_OPTIONS, INVALID_INPUT, TARGET_PROBE_FAILED, INTERNAL_ERROR) + deriveSecretV1 FROZEN derivation primitive`
- `feat(state+management): createHmacAuthManagement + auto-seed propagation key + track factory (9 methods per track) + 4-phase sync orchestrator (probe/bootstrap A, BDD finalize B, atomic data-plane C, best-effort delete D) + push retry/rollback/revert + health probe + propagation-key cache`
- `feat(index): single public entrypoint re-exports (createHmacAuthManagement, HmacAuthMgmtError, deriveSecretV1, every public type + InitializedHmacHttpAuth / InitializedHmacMessageAuth from the upstream package)`
- `test(vitest): 18 cases - derive.golden (6) + auto-seed (5) + sync end-to-end with fake-target mesh (4) + refuse-propagation-key-remove (3)`
- `docs(architecture+release-notes+readme+changelog): 0.1.0 long-form + index`
- `docs(express+nestjs): consumer guides with pg + TypeORM examples + req.rawBody Buffer.alloc(0) safeguard for body-less verbs (BAD_SIGNATURE gotcha)`
- `docs(diagrams): architecture + seq-sync-happy + seq-sync-rollback + seq-target-reset (.puml + .png regenerated)`
- `demo(poc): docker-compose 5 services + 5 Redis + MariaDB; api_a NestJS authority running mgmt lib with TypeORM-backed ManagedCrud + admin REST CRUD (/admin/rows GET/POST/PUT/DELETE + /admin/delivery-states/:rowId + /admin/sync) + 20s sync setInterval`
- `demo(poc): api_b NestJS + api_c Express targets via HmacAuthService abstraction; rawBody=Buffer.alloc(0) safeguard for GET signature parity`
- `demo(poc): app_d Nuxt 4 + Tailwind v4 - peers view + signed pings + admin page driving full CRUD on api_a MariaDB via /admin/rows; Nitro h3 middleware mirroring the upstream internal-management dispatch`
- `demo(poc): app_e Next.js 15 + Tailwind v4 - Server Actions for peers view + signed pings + /secure/business + /secure/credentials/local + /api/internal/hmac route handlers`
- `chore(release): cut 0.1.0`

### Out of scope (v0.1.0)

- A target whose Redis already holds other clients but NOT the propagation key cannot be bootstrapped by the lib (the upstream bootstrap window is only open at `clientsCount === 0`). Such targets must be set up manually before being managed by the lib.
- The optional message track reuses the HTTP propagation key for signing; a future v0.2.0 may revisit this if a message-only consumer requires a separate propagation key in the message CRUD.
