# node-hmac-auth-management

Stateful orchestration layer on top of [`@naskot/node-hmac-auth`](https://github.com/padcmoi/node-hmac-auth). The consumer drives a BDD via a CRUD; the lib is the worker that probes targets, bootstraps the propagation key, propagates data-plane credentials, retries idempotently, and rolls back atomically on partial failure.

`@naskot/node-hmac-auth >=1.3.0` is a strict peer dependency: the lib uses `requireBootstrapClientId` (F2) and `purpose: "propagation-only"` (F1) from the upstream v1.3.0 release.

[![npm version](https://img.shields.io/npm/v/%40naskot%2Fnode-hmac-auth-management)](https://www.npmjs.com/package/@naskot/node-hmac-auth-management)
[![TypeScript Ready](https://img.shields.io/badge/TypeScript-Ready-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

## When to use this lib

`@naskot/node-hmac-auth` v1.2.0 already exposes every primitive needed to authenticate a federation of APIs: signing, verifying, propagating, storing, reverting. What it does NOT provide is a higher-level orchestrator that:

- holds the per-target propagation state across boots,
- atomically rolls back a rotation when one target refuses,
- detects a target that lost its Redis (clientsCount=0 with a prior delivered state) and re-pushes the propagation key first,
- enforces that the credential signing every management call cannot be misused on a business route.

This lib packages that orchestration once, framework-agnostic, behind a single `createHmacAuthManagement(options)` entrypoint. The consumer plugs in two things:

1. an already-initialized `hmacHttpAuth` (and optionally `hmacMessageAuth`) from the upstream lib,
2. a `ManagedCrud` implementation against whatever storage they want (SQL via TypeORM, Postgres native, Mongo, REST, an in-memory `Map` for tests).

## Minimal example

```ts
import { createHmacAuthManagement, type ManagedCrud } from "@naskot/node-hmac-auth-management";
import { hmacHttpAuth } from "./hmac.service";
import { myCrud } from "./hmac-mgmt.crud";

const mgmt = await createHmacAuthManagement({
  hmacHttpAuth,
  propagationKey: "self_propagation_signer",
  http: { crud: myCrud satisfies ManagedCrud },
});

// 1. Declare a data-plane row in the BDD only (no Redis, no network):
await mgmt.http.add({
  clientId: "client_partner_a",
  secret: "partnerA-secret",
  targets: ["https://api-a.example.com", "https://api-b.example.com"],
  allowedIps: [],
});

// 2. Drive sync() from your own cron / route / queue / loop:
const summary = await mgmt.http.sync();
console.log(`processed=${summary.rows.processed} propagated=${summary.rows.propagated} errored=${summary.rows.errored}`);
```

The lib never starts a cron, never opens an HTTP server, never imports a framework. `sync()` runs exactly once per call; the consumer decides when.

## Public surface

`createHmacAuthManagement(options)` returns:

```ts
{
  propagationKey: string,
  http:    HmacAuthManagementTrack,
  message: HmacAuthManagementTrack | undefined,
}
```

Each `HmacAuthManagementTrack` exposes 9 methods:

| Method                            | What it does                                               | Touches BDD | Touches Redis | Touches network |
| --------------------------------- | ---------------------------------------------------------- | ----------- | ------------- | --------------- |
| `add({ clientId, secret, ... })`  | insert a `data_plane` row with `status: "pending"`         | yes         | no            | no              |
| `update({ clientId, newSecret })` | patch an existing row back to `pending`                    | yes         | no            | no              |
| `remove({ clientId })`            | flip an existing row to `delete_pending`                   | yes         | no            | no              |
| `sync()`                          | the worker: probe + bootstrap + push + retry + rollback    | yes         | yes           | yes             |
| `get(clientId)`                   | read the row + the live `secretHash` on source local Redis | yes         | yes           | no              |
| `list()`                          | read every row from the BDD                                | yes         | no            | no              |
| `health(target)`                  | probe one target's `/internalManagementRoute`              | no          | no            | yes             |
| `healthAll(targets?)`             | probe many targets at once                                 | optional    | no            | yes             |
| `getDeliveryStatus({ ... })`      | read the per-(row, target) cursor                          | yes         | no            | no              |

## The propagation key is special

The clientId you pass as `options.propagationKey` is the credential that signs every push to every target's management route. The lib:

- auto-seeds the row in the BDD at boot when missing, using a deterministic plain derived from `(secretToken, propagationKey)` via `deriveSecretV1` (FROZEN for the v0.x.x / v1.x.x lifetime);
- stores it locally with `purpose: "propagation-only"` so the upstream v1.3.0 enforcement layer rejects any signed request that does NOT target the management route;
- refuses `add` / `update` / `remove` on the propagation-key clientId with `HmacAuthMgmtError.code === "PROPAGATION_KEY_REMOVE_FORBIDDEN"`. A legitimate rotation goes through an operator-controlled maintenance window (manual delete from the BDD + Redis flush + management instance restart).

Pairing the propagation key with the upstream `requireBootstrapClientId` option on every target guarantees that a fresh target only accepts the named credential on its first unsigned POST. Everything else returns `403 BOOTSTRAP_LOCKED` until the lock is released.

## Atomicity per row kind

`sync()` distinguishes three cases with three different semantics:

- **Propagation key** (`kind: "propagation_key"`): **non-atomic**. Pushed to every target in parallel. A target that refuses does NOT trigger a rollback on others, because a v1.3.0 target with the lock active refuses everything until the propagation key is stored. Pushing on every retry is always-good.
- **Data plane** (`kind: "data_plane"`, `status: "pending"`): **atomic**. If any target refuses or is unreachable, the lib rolls back by sending `DELETE` to every target that already accepted (for first-time creates) or `PATCH revert` (for rotations, using the v1.2.0 TTL backup). The BDD row flips to `status: "error"` with a `reason` that lists every offending target. The plain is cleared either way; the consumer must insert a fresh plain to retry.
- **Delete** (`status: "delete_pending"`): **non-atomic, best-effort**. A target that refuses or is unreachable keeps the credential; the per-(row, target) cursor flips to `errored` so the next `sync()` retries. Once every target reported, the row is purged from the BDD and removed from source local Redis.

## Trap 4: target reset detection

A target whose Redis was wiped (cluster restart, disaster recovery, manual flush) reports `clientsCount === 0` even though the lib's per-(row, target) cursor remembers a previous `delivered`. `sync()` treats that as a target reset and:

- re-pushes the propagation key to that target via the bootstrap window,
- flips every data-plane row that already had `delivered` for that target back to `pending` so the next loop re-propagates them too.

Other targets are not affected.

## TypeORM example (schema documented; the lib is storage-agnostic)

```sql
CREATE TABLE hmac_http_seed (
  id              VARCHAR(36)  NOT NULL,
  client_id       VARCHAR(128) NOT NULL,
  kind            ENUM('data_plane','propagation_key') NOT NULL DEFAULT 'data_plane',
  secret          TEXT         NULL,
  targets         JSON         NOT NULL,
  allowed_ips     JSON         NULL,
  status          ENUM('pending','ok','error','delete_pending') NOT NULL DEFAULT 'pending',
  reason          TEXT         NULL,
  last_synced_at  DATETIME(3)  NULL,
  attempt_count   INT UNSIGNED NOT NULL DEFAULT 0,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE INDEX uq_http_client_id (client_id),
  INDEX idx_http_status_kind (status, kind),
  INDEX idx_http_last_synced_at (last_synced_at)
) ENGINE=InnoDB;

CREATE TABLE hmac_http_seed_delivery_state (
  seed_id            VARCHAR(36)  NOT NULL,
  target             VARCHAR(512) NOT NULL,
  state              ENUM('pending','delivered','errored') NOT NULL DEFAULT 'pending',
  reason             TEXT         NULL,
  last_attempt_at    DATETIME(3)  NULL,
  last_delivered_at  DATETIME(3)  NULL,
  attempt_count      INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (seed_id, target),
  INDEX idx_http_delivery_state (state),
  INDEX idx_http_last_attempt (last_attempt_at),
  FOREIGN KEY (seed_id) REFERENCES hmac_http_seed(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

Replace `JSON` with `JSONB` on Postgres. The same shape mirrored under `hmac_message_seed*` is what `options.message?.crud` is expected to read.

## Wire contract

This lib does not introduce new wire bytes. Every byte sent over the network is documented in [docs/wire-contract.md](https://github.com/padcmoi/node-hmac-auth/blob/main/docs/wire-contract.md) of the upstream package. Any cross-language port (Python, Go, Rust, ...) certifying against that document is automatically interoperable with the lib.

## Limitations of v0.1.0

- The HTTP track is the full orchestrator; the optional message track reuses the HTTP propagation key for signing (no separate propagation key in the message CRUD). A future v0.2.0 may revisit this if message-only consumers materialize.
- A target whose Redis already holds other clients but NOT the propagation key cannot be bootstrapped by the lib (the bootstrap window is only open at `clientsCount === 0`). This is out of scope for v0.1.0; treat such targets as operator-managed.

## Tests

```bash
npm install
npm run check
npm test
npm run build
```

The vitest suite covers the deterministic golden vectors of `deriveSecretV1`, the auto-seed boot behavior, an end-to-end `sync()` with two distinct-token targets, the atomic rollback path, the remove flow, and the target-reset detection.

## License

[MIT](./LICENSE).
