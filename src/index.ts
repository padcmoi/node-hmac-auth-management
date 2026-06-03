/**
 * Public surface of `@naskot/node-hmac-auth-management`.
 *
 * Everything a consumer needs is re-exported here. Internal modules
 * (under src/management, src/state, src/core) are not part of the
 * public API and may move between minor releases without notice.
 */
export { createHmacAuthManagement } from "./management/init.js";

export { HmacAuthMgmtError } from "./core/errors.js";
export type { HmacAuthMgmtErrorCode } from "./core/errors.js";

export { deriveSecretV1 } from "./core/derive.js";

export { DEFAULT_PROPAGATION_KEY_CLIENT_ID } from "./core/types.js";

export type {
  AddTrackInput,
  CreateHmacAuthManagementOptions,
  DeliveryStateRecord,
  DeliveryStateUpdatePatch,
  GetDeliveryStatusInput,
  HmacAuthManagement,
  HmacAuthManagementTrack,
  ManagedCrud,
  ManagedRow,
  ManagedRowCreateInput,
  ManagedRowUpdatePatch,
  ManagedRowWithSecretHash,
  ManagedTrackOptions,
  ManagementLogger,
  RemoveTrackInput,
  SyncSummary,
  TargetHealth,
  UpdateTrackInput,
} from "./core/types.js";

// Re-export the upstream-initialized shapes consumers need to instantiate
// the lib without importing twice from the upstream package.
export type { InitializedHmacHttpAuth, InitializedHmacMessageAuth } from "@naskot/node-hmac-auth";
