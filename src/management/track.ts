import type { InitializedHmacHttpAuth, InitializedHmacMessageAuth } from "@naskot/node-hmac-auth";
import { HmacAuthMgmtError } from "../core/errors.js";
import type {
  AddTrackInput,
  GetDeliveryStatusInput,
  HmacAuthManagementTrack,
  ManagedCrud,
  ManagedRow,
  ManagedRowWithSecretHash,
  ManagementLogger,
  RemoveTrackInput,
  TargetHealth,
  UpdateTrackInput,
} from "../core/types.js";
import type { PropagationKeyCache } from "../state/propagation-key-cache.js";
import { probeTarget } from "./health.js";
import { runSync, type SourceCredentialClients } from "./sync.js";

/**
 * Build a single track surface (HTTP or message). The 9 methods documented
 * in short.md are bound to the right CRUD, store and signer here. The
 * implementation enforces 2 invariants up front:
 *
 *   1. `remove({ clientId: propagationKey })` is refused with
 *      `PROPAGATION_KEY_REMOVE_FORBIDDEN`. Removing the propagation key
 *      breaks the mesh; an operator must do it through a maintenance
 *      window (manual DELETE + Redis flush + management instance
 *      restart).
 *
 *   2. `add` / `update` / `remove` ONLY write to the consumer BDD via
 *      `crud`. They never touch Redis or the network. The data-plane
 *      effects are batched and executed by `sync()`.
 */
export interface CreateTrackDeps {
  trackStore: "http" | "message";
  hmacAuth: InitializedHmacHttpAuth;
  hmacMessageAuth?: InitializedHmacMessageAuth;
  crud: ManagedCrud;
  sourceClients: SourceCredentialClients;
  propagationKey: string;
  propagationKeyCache: PropagationKeyCache;
  secretToken: string;
  logger?: ManagementLogger;
}

function assertNonEmpty(value: string, field: string) {
  if (!value || !value.trim()) {
    throw new HmacAuthMgmtError("INVALID_INPUT", `${field} cannot be empty`, 400);
  }
}

function assertNotPropagationKey(deps: CreateTrackDeps, clientId: string, operation: string) {
  if (clientId === deps.propagationKey) {
    throw new HmacAuthMgmtError(
      "PROPAGATION_KEY_REMOVE_FORBIDDEN",
      `Cannot ${operation} clientId '${clientId}': it is reserved for the propagation key on this track`,
      409
    );
  }
}

export function createTrack(deps: CreateTrackDeps) {
  const track: HmacAuthManagementTrack = {
    async add(input: AddTrackInput) {
      assertNonEmpty(input.clientId, "clientId");
      assertNonEmpty(input.secret, "secret");
      assertNotPropagationKey(deps, input.clientId, "add");
      if (!Array.isArray(input.targets) || input.targets.length === 0) {
        throw new HmacAuthMgmtError("INVALID_INPUT", "targets must contain at least one URL", 400);
      }
      const existing = await deps.crud.getByClientId(input.clientId);
      if (existing) {
        throw new HmacAuthMgmtError(
          "MANAGED_ROW_ALREADY_EXISTS",
          `Row for clientId '${input.clientId}' already exists; use update() instead`,
          409
        );
      }
      const created = await deps.crud.create({
        clientId: input.clientId,
        kind: "data_plane",
        secret: input.secret,
        targets: input.targets,
        allowedIps: input.allowedIps ?? null,
      });
      return created;
    },

    async update(input: UpdateTrackInput) {
      assertNonEmpty(input.clientId, "clientId");
      assertNonEmpty(input.newSecret, "newSecret");
      assertNotPropagationKey(deps, input.clientId, "update");
      const existing = await deps.crud.getByClientId(input.clientId);
      if (!existing) {
        throw new HmacAuthMgmtError(
          "MANAGED_ROW_NOT_FOUND",
          `Row for clientId '${input.clientId}' not found; use add() instead`,
          404
        );
      }
      await deps.crud.update(existing.id, {
        secret: input.newSecret,
        status: "pending",
        reason: null,
        targets: input.targets,
        allowedIps: input.allowedIps ?? null,
      });
      const refreshed = await deps.crud.getById(existing.id);
      if (!refreshed) {
        throw new HmacAuthMgmtError(
          "MANAGED_ROW_NOT_FOUND",
          `Row '${existing.id}' disappeared between update() and getById()`,
          500
        );
      }
      return refreshed;
    },

    async remove(input: RemoveTrackInput) {
      assertNonEmpty(input.clientId, "clientId");
      assertNotPropagationKey(deps, input.clientId, "remove");
      const existing = await deps.crud.getByClientId(input.clientId);
      if (!existing) {
        throw new HmacAuthMgmtError("MANAGED_ROW_NOT_FOUND", `Row for clientId '${input.clientId}' not found`, 404);
      }
      await deps.crud.update(existing.id, { status: "delete_pending", reason: null });
      const refreshed = await deps.crud.getById(existing.id);
      return refreshed ?? existing;
    },

    sync() {
      return runSync({
        hmacAuth: deps.hmacAuth,
        hmacMessageAuth: deps.hmacMessageAuth,
        trackStore: deps.trackStore,
        crud: deps.crud,
        sourceClients: deps.sourceClients,
        propagationKey: deps.propagationKey,
        propagationKeyCache: deps.propagationKeyCache,
        secretToken: deps.secretToken,
        logger: deps.logger,
      });
    },

    async get(clientId: string) {
      assertNonEmpty(clientId, "clientId");
      const row = await deps.crud.getByClientId(clientId);
      if (!row) {
        return null;
      }
      const sourceRecord = await deps.sourceClients.get(clientId);
      const result: ManagedRowWithSecretHash = {
        ...row,
        secretHash: sourceRecord?.secretHash ?? null,
      };
      return result;
    },

    async list() {
      return deps.crud.listAll();
    },

    async health(target: string) {
      assertNonEmpty(target, "target");
      return probeTarget({ hmacAuth: deps.hmacAuth }, target);
    },

    async healthAll(targets?: string[]) {
      const out = new Map<string, TargetHealth>();
      let resolved = targets;
      if (!resolved) {
        const all = await deps.crud.listAll();
        const targetSet = new Set<string>();
        for (const row of all) {
          for (const t of row.targets) targetSet.add(t);
        }
        resolved = Array.from(targetSet);
      }
      for (const target of resolved) {
        const health = await probeTarget({ hmacAuth: deps.hmacAuth }, target);
        out.set(target, health);
      }
      return out;
    },

    async getDeliveryStatus(input: GetDeliveryStatusInput) {
      assertNonEmpty(input.clientId, "clientId");
      assertNonEmpty(input.target, "target");
      const row = await deps.crud.getByClientId(input.clientId);
      if (!row) {
        return null;
      }
      return deps.crud.getDeliveryState(row.id, input.target);
    },
  };

  return track;
}

/** Touch the ManagedRow typing graph so `tsc` flags an accidental break. */
export type _ManagedRow = ManagedRow;
