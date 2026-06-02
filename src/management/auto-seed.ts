import type { ManagedCrud, ManagementLogger } from "../core/types.js";
import { deriveSecretV1 } from "../core/derive.js";

/**
 * Insert the propagation-key row in the consumer BDD if and only if it
 * is missing. The lib calls this at boot for each declared track (HTTP
 * always, message when configured). Restoring an older BDD dump that
 * never held the row, or losing it through manual operator action, is
 * recoverable: the next boot re-inserts it with a deterministic plain
 * derived from `(secretToken, propagationKey)` via `deriveSecretV1`.
 *
 * Status:
 *   - Inserted with `status: "pending"` so the next `sync()` propagates
 *     the key to every target it sees.
 *   - `targets: []` initially; sync() unions targets as it processes
 *     data-plane rows that reference new targets.
 *   - `allowedIps: null` (the propagation key authenticates on the
 *     internalManagementRoute only; restricting its IPs is out of
 *     scope for the lib).
 */
export interface RunAutoSeedDeps {
  crud: ManagedCrud;
  propagationKey: string;
  secretToken: string;
  trackLabel: "http" | "message";
  logger?: ManagementLogger;
}

export async function runAutoSeed(deps: RunAutoSeedDeps) {
  const existing = await deps.crud.getPropagationKeyRow();
  if (existing) {
    deps.logger?.info("auto-seed: propagation-key row already present", {
      track: deps.trackLabel,
      clientId: existing.clientId,
      status: existing.status,
    });
    return existing;
  }

  const derivedSecret = deriveSecretV1(deps.secretToken, deps.propagationKey);
  const created = await deps.crud.create({
    clientId: deps.propagationKey,
    kind: "propagation_key",
    secret: derivedSecret,
    targets: [],
    allowedIps: null,
  });

  deps.logger?.info("auto-seed: inserted propagation-key row", {
    track: deps.trackLabel,
    clientId: created.clientId,
    rowId: created.id,
  });

  return created;
}
