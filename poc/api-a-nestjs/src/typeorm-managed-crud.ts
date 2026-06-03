import type { DataSource, Repository } from "typeorm";
import type {
  DeliveryStateRecord,
  DeliveryStateUpdatePatch,
  ManagedCrud,
  ManagedRow,
  ManagedRowCreateInput,
  ManagedRowUpdatePatch,
} from "@naskot/node-hmac-auth-management";
import { DEFAULT_PROPAGATION_KEY_CLIENT_ID, deriveSecretV1 } from "@naskot/node-hmac-auth-management";
import { HmacHttpPropagationKeyTargetEntity } from "./entities/hmac-http-propagation-key-target.entity";
import { HmacDataPlaneSeedEntity } from "./entities/hmac-data-plane-seed.entity";
import { HmacDataPlaneDeliveryStateEntity } from "./entities/hmac-data-plane-delivery-state.entity";

/**
 * TypeORM adapter satisfying the lib's `ManagedCrud`. v0.2.0 r3:
 *
 *   hmac_http_propagation_key_targets   -> HTTP-only. One row per target. NO
 *                                          row for the propagation key itself
 *                                          (clientId hardcoded, secret derived).
 *   hmac_data_plane_seed                -> rotating credentials, ONE table for
 *                                          HTTP + message (column `track`).
 *   hmac_data_plane_delivery_state      -> per-(seed, target) cursor, both
 *                                          tracks share the table.
 *
 * `createTypeOrmManagedCrud(dataSource, "http")` returns a CRUD that filters
 * data-plane reads to track="http" AND attaches the propagation-key targets
 * table (the prop key is HTTP-only); pass "message" to get the message track
 * (no prop-key targets there, since propagation is HTTP-only).
 */
const PROPAGATION_KEY_VIRTUAL_ID = "__propagation_key__";

export function createTypeOrmManagedCrud(
  dataSource: DataSource,
  track: "http" | "message" = "http",
  secretToken?: string
): ManagedCrud {
  const propTargetRepo: Repository<HmacHttpPropagationKeyTargetEntity> = dataSource.getRepository(
    HmacHttpPropagationKeyTargetEntity
  );
  const dataPlaneRepo: Repository<HmacDataPlaneSeedEntity> = dataSource.getRepository(HmacDataPlaneSeedEntity);
  const dataPlaneStateRepo: Repository<HmacDataPlaneDeliveryStateEntity> =
    dataSource.getRepository(HmacDataPlaneDeliveryStateEntity);

  const dataPlaneToRow = (e: HmacDataPlaneSeedEntity): ManagedRow => ({
    id: e.id,
    clientId: e.clientId,
    kind: "data_plane",
    secret: e.secret,
    targets: e.targets ?? [],
    allowedIps: e.allowedIps ?? null,
    status: e.status,
    reason: e.reason,
    lastSyncedAt: e.lastSyncedAt,
    attemptCount: e.attemptCount,
  });

  async function buildPropagationKeyVirtualRow(): Promise<ManagedRow | null> {
    if (track !== "http") return null;
    const targets = await propTargetRepo.find();
    if (targets.length === 0) return null;
    const aggregateStatus: ManagedRow["status"] = targets.every((t) => t.state === "delivered")
      ? "ok"
      : targets.some((t) => t.state === "errored")
        ? "error"
        : "pending";
    const lastSynced = targets
      .map((t) => t.lastDeliveredAt)
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const attemptCount = targets.reduce((max, t) => Math.max(max, t.attemptCount), 0);
    // The propagation key has no secret column in BDD. We derive it on the fly
    // from secretToken via the lib's FROZEN deriveSecretV1 primitive so the
    // lib's sync flow can compute the hash and bootstrap. Reproducible across
    // boots without any persistent storage.
    const derivedPlain = secretToken ? deriveSecretV1(secretToken, DEFAULT_PROPAGATION_KEY_CLIENT_ID) : null;
    return {
      id: PROPAGATION_KEY_VIRTUAL_ID,
      clientId: DEFAULT_PROPAGATION_KEY_CLIENT_ID,
      kind: "propagation_key",
      secret: derivedPlain,
      targets: targets.map((t) => t.target).sort(),
      allowedIps: null,
      status: aggregateStatus,
      reason: targets.find((t) => t.reason)?.reason ?? null,
      lastSyncedAt: lastSynced ?? null,
      attemptCount,
    };
  }

  const crud: ManagedCrud = {
    async listPending() {
      const [propRow, dataPlane] = await Promise.all([
        buildPropagationKeyVirtualRow(),
        dataPlaneRepo
          .createQueryBuilder("d")
          .where("d.track = :track AND d.status IN (:...statuses)", {
            track,
            statuses: ["pending", "delete_pending"],
          })
          .getMany(),
      ]);
      const rows: ManagedRow[] = [];
      if (propRow && propRow.status !== "ok") rows.push(propRow);
      rows.push(...dataPlane.map(dataPlaneToRow));
      return rows;
    },
    async listAll() {
      const [propRow, dataPlane] = await Promise.all([buildPropagationKeyVirtualRow(), dataPlaneRepo.find({ where: { track } })]);
      const rows: ManagedRow[] = [];
      if (propRow) rows.push(propRow);
      rows.push(...dataPlane.map(dataPlaneToRow));
      return rows;
    },
    async getById(id: string) {
      if (id === PROPAGATION_KEY_VIRTUAL_ID) return buildPropagationKeyVirtualRow();
      const dp = await dataPlaneRepo.findOne({ where: { id, track } });
      return dp ? dataPlaneToRow(dp) : null;
    },
    async getByClientId(clientId: string) {
      if (clientId === DEFAULT_PROPAGATION_KEY_CLIENT_ID) return buildPropagationKeyVirtualRow();
      const dp = await dataPlaneRepo.findOne({ where: { clientId, track } });
      return dp ? dataPlaneToRow(dp) : null;
    },
    async getPropagationKeyRow() {
      return buildPropagationKeyVirtualRow();
    },
    async create(input: ManagedRowCreateInput) {
      if (input.kind === "propagation_key") {
        if (track !== "http") {
          throw new Error("propagation key only exists on the HTTP track");
        }
        for (const target of input.targets) {
          await propTargetRepo.save(
            propTargetRepo.create({
              target,
              state: "pending",
              reason: null,
              attemptCount: 0,
            })
          );
        }
        const built = await buildPropagationKeyVirtualRow();
        if (!built) {
          throw new Error("propagation-key targets failed to persist");
        }
        return built;
      }
      const entity = dataPlaneRepo.create({
        id: input.id,
        clientId: input.clientId,
        track,
        secret: input.secret,
        targets: input.targets,
        allowedIps: input.allowedIps ?? null,
        status: "pending",
        reason: null,
      });
      const saved = await dataPlaneRepo.save(entity);
      return dataPlaneToRow(saved);
    },
    async update(id: string, patch: ManagedRowUpdatePatch) {
      if (id === PROPAGATION_KEY_VIRTUAL_ID) {
        if (patch.targets !== undefined) {
          // UNION: never shrink.
          const existing = await propTargetRepo.find();
          const known = new Set(existing.map((t) => t.target));
          for (const t of patch.targets) {
            if (!known.has(t)) {
              await propTargetRepo.save(propTargetRepo.create({ target: t, state: "pending", reason: null, attemptCount: 0 }));
            }
          }
        }
        return;
      }
      const partial: Record<string, unknown> = {};
      if (patch.status !== undefined) partial.status = patch.status;
      if (patch.reason !== undefined) partial.reason = patch.reason;
      if (patch.secret !== undefined) partial.secret = patch.secret;
      if (patch.targets !== undefined) partial.targets = patch.targets;
      if (patch.allowedIps !== undefined) partial.allowedIps = patch.allowedIps;
      if (patch.lastSyncedAt !== undefined) partial.lastSyncedAt = patch.lastSyncedAt;
      if (patch.attemptCount !== undefined) partial.attemptCount = patch.attemptCount;
      if (Object.keys(partial).length === 0) return;
      await dataPlaneRepo.update({ id, track }, partial);
    },
    async delete(id: string) {
      if (id === PROPAGATION_KEY_VIRTUAL_ID) {
        throw new Error("PROPAGATION_KEY_REMOVE_FORBIDDEN: the propagation key has no row to delete");
      }
      // FK on hmac_data_plane_delivery_state.seed_id is ON DELETE CASCADE,
      // so MariaDB wipes the cursor rows automatically.
      await dataPlaneRepo.delete({ id, track });
    },
    async getDeliveryState(rowId: string, target: string) {
      if (rowId === PROPAGATION_KEY_VIRTUAL_ID) {
        const e = await propTargetRepo.findOne({ where: { target } });
        if (!e) return null;
        return {
          state: e.state,
          reason: e.reason ?? null,
          lastAttemptAt: e.lastAttemptAt ?? null,
          lastDeliveredAt: e.lastDeliveredAt ?? null,
          attemptCount: e.attemptCount,
        };
      }
      const e = await dataPlaneStateRepo.findOne({ where: { seedId: rowId, target } });
      if (!e) return null;
      return {
        state: e.state,
        reason: e.reason ?? null,
        lastAttemptAt: e.lastAttemptAt ?? null,
        lastDeliveredAt: e.lastDeliveredAt ?? null,
        attemptCount: e.attemptCount,
      };
    },
    async setDeliveryState(rowId: string, target: string, patch: DeliveryStateUpdatePatch) {
      if (rowId === PROPAGATION_KEY_VIRTUAL_ID) {
        const existing = await propTargetRepo.findOne({ where: { target } });
        const lastDeliveredAt = patch.lastDeliveredAt ?? existing?.lastDeliveredAt ?? null;
        await propTargetRepo.save({
          target,
          state: patch.state,
          reason: patch.reason ?? null,
          lastAttemptAt: patch.lastAttemptAt,
          lastDeliveredAt,
          attemptCount: patch.attemptCount,
        });
        return;
      }
      const existing = await dataPlaneStateRepo.findOne({ where: { seedId: rowId, target } });
      const lastDeliveredAt = patch.lastDeliveredAt ?? existing?.lastDeliveredAt ?? null;
      // The table's PK is a standalone UUID `id`; uniqueness is on
      // (seed_id, target). save() without id always INSERTs which would
      // violate the unique index on a second tick. Use the row's id when
      // present, otherwise INSERT, so TypeORM emits the right
      // INSERT / UPDATE on the natural key.
      await dataPlaneStateRepo.save({
        id: existing?.id,
        seedId: rowId,
        target,
        state: patch.state,
        reason: patch.reason ?? null,
        lastAttemptAt: patch.lastAttemptAt,
        lastDeliveredAt,
        attemptCount: patch.attemptCount,
      });
    },
  };

  return crud;
}
