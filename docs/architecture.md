# Architecture (Contributors)

This document describes the internal source layout of `@naskot/node-hmac-auth-management` and the contract each domain holds. It is meant for contributors and reviewers; consumer documentation lives in [docs/express/README.md](./express/README.md), [docs/nestjs/README.md](./nestjs/README.md), and [docs/release-notes/](./release-notes/).

## Goals

- Keep one stable public entrypoint: `src/index.ts`.
- Group implementation by domain (`core`, `management`, `state`).
- Stay framework-agnostic. The lib never imports Express, NestJS, or any storage driver.
- Reuse every primitive from `@naskot/node-hmac-auth >=1.4.0` through its public surface; never reach into upstream internals.

## Source layout

```txt
src/
  index.ts                              # single public entrypoint - all exports go through here
  core/
    types.ts                            # public TypeScript types (ManagedRow, ManagedCrud, options, SyncSummary, ...)
    errors.ts                           # HmacAuthMgmtError + 8 typed error codes
    derive.ts                           # deriveSecretV1 (FROZEN for v0.x.x and v1.x.x)
  management/
    init.ts                             # createHmacAuthManagement orchestration only (wires every unit below)
    auto-seed.ts                        # auto-seed of the propagation-key row in the HTTP CRUD at boot
    track.ts                            # createTrack factory (returns the 9-method HmacAuthManagementTrack)
    sync.ts                             # runSync orchestrator (Phase A probe + bootstrap, Phase B finalize, Phase C atomic, Phase D delete)
    push.ts                             # pushRowToTarget + retry create<->update swap + deleteRowOnTarget + revertRowOnTarget
    health.ts                           # probeTarget (normalizes the upstream GET /api/internal/hmac response)
  state/
    propagation-key-cache.ts            # 1-read-per-boot cache for the propagation-key row
```

## Responsibilities

- **`core`**: shared primitives. Pure functions, no Redis, no I/O. The dependency floor of every other domain.
  - `derive.ts` exposes the only deterministic primitive in the lib: `deriveSecretV1(secretToken, propagationKey)`. The function is FROZEN for the v0.x.x and v1.x.x lifetime; any algorithm drift would invalidate every propagation-key row stored in consumer BDDs. A golden vitest test (`test/derive.golden.test.ts`) guards against accidental change.
  - `errors.ts` exposes `HmacAuthMgmtError` with a typed `code` union. New codes MUST be appended (additive) so consumer pattern-matching stays forward-compatible.
  - `types.ts` is the single source of truth for every public type. Internal helper types stay un-exported.

- **`management`**: the orchestrator domain. Every public method on a track maps to one or more units here.
  - `init.ts` returns `HmacAuthManagement` by composing `runAutoSeed` + `createTrack` for the HTTP track (always) and the optional message track. Kept short on purpose.
  - `auto-seed.ts` inserts the propagation-key row in the HTTP CRUD only when missing. Idempotent on repeated boots. The plain is `deriveSecretV1(secretToken, propagationKey)`.
  - `track.ts` builds the 9-method surface. Enforces 2 invariants up front: (a) `add`/`update`/`remove` only write to the BDD via the CRUD, never the network; (b) `add`/`update`/`remove` on the propagation-key clientId are refused with `PROPAGATION_KEY_REMOVE_FORBIDDEN`.
  - `sync.ts` is the worker. Orchestrates 4 phases per call: probe + bootstrap (A), propagation-key BDD finalize (B), data-plane atomic propagation with rollback (C), best-effort delete (D). Implements the per-(row, target) cursor write through `crud.setDeliveryState`.
  - `push.ts` encapsulates the upstream's `propagateClientToApis` call for one row, one operation, one target, plus the create<->update swap retry on the two well-known FORBIDDEN messages.
  - `health.ts` issues a single `GET internalManagementRoute` probe and normalizes the response into a `TargetHealth` (defaults `bootstrapLocked: false` so consumers targeting `< v1.4.0` keep working).

- **`state`**: per-instance caches.
  - `propagation-key-cache.ts` caches the propagation-key row for the management instance lifetime. Refreshed after any internal mutation (status flip, targets union, secret clear).

## Public API rule

- Export public symbols only from `src/index.ts`.
- Internal files can move, but public exports must stay stable unless intentionally released as a breaking change. Major version bumps document any such break in [CHANGELOG.md](../CHANGELOG.md).
- The `ManagedCrud` interface is contractually frozen for the v0.x.x line: a consumer that ships a CRUD implementation against v0.1.0 SHOULD compile against v0.2.0 without any change.

## Import conventions

- Prefer imports by domain path (for example `../core/types.js`).
- Avoid circular dependencies between domains.
- `core` should stay dependency-light and reusable by every other domain. It depends only on Node built-ins (`node:crypto`) and the upstream lib type re-exports.
- `management` imports from `core` and `state`. `state` imports only from `core`.
- The lib NEVER imports from `@naskot/node-hmac-auth` deep paths; only the public package barrel.

## Change workflow

- Add or modify code in the relevant domain folder.
- Re-export intentionally public additions in `src/index.ts`. If a type is purely internal (helper, narrow wrapper), keep it unexported.
- Validate with:
  - `npm run check` — `tsc --noEmit` over the source.
  - `npm test` — vitest suite under `test/`. Add a focused case in the matching `test/<domain>.test.ts` file.
  - `npm run lint` — ESLint over `src/**/*.ts`.
  - `npm run build` — tsup produces `dist/index.{js,cjs,d.ts,d.cts}`. Required before any release.
- `npm run prepublishOnly` chains check + test + build. This is the gate before publishing a tag.
- Run the POC (`poc/docker-compose.yml`) when changing anything that affects the wire format, the management route, or the propagation flow. The POC ships with 4 services + 4 distinct Redis instances + distinct `HMAC_SECRET_TOKEN` values so cross-token behavior is exercised end-to-end at every change.

## Related documentation

- Consumer guides: [docs/express/README.md](./express/README.md), [docs/nestjs/README.md](./nestjs/README.md).
- Release notes: [docs/release-notes/](./release-notes/).
- Sequence and component diagrams: [docs/diagrams/](./diagrams/).
- POC playground: [poc/README.md](../poc/README.md).
- Upstream wire contract (the bytes this lib emits): [docs/wire-contract.md](https://github.com/padcmoi/node-hmac-auth/blob/main/docs/wire-contract.md) in the `@naskot/node-hmac-auth` repository.
