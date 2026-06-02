import type { InitializedHmacHttpAuth, InitializedHmacMessageAuth } from "@naskot/node-hmac-auth";

/**
 * The single row owned by the consumer BDD. The lib observes / mutates it
 * via the `ManagedCrud` callbacks; it does NOT impose any storage choice.
 *
 * Fields:
 *   - `id`            : opaque primary key chosen by the consumer (UUID
 *                       string typically). The lib only echoes it back to
 *                       the CRUD functions.
 *   - `clientId`      : the HMAC clientId carried over the wire. Unique
 *                       per track.
 *   - `kind`          : "data_plane" for any rotating credential; the
 *                       reserved value "propagation_key" applies to the
 *                       single row whose clientId equals
 *                       `options.propagationKey`.
 *   - `secret`        : plain-text "pepper" stored only between an
 *                       `add()` / `update()` call and the next `sync()`
 *                       that consumes it. `sync()` clears the field to
 *                       `null` after hashing it (with a per-row random
 *                       UUID) and propagating. `secret === null` means
 *                       "already propagated, nothing to do".
 *   - `targets`       : the list of target API base URLs that should
 *                       hold this credential.
 *   - `allowedIps`    : optional IP/CIDR allowlist on the credential.
 *   - `status`        : per-row state machine.
 *                         pending         -> waiting for the next sync()
 *                         ok              -> in sync on every target
 *                         error           -> last sync() failed; secret
 *                                            field is already cleared
 *                                            (the consumer must insert a
 *                                            fresh plain for a retry).
 *                         delete_pending  -> waiting for a DELETE sync.
 *   - `reason`        : human-readable error context written by sync()
 *                       when status flips to "error".
 *   - `lastSyncedAt`  : timestamp of the last sync() that touched the row.
 *   - `attemptCount`  : monotonic counter (used by consumer-side back-off
 *                       or circuit-breaker if desired).
 */
export interface ManagedRow {
  id: string;
  clientId: string;
  kind: "data_plane" | "propagation_key";
  secret: string | null;
  targets: string[];
  allowedIps?: string[] | null;
  status: "pending" | "ok" | "error" | "delete_pending";
  reason?: string | null;
  lastSyncedAt: Date | null;
  attemptCount: number;
}

/**
 * Per-(row, target) state used by the lib to detect a target reset (Trap
 * 4 in plan.md): when a target reports `clientsCount === 0` even though
 * a previous sync() flagged the row as `delivered` for that exact target,
 * the lib re-pushes the row to that target only.
 *
 * Cursors are intentionally generous (`lastAttemptAt`, `lastDeliveredAt`,
 * `attemptCount`) so the consumer can implement back-off, dashboards or
 * pager rules without re-deriving them from sync() summaries.
 */
export interface DeliveryStateRecord {
  state: "pending" | "delivered" | "errored";
  reason: string | null;
  lastAttemptAt: Date | null;
  lastDeliveredAt: Date | null;
  attemptCount: number;
}

/**
 * Patch shape passed to `crud.update` by both the consumer convenience
 * helpers (`add` / `update` / `remove`) and the internal sync() flow.
 * All fields are optional; the implementation only updates what is set.
 */
export interface ManagedRowUpdatePatch {
  status?: ManagedRow["status"];
  reason?: string | null;
  secret?: string | null;
  targets?: string[];
  allowedIps?: string[] | null;
  lastSyncedAt?: Date;
  attemptCount?: number;
}

/**
 * Input shape for `crud.create`. The consumer-side persistence layer is
 * responsible for generating the `id` (uuid, autoincrement, ...). When
 * the lib auto-seeds the propagation key, it passes `id: undefined` so
 * the BDD assigns one.
 */
export interface ManagedRowCreateInput {
  id?: string;
  clientId: string;
  kind: ManagedRow["kind"];
  secret: string | null;
  targets: string[];
  allowedIps?: string[] | null;
}

export interface DeliveryStateUpdatePatch {
  state: DeliveryStateRecord["state"];
  reason?: string | null;
  lastAttemptAt: Date;
  lastDeliveredAt?: Date;
  attemptCount: number;
}

/**
 * The consumer-supplied CRUD callbacks. The lib observes and mutates the
 * consumer's BDD ONLY through this surface. No SQL, no ORM, no schema is
 * imposed: a Map-backed in-memory implementation (used in tests and the
 * POC) satisfies the contract just as well as a TypeORM-backed one.
 */
export interface ManagedCrud {
  listPending: () => Promise<ManagedRow[]>;
  listAll: () => Promise<ManagedRow[]>;
  getById: (id: string) => Promise<ManagedRow | null>;
  getByClientId: (clientId: string) => Promise<ManagedRow | null>;
  getPropagationKeyRow: () => Promise<ManagedRow | null>;

  create: (input: ManagedRowCreateInput) => Promise<ManagedRow>;
  update: (id: string, patch: ManagedRowUpdatePatch) => Promise<void>;
  delete: (id: string) => Promise<void>;

  getDeliveryState: (rowId: string, target: string) => Promise<DeliveryStateRecord | null>;
  setDeliveryState: (rowId: string, target: string, patch: DeliveryStateUpdatePatch) => Promise<void>;
}

/**
 * Minimal logger surface accepted by the lib. Default `undefined` swallows
 * everything (the lib never throws on a missing logger). When provided,
 * the lib emits one structured event per phase: probe, bootstrap, push,
 * rollback, target-reset, delivery-state-change.
 */
export interface ManagementLogger {
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
}

export interface ManagedTrackOptions {
  crud: ManagedCrud;
}

export interface CreateHmacAuthManagementOptions {
  hmacHttpAuth: InitializedHmacHttpAuth;
  hmacMessageAuth?: InitializedHmacMessageAuth;
  /**
   * The clientId reserved for the propagation key on this management
   * instance. The lib enforces:
   *   - auto-seed on boot when the consumer BDD does not hold the row
   *   - refusal of `remove()` on this clientId
   *   - special atomicity rules in sync()
   */
  propagationKey: string;
  http: ManagedTrackOptions;
  message?: ManagedTrackOptions;
  logger?: ManagementLogger;
}

export interface AddTrackInput {
  clientId: string;
  secret: string;
  targets: string[];
  allowedIps?: string[];
}

export interface UpdateTrackInput {
  clientId: string;
  newSecret: string;
  targets?: string[];
  allowedIps?: string[];
}

export interface RemoveTrackInput {
  clientId: string;
}

export interface GetDeliveryStatusInput {
  clientId: string;
  target: string;
}

/**
 * Result shape of `health(target)` / `healthAll()`. Built from the
 * upstream lib's `internalManagementRoute` GET response. The lib
 * normalizes missing optional fields so consumers can treat the shape as
 * total.
 */
export interface TargetHealth {
  target: string;
  reachable: boolean;
  clientsCount: number;
  authRequired: boolean;
  bootstrapLocked: boolean;
  namespace: string;
  route: string;
  error?: string;
}

export interface SyncSummary {
  durationMs: number;
  rows: {
    processed: number;
    propagated: number;
    errored: number;
    deleted: number;
  };
  perTarget: Map<
    string,
    {
      health: TargetHealth;
      delivered: number;
      refused: number;
      bootstrappedThisSync: boolean;
    }
  >;
  propagationKey: {
    pushedThisSync: boolean;
    targets: { delivered: string[]; errored: string[] };
  };
}

/**
 * Read shape returned by `track.get(clientId)`: the BDD row plus the
 * currently stored `secretHash` on the source-side HMAC auth (HTTP or
 * message). `secretHash === null` means the row was never propagated
 * yet, or the source-side credential was wiped manually. Useful for
 * operator diagnostics or for re-injecting the hash into a freshly
 * onboarded target without going through a full rotation.
 */
export type ManagedRowWithSecretHash = ManagedRow & { secretHash: string | null };

export interface HmacAuthManagementTrack {
  add: (input: AddTrackInput) => Promise<ManagedRow>;
  update: (input: UpdateTrackInput) => Promise<ManagedRow>;
  remove: (input: RemoveTrackInput) => Promise<ManagedRow>;
  sync: () => Promise<SyncSummary>;
  get: (clientId: string) => Promise<ManagedRowWithSecretHash | null>;
  list: () => Promise<ManagedRow[]>;
  health: (target: string) => Promise<TargetHealth>;
  healthAll: (targets?: string[]) => Promise<Map<string, TargetHealth>>;
  getDeliveryStatus: (input: GetDeliveryStatusInput) => Promise<DeliveryStateRecord | null>;
}

export interface HmacAuthManagement {
  readonly propagationKey: string;
  http: HmacAuthManagementTrack;
  message?: HmacAuthManagementTrack;
}
