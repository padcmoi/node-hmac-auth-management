import type { DataSource, Repository } from "typeorm";
import type {
  DeliveryStateRecord,
  DeliveryStateUpdatePatch,
  ManagedCrud,
  ManagedRow,
  ManagedRowCreateInput,
  ManagedRowUpdatePatch,
} from "@naskot/node-hmac-auth-management";
import { HmacHttpSeedEntity } from "./entities/hmac-http-seed.entity";
import { HmacHttpSeedDeliveryStateEntity } from "./entities/hmac-http-seed-delivery-state.entity";

/**
 * TypeORM-backed implementation of the lib's `ManagedCrud` interface
 * against MariaDB. The 10 callbacks map 1:1 to repository queries on
 * the two entities (`hmac_http_seed` + `hmac_http_seed_delivery_state`).
 */
export function createTypeOrmManagedCrud(dataSource: DataSource) {
  const seedRepo: Repository<HmacHttpSeedEntity> = dataSource.getRepository(HmacHttpSeedEntity);
  const stateRepo: Repository<HmacHttpSeedDeliveryStateEntity> = dataSource.getRepository(HmacHttpSeedDeliveryStateEntity);

  const toRow = (e: HmacHttpSeedEntity): ManagedRow => ({
    id: e.id,
    clientId: e.clientId,
    kind: e.kind,
    secret: e.secret,
    targets: e.targets ?? [],
    allowedIps: e.allowedIps ?? null,
    status: e.status,
    reason: e.reason,
    lastSyncedAt: e.lastSyncedAt,
    attemptCount: e.attemptCount,
  });

  const crud: ManagedCrud = {
    async listPending() {
      const entities = await seedRepo
        .createQueryBuilder("s")
        .where("s.status IN (:...statuses)", { statuses: ["pending", "delete_pending"] })
        .getMany();
      return entities.map(toRow);
    },
    async listAll() {
      return (await seedRepo.find()).map(toRow);
    },
    async getById(id: string) {
      const e = await seedRepo.findOne({ where: { id } });
      return e ? toRow(e) : null;
    },
    async getByClientId(clientId: string) {
      const e = await seedRepo.findOne({ where: { clientId } });
      return e ? toRow(e) : null;
    },
    async getPropagationKeyRow() {
      const e = await seedRepo.findOne({ where: { kind: "propagation_key" } });
      return e ? toRow(e) : null;
    },
    async create(input: ManagedRowCreateInput) {
      const entity = seedRepo.create({
        id: input.id,
        clientId: input.clientId,
        kind: input.kind,
        secret: input.secret,
        targets: input.targets,
        allowedIps: input.allowedIps ?? null,
        status: "pending",
        reason: null,
      });
      const saved = await seedRepo.save(entity);
      return toRow(saved);
    },
    async update(id: string, patch: ManagedRowUpdatePatch) {
      const partial: Partial<HmacHttpSeedEntity> = {};
      if (patch.status !== undefined) partial.status = patch.status;
      if (patch.reason !== undefined) partial.reason = patch.reason;
      if (patch.secret !== undefined) partial.secret = patch.secret;
      if (patch.targets !== undefined) partial.targets = patch.targets;
      if (patch.allowedIps !== undefined) partial.allowedIps = patch.allowedIps;
      if (patch.lastSyncedAt !== undefined) partial.lastSyncedAt = patch.lastSyncedAt;
      if (patch.attemptCount !== undefined) partial.attemptCount = patch.attemptCount;
      if (Object.keys(partial).length === 0) return;
      await seedRepo.update({ id }, partial);
    },
    async delete(id: string) {
      await seedRepo.delete({ id });
    },
    async getDeliveryState(rowId: string, target: string) {
      const e = await stateRepo.findOne({ where: { seedId: rowId, target } });
      if (!e) return null;
      const record: DeliveryStateRecord = {
        state: e.state,
        reason: e.reason ?? null,
        lastAttemptAt: e.lastAttemptAt ?? null,
        lastDeliveredAt: e.lastDeliveredAt ?? null,
        attemptCount: e.attemptCount,
      };
      return record;
    },
    async setDeliveryState(rowId: string, target: string, patch: DeliveryStateUpdatePatch) {
      const existing = await stateRepo.findOne({ where: { seedId: rowId, target } });
      const lastDeliveredAt = patch.lastDeliveredAt ?? existing?.lastDeliveredAt ?? null;
      await stateRepo.save({
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
