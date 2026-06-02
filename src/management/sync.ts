import { randomUUID } from "node:crypto";
import { hashClientSecret } from "@naskot/node-hmac-auth";
import type { InitializedHmacHttpAuth, InitializedHmacMessageAuth, PropagateHmacClientOptions } from "@naskot/node-hmac-auth";

// `PropagateApiFetch` is defined upstream but not re-exported from the
// package barrel as of v1.3.0. We derive it from the optional `apiFetch`
// field of the propagation options to stay structurally aligned.
type PropagateApiFetch = NonNullable<PropagateHmacClientOptions["apiFetch"]>;
import { HmacAuthMgmtError } from "../core/errors.js";
import type { ManagedCrud, ManagedRow, ManagementLogger, SyncSummary, TargetHealth } from "../core/types.js";
import type { PropagationKeyCache } from "../state/propagation-key-cache.js";
import { probeTarget } from "./health.js";
import { deleteRowOnTarget, pushRowToTarget, revertRowOnTarget } from "./push.js";

/**
 * Shape of the source-side credential store the sync orchestrator needs.
 * Both `hmacAuth.clients` (HTTP) and `hmacMessageAuth.clients` (message)
 * expose this surface. The factory below accepts either.
 */
export interface SourceCredentialClients {
  get: (clientId: string) => Promise<{ secretHash: string } | null>;
  setSecretHash: (
    clientId: string,
    secretHash: string,
    expiresAt?: number | Date | null,
    allowedIps?: string[],
    options?: { fromDbSeed?: boolean; purpose?: "any" | "propagation-only" }
  ) => Promise<void>;
  revert: (clientId: string) => Promise<{ reverted: boolean }>;
  delete: (clientId: string) => Promise<void>;
}

export interface RunSyncDeps {
  hmacAuth: InitializedHmacHttpAuth;
  hmacMessageAuth?: InitializedHmacMessageAuth;
  trackStore: "http" | "message";
  crud: ManagedCrud;
  sourceClients: SourceCredentialClients;
  propagationKey: string;
  propagationKeyCache: PropagationKeyCache;
  secretToken: string;
  logger?: ManagementLogger;
}

function buildEmptySummary() {
  const summary: SyncSummary = {
    durationMs: 0,
    rows: { processed: 0, propagated: 0, errored: 0, deleted: 0 },
    perTarget: new Map(),
    propagationKey: { pushedThisSync: false, targets: { delivered: [], errored: [] } },
  };
  return summary;
}

function ensurePerTarget(summary: SyncSummary, target: string, health: TargetHealth) {
  let entry = summary.perTarget.get(target);
  if (!entry) {
    entry = { health, delivered: 0, refused: 0, bootstrappedThisSync: false };
    summary.perTarget.set(target, entry);
  }
  return entry;
}

function uniqueStrings(values: Iterable<string>) {
  return Array.from(new Set(values));
}

async function ensurePropagationKeyHashLocally(
  deps: RunSyncDeps,
  propRow: ManagedRow,
  httpSourceClients: SourceCredentialClients
) {
  const existing = await httpSourceClients.get(deps.propagationKey);
  if (existing) {
    return existing.secretHash;
  }
  if (!propRow.secret) {
    throw new HmacAuthMgmtError(
      "PROPAGATION_KEY_MISSING",
      `Propagation key '${deps.propagationKey}' has no plain in BDD and no hash in source local Redis; restore the plain via deriveSecretV1 to recover`,
      409
    );
  }
  const uuid = randomUUID();
  const enriched = `${propRow.secret}:${uuid}`;
  const secretHash = hashClientSecret(enriched, deps.secretToken);
  await httpSourceClients.setSecretHash(deps.propagationKey, secretHash, null, [], {
    purpose: "propagation-only",
  });
  deps.logger?.info("propagation key hashed and stored locally", {
    track: deps.trackStore,
    clientId: deps.propagationKey,
  });
  return secretHash;
}

async function pushPropagationKeyToTarget(
  deps: RunSyncDeps,
  summary: SyncSummary,
  propRow: ManagedRow,
  target: string,
  propKeySecretHash: string,
  health: TargetHealth,
  signer: PropagateApiFetch
) {
  // Bootstrap window vs signed push: when the target reports
  // clientsCount === 0 we MUST omit the signer so the upstream lib uses
  // the unsigned bootstrap path. Otherwise we sign with the propagation
  // key (which is the only credential a v1.3.0 target accepts pre-lock).
  const useSigner = health.clientsCount === 0 ? undefined : signer;
  const result = await pushRowToTarget({
    hmacAuth: deps.hmacAuth,
    trackStore: "http",
    target,
    clientId: deps.propagationKey,
    secretHash: propKeySecretHash,
    allowedIps: [],
    purpose: "propagation-only",
    signer: useSigner,
    operation: "create",
  });
  const now = new Date();
  const prior = await deps.crud.getDeliveryState(propRow.id, target);
  if (result.accepted) {
    await deps.crud.setDeliveryState(propRow.id, target, {
      state: "delivered",
      lastAttemptAt: now,
      lastDeliveredAt: now,
      attemptCount: (prior?.attemptCount ?? 0) + 1,
    });
    summary.propagationKey.pushedThisSync = true;
    summary.propagationKey.targets.delivered.push(target);
    const entry = summary.perTarget.get(target);
    if (entry) entry.bootstrappedThisSync = true;
    deps.logger?.info("propagation key delivered", { track: deps.trackStore, target });
    return true;
  }
  await deps.crud.setDeliveryState(propRow.id, target, {
    state: "errored",
    reason: result.reason ?? null,
    lastAttemptAt: now,
    attemptCount: (prior?.attemptCount ?? 0) + 1,
  });
  summary.propagationKey.targets.errored.push(target);
  deps.logger?.warn("propagation key push refused", {
    track: deps.trackStore,
    target,
    reason: result.reason,
  });
  return false;
}

async function processDataPlaneRow(deps: RunSyncDeps, summary: SyncSummary, row: ManagedRow, signer: PropagateApiFetch) {
  // Per Trap 4: a target whose propagation key is NOT delivered yet
  // cannot accept signed data-plane pushes. Filter the row's targets
  // down to those that bootstrapped this sync OR were already known
  // to hold the propagation key.
  const eligibleTargets: string[] = [];
  const ineligibleReasons = new Map<string, string>();
  for (const target of row.targets) {
    const entry = summary.perTarget.get(target);
    if (!entry || !entry.health.reachable) {
      ineligibleReasons.set(target, "target unreachable");
      continue;
    }
    eligibleTargets.push(target);
  }

  if (eligibleTargets.length === 0) {
    await deps.crud.update(row.id, {
      status: "error",
      reason: "no eligible target (every target is unreachable)",
      secret: null,
      lastSyncedAt: new Date(),
      attemptCount: row.attemptCount + 1,
    });
    summary.rows.errored += 1;
    return;
  }

  const uuid = randomUUID();
  const enriched = `${row.secret ?? ""}:${uuid}`;
  const secretHash = hashClientSecret(enriched, deps.secretToken);

  const acceptedTargets: Array<{ target: string; effectiveOperation: "create" | "update" }> = [];
  const refusedTargets: string[] = [];
  const refusalReasons: string[] = [];

  for (const target of eligibleTargets) {
    const pushResult = await pushRowToTarget({
      hmacAuth: deps.hmacAuth,
      trackStore: deps.trackStore,
      target,
      clientId: row.clientId,
      secretHash,
      allowedIps: row.allowedIps ?? [],
      signer,
      operation: "create",
    });
    const now = new Date();
    const prior = await deps.crud.getDeliveryState(row.id, target);
    const entry = summary.perTarget.get(target);
    if (pushResult.accepted) {
      acceptedTargets.push({ target, effectiveOperation: pushResult.effectiveOperation });
      await deps.crud.setDeliveryState(row.id, target, {
        state: "delivered",
        lastAttemptAt: now,
        lastDeliveredAt: now,
        attemptCount: (prior?.attemptCount ?? 0) + 1,
      });
      if (entry) entry.delivered += 1;
    } else {
      refusedTargets.push(target);
      refusalReasons.push(`${target}: ${pushResult.reason ?? "refused"}`);
      await deps.crud.setDeliveryState(row.id, target, {
        state: "errored",
        reason: pushResult.reason ?? null,
        lastAttemptAt: now,
        attemptCount: (prior?.attemptCount ?? 0) + 1,
      });
      if (entry) entry.refused += 1;
    }
  }

  const partialFailure = refusedTargets.length > 0 || ineligibleReasons.size > 0;

  if (partialFailure) {
    // Atomic rollback. Per-target strategy depends on the effective
    // operation observed in the push:
    //   - effective "create"  -> DELETE the credential (no TTL backup
    //                            existed before the push so PATCH revert
    //                            would be a no-op).
    //   - effective "update"  -> PATCH revert to restore the previous
    //                            hash from the TTL backup written
    //                            automatically by v1.2.0+ targets when
    //                            `fromDbSeed: true` was sent.
    // Local source: same logic. If the credential was absent locally
    // before this sync, delete it; otherwise call `clients.revert`.
    for (const { target, effectiveOperation } of acceptedTargets) {
      if (effectiveOperation === "create") {
        await deleteRowOnTarget({
          hmacAuth: deps.hmacAuth,
          trackStore: deps.trackStore,
          target,
          clientId: row.clientId,
          signer,
        });
      } else {
        await revertRowOnTarget({
          hmacAuth: deps.hmacAuth,
          trackStore: deps.trackStore,
          target,
          clientId: row.clientId,
          signer,
        });
      }
    }
    // No local rollback: source-side local Redis is only written in the
    // happy path (after every target accepted). In the partial-failure
    // path the source still holds whatever it had before this sync,
    // which is by definition the pre-sync state we want to converge on.
    const reasons = [...refusalReasons, ...Array.from(ineligibleReasons.entries()).map(([t, r]) => `${t}: ${r}`)];
    await deps.crud.update(row.id, {
      status: "error",
      reason: reasons.join("; "),
      secret: null,
      lastSyncedAt: new Date(),
      attemptCount: row.attemptCount + 1,
    });
    summary.rows.errored += 1;
    deps.logger?.warn("data-plane row errored after rollback", {
      track: deps.trackStore,
      clientId: row.clientId,
      reasons,
    });
    return;
  }

  // All accepted: persist the new hash on source local Redis so the
  // consumer can immediately sign outbound calls or messages with this
  // credential.
  await deps.sourceClients.setSecretHash(row.clientId, secretHash, null, row.allowedIps ?? [], {
    fromDbSeed: false,
  });
  await deps.crud.update(row.id, {
    status: "ok",
    reason: null,
    secret: null,
    lastSyncedAt: new Date(),
    attemptCount: row.attemptCount + 1,
  });
  summary.rows.propagated += 1;
  deps.logger?.info("data-plane row delivered", {
    track: deps.trackStore,
    clientId: row.clientId,
    targets: acceptedTargets,
  });
}

async function processDeletePending(deps: RunSyncDeps, summary: SyncSummary, row: ManagedRow, signer: PropagateApiFetch) {
  let allCleared = row.targets.length > 0;
  for (const target of row.targets) {
    const entry = summary.perTarget.get(target);
    const now = new Date();
    const prior = await deps.crud.getDeliveryState(row.id, target);
    if (!entry || !entry.health.reachable) {
      allCleared = false;
      await deps.crud.setDeliveryState(row.id, target, {
        state: "errored",
        reason: "target unreachable",
        lastAttemptAt: now,
        attemptCount: (prior?.attemptCount ?? 0) + 1,
      });
      continue;
    }
    const result = await deleteRowOnTarget({
      hmacAuth: deps.hmacAuth,
      trackStore: deps.trackStore,
      target,
      clientId: row.clientId,
      signer,
    });
    if (result.accepted) {
      await deps.crud.setDeliveryState(row.id, target, {
        state: "delivered",
        lastAttemptAt: now,
        lastDeliveredAt: now,
        attemptCount: (prior?.attemptCount ?? 0) + 1,
      });
    } else {
      allCleared = false;
      await deps.crud.setDeliveryState(row.id, target, {
        state: "errored",
        reason: result.reason ?? null,
        lastAttemptAt: now,
        attemptCount: (prior?.attemptCount ?? 0) + 1,
      });
    }
  }

  if (allCleared || row.targets.length === 0) {
    try {
      await deps.sourceClients.delete(row.clientId);
    } catch (error) {
      deps.logger?.warn("local delete failed", {
        track: deps.trackStore,
        clientId: row.clientId,
        error: (error as Error).message,
      });
    }
    await deps.crud.delete(row.id);
    summary.rows.deleted += 1;
    deps.logger?.info("delete row purged", { track: deps.trackStore, clientId: row.clientId });
  } else {
    await deps.crud.update(row.id, {
      lastSyncedAt: new Date(),
      attemptCount: row.attemptCount + 1,
    });
  }
}

export async function runSync(deps: RunSyncDeps) {
  const start = Date.now();
  const summary = buildEmptySummary();

  // The propagation key always lives in the HTTP credential store (the
  // management route is HTTP-authenticated regardless of trackStore).
  const httpSourceClients: SourceCredentialClients = {
    get: (clientId) => deps.hmacAuth.clients.get(clientId).then((record) => (record ? { secretHash: record.secretHash } : null)),
    setSecretHash: (clientId, secretHash, expiresAt, allowedIps, options) =>
      deps.hmacAuth.clients.setSecretHash(clientId, secretHash, expiresAt, allowedIps, options),
    revert: (clientId) => deps.hmacAuth.clients.revert(clientId),
    delete: (clientId) => deps.hmacAuth.clients.delete(clientId),
  };

  // Only the HTTP track owns a propagation-key row in its BDD; the
  // message track shares the HTTP signer.
  const propRow = deps.trackStore === "http" ? await deps.propagationKeyCache.read() : null;

  const pendingRows = await deps.crud.listPending();
  summary.rows.processed = pendingRows.length;

  const allTargets = new Set<string>();
  for (const row of pendingRows) {
    for (const t of row.targets) allTargets.add(t);
  }
  if (propRow) {
    for (const t of propRow.targets) allTargets.add(t);
  }

  // Ensure the local propagation key hash + build the signer.
  const propKeySecretHash = await ensurePropagationKeyHashLocally(
    deps,
    propRow ?? ({ secret: null } as ManagedRow),
    httpSourceClients
  );
  const signer: PropagateApiFetch = deps.hmacAuth.createHttpSignedFetchClient({
    clientId: deps.propagationKey,
    secret: propKeySecretHash,
    secretIsHashed: true,
  });

  const newPropKeyTargets: string[] = [];

  // Phase A: probe + ensure propagation key on every target
  for (const target of allTargets) {
    const health = await probeTarget({ hmacAuth: deps.hmacAuth, signerApiFetch: signer as never }, target);
    ensurePerTarget(summary, target, health);

    if (propRow) {
      const deliveryState = await deps.crud.getDeliveryState(propRow.id, target);
      const reachable = health.reachable;
      const targetWiped = reachable && health.clientsCount === 0 && deliveryState?.state === "delivered";

      if (targetWiped) {
        deps.logger?.warn("target reset detected (clientsCount=0 with prior delivered)", {
          track: deps.trackStore,
          target,
        });
        // Trap 4: flip data-plane rows targeting this target back to pending
        const now = new Date();
        for (const row of pendingRows) {
          if (row.kind === "data_plane" && row.targets.includes(target)) {
            await deps.crud.setDeliveryState(row.id, target, {
              state: "pending",
              lastAttemptAt: now,
              attemptCount: 0,
            });
          }
        }
      }

      const needsPush = reachable && (!deliveryState || deliveryState.state !== "delivered" || targetWiped);
      if (needsPush) {
        const ok = await pushPropagationKeyToTarget(deps, summary, propRow, target, propKeySecretHash, health, signer);
        if (ok && !propRow.targets.includes(target)) {
          newPropKeyTargets.push(target);
        }
      }
    }
  }

  // Persist propagation-key target unions
  if (propRow && newPropKeyTargets.length > 0) {
    const updatedTargets = uniqueStrings([...propRow.targets, ...newPropKeyTargets]);
    await deps.crud.update(propRow.id, { targets: updatedTargets });
    deps.propagationKeyCache.refresh();
  }

  // Phase B: clear the propagation-key plain once propagated
  if (propRow && propRow.status === "pending") {
    await deps.crud.update(propRow.id, {
      status: "ok",
      reason: null,
      secret: null,
      lastSyncedAt: new Date(),
      attemptCount: propRow.attemptCount + 1,
    });
    deps.propagationKeyCache.refresh();
  }

  // Phase C: data-plane pending
  for (const row of pendingRows) {
    if (row.kind === "data_plane" && row.status === "pending") {
      await processDataPlaneRow(deps, summary, row, signer);
    }
  }

  // Phase D: delete_pending (propagation-key rows are skipped with a warn)
  for (const row of pendingRows) {
    if (row.status === "delete_pending") {
      if (row.kind === "propagation_key") {
        deps.logger?.warn("delete_pending on propagation-key row ignored (use a maintenance window)", {
          track: deps.trackStore,
          clientId: row.clientId,
        });
        continue;
      }
      await processDeletePending(deps, summary, row, signer);
    }
  }

  summary.durationMs = Date.now() - start;
  return summary;
}
