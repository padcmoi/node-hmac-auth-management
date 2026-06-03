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
  /**
   * Inalienable target federation declared by the source. The
   * propagation key is the lib's invariant: every target the source
   * intends to federate with MUST hold this key, otherwise its
   * `requireBootstrapClientId` gate refuses every credential the source
   * tries to push. The auto-seed enforces this by writing the declared
   * list verbatim on first boot, and by unioning any newly declared
   * target into the existing row on subsequent boots (the lib never
   * shrinks the row's targets on its own).
   */
  propagationKeyTargets?: string[];
  secretToken: string;
  trackLabel: "http" | "message";
  logger?: ManagementLogger;
}

function uniqueStrings(input: string[]) {
  return Array.from(new Set(input.filter((value) => typeof value === "string" && value.length > 0)));
}

export async function runAutoSeed(deps: RunAutoSeedDeps) {
  const declared = uniqueStrings(deps.propagationKeyTargets ?? []);
  const existing = await deps.crud.getPropagationKeyRow();
  if (existing) {
    const merged = uniqueStrings([...existing.targets, ...declared]);
    if (merged.length !== existing.targets.length) {
      await deps.crud.update(existing.id, { targets: merged });
      deps.logger?.info("auto-seed: unioned new propagation-key targets", {
        track: deps.trackLabel,
        clientId: existing.clientId,
        added: merged.filter((target) => !existing.targets.includes(target)),
      });
      return { ...existing, targets: merged };
    }
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
    targets: declared,
    allowedIps: null,
  });

  deps.logger?.info("auto-seed: inserted propagation-key row", {
    track: deps.trackLabel,
    clientId: created.clientId,
    rowId: created.id,
    targets: declared,
  });

  return created;
}
