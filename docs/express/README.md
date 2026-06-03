# Express Guide

This guide shows a minimal, production-oriented setup for driving `@naskot/node-hmac-auth-management` from an Express app. The lib is framework-agnostic; the Express bits are confined to:

- mounting the upstream's internal-management middleware (so this API can ALSO receive propagated credentials from another authority),
- exposing one route to inspect the sync summary,
- starting a `setInterval` that calls `mgmt.http.sync()` on a cadence the operator picks.

## 1) Install

```bash
npm install @naskot/node-hmac-auth-management @naskot/node-hmac-auth express redis
```

## 2) Initialize Redis + upstream HMAC + management

```ts
import { createClient } from "redis";
import { initializeHmacHttpAuth } from "@naskot/node-hmac-auth";
import { createHmacAuthManagement } from "@naskot/node-hmac-auth-management";
import { httpCrud } from "./hmac-mgmt.crud"; // your CRUD implementation

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const hmacHttpAuth = initializeHmacHttpAuth({
  redis,
  namespace: "my-authority",
  secretToken: process.env.HMAC_SECRET_TOKEN,
  internalManagementRoute: "/api/internal/hmac",
  // v1.4.0: MANDATORY. Locks the API until this clientId is stored.
  requireBootstrapClientId: "self_propagation_signer",
});

const mgmt = await createHmacAuthManagement({
  hmacHttpAuth,
  propagationKey: "self_propagation_signer",
  http: { crud: httpCrud },
});
```

The factory is async because it awaits the propagation-key row auto-seed.

## 3) Mount the upstream management middleware

Even though THIS API is the authority, mounting the upstream middleware lets other authorities (or operators) push credentials into this API through the same `internalManagementRoute`. This is also what makes the management lib's `mgmt.http.sync()` calls reach other services that mount the same middleware.

```ts
import express, { type Request, type Response } from "express";
import { captureRawBody } from "@naskot/node-hmac-auth";

const app = express();
app.set("trust proxy", true);

app.use(
  express.json({
    verify: (req, _res, buf) => captureRawBody(req as Request, _res, buf),
  })
);

// IMPORTANT: `express.json({ verify })` only fires its callback on
// requests that carry a body. For body-less verbs (GET, DELETE, sometimes
// PATCH), `req.rawBody` stays `undefined` and the upstream lib falls back
// to `req.body` (which `express.json` sets to `{}` even for body-less
// requests) and signs `JSON.stringify({}) === "{}"` server-side while the
// client signed `""`. The result is a spurious BAD_SIGNATURE. Force an
// empty Buffer so both sides agree on `hash("")`.
app.use((req, _res, next) => {
  const r = req as Request & { rawBody?: Buffer };
  if (!r.rawBody) r.rawBody = Buffer.alloc(0);
  next();
});

// Internal-management route: GET probe + POST/PUT/PATCH/DELETE per the wire-contract.
app.use(hmacHttpAuth.createExpressInternalManagementMiddleware());

// HMAC-protected business routes:
app.use("/secure", hmacHttpAuth.verifyHttpRequest);
app.get("/secure/ping", (_req, res) => res.json({ ok: true, from: "authority" }));
```

## 4) Add a data-plane row + run sync()

```ts
app.post("/admin/credentials", async (req: Request, res: Response) => {
  const { clientId, secret, targets, allowedIps } = req.body;
  const row = await mgmt.http.add({ clientId, secret, targets, allowedIps });
  res.status(201).json(row);
});

app.post("/admin/sync", async (_req, res) => {
  const summary = await mgmt.http.sync();
  res.json(summary);
});
```

Or trigger sync() automatically on a cadence:

```ts
setInterval(
  () => {
    mgmt.http
      .sync()
      .then((summary) =>
        console.info(
          `[mgmt] sync processed=${summary.rows.processed} propagated=${summary.rows.propagated} errored=${summary.rows.errored}`
        )
      )
      .catch((error) => console.error("[mgmt] sync failed", error));
  },
  Number(process.env.HMAC_MGMT_SYNC_INTERVAL_MS ?? 5000)
);
```

`setInterval` is intentional: the lib never starts a scheduler itself.

## 5) CRUD implementation example (pg, no ORM)

The lib never imports a SQL driver. The example below uses `pg` directly:

```ts
import type { ManagedCrud, ManagedRow, ManagedRowCreateInput } from "@naskot/node-hmac-auth-management";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function rowFromDb(r: Record<string, unknown>) {
  const row: ManagedRow = {
    id: r.id as string,
    clientId: r.client_id as string,
    kind: r.kind as ManagedRow["kind"],
    secret: (r.secret as string | null) ?? null,
    targets: (r.targets as string[]) ?? [],
    allowedIps: (r.allowed_ips as string[] | null) ?? null,
    status: r.status as ManagedRow["status"],
    reason: (r.reason as string | null) ?? null,
    lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at as string) : null,
    attemptCount: Number(r.attempt_count ?? 0),
  };
  return row;
}

export const httpCrud: ManagedCrud = {
  async listPending() {
    const { rows } = await pool.query(`SELECT * FROM hmac_http_seed WHERE status IN ('pending','delete_pending')`);
    return rows.map(rowFromDb);
  },
  async listAll() {
    const { rows } = await pool.query(`SELECT * FROM hmac_http_seed`);
    return rows.map(rowFromDb);
  },
  async getById(id) {
    const { rows } = await pool.query(`SELECT * FROM hmac_http_seed WHERE id = $1`, [id]);
    return rows[0] ? rowFromDb(rows[0]) : null;
  },
  async getByClientId(clientId) {
    const { rows } = await pool.query(`SELECT * FROM hmac_http_seed WHERE client_id = $1`, [clientId]);
    return rows[0] ? rowFromDb(rows[0]) : null;
  },
  async getPropagationKeyRow() {
    const { rows } = await pool.query(`SELECT * FROM hmac_http_seed WHERE kind = 'propagation_key' LIMIT 1`);
    return rows[0] ? rowFromDb(rows[0]) : null;
  },
  async create(input: ManagedRowCreateInput) {
    const { rows } = await pool.query(
      `INSERT INTO hmac_http_seed (id, client_id, kind, secret, targets, allowed_ips, status)
       VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5::jsonb, $6::jsonb, 'pending')
       RETURNING *`,
      [
        input.id ?? null,
        input.clientId,
        input.kind,
        input.secret,
        JSON.stringify(input.targets),
        JSON.stringify(input.allowedIps ?? null),
      ]
    );
    return rowFromDb(rows[0]);
  },
  async update(id, patch) {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, value] of Object.entries(patch)) {
      const column =
        key === "lastSyncedAt"
          ? "last_synced_at"
          : key === "allowedIps"
            ? "allowed_ips"
            : key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      sets.push(`${column} = $${i++}`);
      values.push(value);
    }
    if (sets.length === 0) return;
    values.push(id);
    await pool.query(`UPDATE hmac_http_seed SET ${sets.join(", ")} WHERE id = $${i}`, values);
  },
  async delete(id) {
    await pool.query(`DELETE FROM hmac_http_seed WHERE id = $1`, [id]);
  },
  async getDeliveryState(rowId, target) {
    const { rows } = await pool.query(`SELECT * FROM hmac_http_seed_delivery_state WHERE seed_id = $1 AND target = $2`, [
      rowId,
      target,
    ]);
    if (!rows[0]) return null;
    return {
      state: rows[0].state,
      reason: rows[0].reason ?? null,
      lastAttemptAt: rows[0].last_attempt_at ? new Date(rows[0].last_attempt_at) : null,
      lastDeliveredAt: rows[0].last_delivered_at ? new Date(rows[0].last_delivered_at) : null,
      attemptCount: Number(rows[0].attempt_count ?? 0),
    };
  },
  async setDeliveryState(rowId, target, patch) {
    await pool.query(
      `INSERT INTO hmac_http_seed_delivery_state (seed_id, target, state, reason, last_attempt_at, last_delivered_at, attempt_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (seed_id, target) DO UPDATE
         SET state = EXCLUDED.state,
             reason = EXCLUDED.reason,
             last_attempt_at = EXCLUDED.last_attempt_at,
             last_delivered_at = COALESCE(EXCLUDED.last_delivered_at, hmac_http_seed_delivery_state.last_delivered_at),
             attempt_count = EXCLUDED.attempt_count,
             updated_at = NOW()`,
      [rowId, target, patch.state, patch.reason ?? null, patch.lastAttemptAt, patch.lastDeliveredAt ?? null, patch.attemptCount]
    );
  },
};
```

Replace with TypeORM, Prisma, Mongoose, or anything else that fits your codebase. The lib only sees the 10-method interface.

## 6) Behavior summary

- Calling `mgmt.http.add` / `mgmt.http.update` / `mgmt.http.remove` ONLY writes the BDD via the CRUD. The data-plane effect is delayed until the next `mgmt.http.sync()`.
- `mgmt.http.sync()` is the only call that touches Redis or the network. Drive it from a cron / route / queue / loop.
- The propagation-key clientId is reserved. Attempting `add` / `update` / `remove` on it throws `HmacAuthMgmtError` with `code === "PROPAGATION_KEY_REMOVE_FORBIDDEN"`.
- The lib NEVER opens its own HTTP listener. It signs outbound requests through the upstream's `createHttpSignedFetchClient` and routes them at `globalThis.fetch`.

The full wire specification (cryptographic primitives, payload shapes, error codes, certification test vectors) is in the upstream's [docs/wire-contract.md](https://github.com/padcmoi/node-hmac-auth/blob/main/docs/wire-contract.md).
