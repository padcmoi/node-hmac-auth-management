# POC - 5 services + 5 Redis + 1 MariaDB

End-to-end demonstration of `@naskot/node-hmac-auth-management` v0.1.0 on top of `@naskot/node-hmac-auth` v1.3.0. Every service ships its own Redis; api_a additionally backs its `ManagedCrud` with MariaDB through TypeORM. Each backend has a dedicated NestJS service / Express factory / Nuxt singleton / Next.js singleton wrapping the upstream lib; api_a also has a dedicated service wrapping the management lib.

## Topology

| Container       | Role                                               | Stack                    | Host port | Redis     | Token             |
| --------------- | -------------------------------------------------- | ------------------------ | --------- | --------- | ----------------- |
| `api_a_nestjs`  | Authority - runs the management lib, drives sync() | NestJS 11 + TypeORM      | `3010`    | `redis_a` | `token_alpha_A`   |
| `api_b_nestjs`  | Target                                             | NestJS 11                | `3011`    | `redis_b` | `token_beta_B`    |
| `api_c_express` | Target                                             | Express 4                | `3012`    | `redis_c` | `token_gamma_C`   |
| `app_d_nuxt`    | Target + frontend UI integrating the upstream lib  | Nuxt 4 + Tailwind v4     | `3013`    | `redis_d` | `token_delta_D`   |
| `app_e_nextjs`  | Target + frontend UI integrating the upstream lib  | Next.js 15 + Tailwind v4 | `3014`    | `redis_e` | `token_epsilon_E` |
| `mariadb`       | api_a's ManagedCrud storage (TypeORM-synchronized) | MariaDB 11               | -         | -         | -                 |

Every service is locked behind `requireBootstrapClientId: "self_propagation_signer"` so the very first POST a fresh Redis accepts has to be the propagation-key bootstrap from api_a.

api_a is the SINGLE source of truth: the Nuxt admin page writes rows into MariaDB through api_a's unauthenticated `/admin/rows` REST surface, and the lib's `sync()` (a `setInterval` of 20s) propagates them to every target.

## Service abstractions

- `node-hmac-auth` wrapper, one per service:
  - `api-a-nestjs/src/hmac-auth.service.ts` (NestJS @Injectable)
  - `api-b-nestjs/src/hmac-auth.service.ts` (NestJS @Injectable)
  - `api-c-express/src/hmac-auth.service.ts` (Express factory)
  - `app-d-nuxt/server/utils/hmac-auth.service.ts` (Nitro singleton)
  - `app-e-nextjs/src/server/hmac-auth.service.ts` (Next.js server singleton)
- `node-hmac-auth-management` wrapper, only on api_a:
  - `api-a-nestjs/src/hmac-auth-management.service.ts` (NestJS @Injectable depending on the auth service + the TypeORM DataSource)

## How to run

```bash
docker compose up --build
```

UIs:

- Nuxt 4: http://localhost:3013/ (peers view) + http://localhost:3013/admin (CRUD on api_a's MariaDB)
- Next.js 15: http://localhost:3014/ (peers view + signed pings via Server Actions)

api_a admin REST surface (unauthenticated, intended for the Nuxt UI):

- `GET    /admin/rows`
- `GET    /admin/rows/:id`
- `POST   /admin/rows` body: `{ clientId, secret, targets, allowedIps? }`
- `PUT    /admin/rows/:id` body: `{ newSecret, targets?, allowedIps? }`
- `DELETE /admin/rows/:id`
- `GET    /admin/delivery-states/:rowId`
- `POST   /admin/sync` triggers an out-of-band sync()

## Feature coverage matrix

| Feature                                                     | Drivers                                       | What to observe                                                                         |
| ----------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| Auto-seed of the propagation-key row                        | api_a boot                                    | `[mgmt] auto-seed: inserted propagation-key row` log line                               |
| 20s `setInterval` sync()                                    | api_a `HmacSyncScheduler`                     | `[mgmt] sync processed=N propagated=N ...` every 20s                                    |
| Bootstrap of the propagation key on each target (v1.3.0 F2) | sync() Phase A                                | `summary.propagationKey.pushedThisSync = true` on first sync                            |
| `purpose: "propagation-only"` cantonment (v1.3.0 F1)        | sync() Phase A                                | Each target's Redis stores `self_propagation_signer` with `purpose: "propagation-only"` |
| Data-plane propagation atomic with rollback                 | sync() Phase C                                | Row status flips to `ok` on success or `error` (with `reason`) on partial failure       |
| Trap 4: target reset detection                              | sync() Phase A re-probe                       | `[mgmt] target reset detected ...` after wiping any target's Redis                      |
| Delete propagation (best-effort)                            | Nuxt admin "Delete" button + sync() Phase D   | Row purged from MariaDB once every target reported                                      |
| Cross-token signed business calls                           | "Ping <peer>" buttons in Nuxt and Next.js UIs | 200 from peer with `authenticatedAs: client_consumer_d` / `client_consumer_e`           |
| Cross-token signed reads of remote credential stores        | "Fetch credentials" cards in both UIs         | Peer responds with its own `clientIds` list                                             |
| Admin CRUD via REST (no auth) backed by MariaDB / TypeORM   | Nuxt `/admin` page                            | New row appears in api_a's MariaDB; status reflects propagation outcome                 |

## Per-POC tooling

| POC             | `npm install`      | `npm run check`  | `npm run lint` | `npm run build` |
| --------------- | ------------------ | ---------------- | -------------- | --------------- |
| `api-a-nestjs`  | --legacy-peer-deps | `tsc --noEmit`   | eslint         | `tsc --noEmit`  |
| `api-b-nestjs`  | --legacy-peer-deps | `tsc --noEmit`   | eslint         | `tsc --noEmit`  |
| `api-c-express` | --legacy-peer-deps | `tsc --noEmit`   | eslint         | `tsc --noEmit`  |
| `app-d-nuxt`    | --legacy-peer-deps | `nuxi typecheck` | -              | `nuxt build`    |
| `app-e-nextjs`  | --legacy-peer-deps | `tsc --noEmit`   | eslint         | `next build`    |

Each POC's `package.json` exposes these scripts; running them from each directory yields 0 errors.

## Verifying Redis coherence

Once the stack is up and the first sync() ran, every target's Redis should hold byte-identical `secretHash` values for each propagated clientId, even though the source and targets use different `HMAC_SECRET_TOKEN` values. The Nuxt + Next.js UIs both expose a "Fetch credentials" card per peer that signs `GET /secure/credentials/local` with `client_consumer_d` / `client_consumer_e` and renders the verbatim response. Identical clientId lists across cards = federation in sync.

You can also inspect any target's Redis directly:

```bash
docker exec mgmt-poc-redis-b redis-cli HKEYS api_b:clients
docker exec mgmt-poc-redis-c redis-cli HKEYS api_c:clients
docker exec mgmt-poc-redis-d redis-cli HKEYS app_d:clients
docker exec mgmt-poc-redis-e redis-cli HKEYS app_e:clients
```

The output of all four should converge to `self_propagation_signer` + every data-plane clientId you created through the Nuxt admin UI.
