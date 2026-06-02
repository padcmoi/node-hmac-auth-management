import { randomUUID } from "node:crypto";
import type {
  DeliveryStateRecord,
  DeliveryStateUpdatePatch,
  ManagedCrud,
  ManagedRow,
  ManagedRowCreateInput,
  ManagedRowUpdatePatch,
} from "../../src/index.js";

/**
 * In-memory ManagedCrud used by the vitest suite. The shape mirrors the
 * SQL schema documented in short.md but lives in a pair of Maps so the
 * tests stay framework-free. The implementation is intentionally minimal
 * and tracks every write so a test can assert "exactly this sequence
 * happened".
 */
export function createInMemoryCrud() {
  const rows = new Map<string, ManagedRow>();
  const deliveryStates = new Map<string, DeliveryStateRecord>();

  const keyFor = (rowId: string, target: string) => `${rowId}::${target}`;

  const crud: ManagedCrud = {
    async listPending() {
      return Array.from(rows.values()).filter((row) => row.status === "pending" || row.status === "delete_pending");
    },
    async listAll() {
      return Array.from(rows.values());
    },
    async getById(id: string) {
      return rows.get(id) ?? null;
    },
    async getByClientId(clientId: string) {
      for (const row of rows.values()) {
        if (row.clientId === clientId) return row;
      }
      return null;
    },
    async getPropagationKeyRow() {
      for (const row of rows.values()) {
        if (row.kind === "propagation_key") return row;
      }
      return null;
    },
    async create(input: ManagedRowCreateInput) {
      const id = input.id ?? randomUUID();
      const row: ManagedRow = {
        id,
        clientId: input.clientId,
        kind: input.kind,
        secret: input.secret,
        targets: [...input.targets],
        allowedIps: input.allowedIps ?? null,
        status: "pending",
        reason: null,
        lastSyncedAt: null,
        attemptCount: 0,
      };
      rows.set(id, row);
      return row;
    },
    async update(id: string, patch: ManagedRowUpdatePatch) {
      const row = rows.get(id);
      if (!row) {
        throw new Error(`in-memory crud: row '${id}' not found in update`);
      }
      const updated: ManagedRow = {
        ...row,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
        ...(patch.secret !== undefined ? { secret: patch.secret } : {}),
        ...(patch.targets !== undefined ? { targets: [...patch.targets] } : {}),
        ...(patch.allowedIps !== undefined ? { allowedIps: patch.allowedIps } : {}),
        ...(patch.lastSyncedAt !== undefined ? { lastSyncedAt: patch.lastSyncedAt } : {}),
        ...(patch.attemptCount !== undefined ? { attemptCount: patch.attemptCount } : {}),
      };
      rows.set(id, updated);
    },
    async delete(id: string) {
      rows.delete(id);
      for (const key of Array.from(deliveryStates.keys())) {
        if (key.startsWith(`${id}::`)) {
          deliveryStates.delete(key);
        }
      }
    },
    async getDeliveryState(rowId: string, target: string) {
      return deliveryStates.get(keyFor(rowId, target)) ?? null;
    },
    async setDeliveryState(rowId: string, target: string, patch: DeliveryStateUpdatePatch) {
      const record: DeliveryStateRecord = {
        state: patch.state,
        reason: patch.reason ?? null,
        lastAttemptAt: patch.lastAttemptAt,
        lastDeliveredAt: patch.lastDeliveredAt ?? deliveryStates.get(keyFor(rowId, target))?.lastDeliveredAt ?? null,
        attemptCount: patch.attemptCount,
      };
      deliveryStates.set(keyFor(rowId, target), record);
    },
  };

  return {
    crud,
    rows,
    deliveryStates,
  };
}
