import type { ManagedCrud, ManagedRow } from "../core/types.js";

/**
 * Boot-time cache for the propagation-key row.
 *
 * Rationale (Trap 8 in plan.md): every sync() needs the propagation key
 * row to decide phase ordering and signer credentials. Calling
 * `crud.getPropagationKeyRow` on every sync would scale linearly with
 * the number of management instances. The row is rotated rarely and
 * always through the lib's own surface, so caching it for the lifetime
 * of the management instance is safe.
 *
 * The cache exposes:
 *   - `read()`       : returns the cached row, fetching it from the CRUD
 *                      on the first call. Throws if the row is missing
 *                      AFTER the auto-seed should have inserted it.
 *   - `refresh()`    : invalidates the cache; the next `read()` re-reads
 *                      from the CRUD. Called after the propagation-key
 *                      row is mutated through the lib (status flip,
 *                      targets union, secret clear).
 *   - `peek()`       : optional accessor for tests; returns the cached
 *                      value WITHOUT triggering a fetch.
 */
export function createPropagationKeyCache(crud: ManagedCrud, propagationKey: string) {
  let cached: ManagedRow | null = null;
  let hasCached = false;

  return {
    async read() {
      if (!hasCached) {
        cached = await crud.getPropagationKeyRow();
        hasCached = true;
      }
      if (!cached) {
        throw new Error(
          `Propagation-key row for clientId '${propagationKey}' is missing from the consumer BDD; auto-seed should have inserted it at boot`
        );
      }
      return cached;
    },
    refresh() {
      cached = null;
      hasCached = false;
    },
    peek() {
      return cached;
    },
  };
}

export type PropagationKeyCache = ReturnType<typeof createPropagationKeyCache>;
