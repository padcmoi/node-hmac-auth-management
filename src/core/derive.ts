import { createHmac } from "node:crypto";

/**
 * Deterministic derivation of the propagation-key plain secret.
 *
 * Inputs:
 *   - `secretToken`  : the secretToken passed to the consumer's
 *                      initializeHmacHttpAuth. The lib does not introspect
 *                      it; it is simply mixed into the HMAC keying.
 *   - `propagationKey`: the clientId the consumer declared for the
 *                      propagation key (e.g. "self_propagation_signer").
 *
 * Contract (FROZEN for the entire v0.x.x / v1.x.x series):
 *   - Same inputs MUST always produce the same output byte-identical.
 *   - The format prefix carries an explicit version tag so any future
 *     breaking change can introduce `deriveSecretV2` while keeping V1
 *     callable for migration.
 *   - The output is the lowercase hex of HMAC-SHA256(secretToken, msg).
 *
 * The function is used by `auto-seed.ts` to insert the propagation-key
 * row when it is missing from the consumer BDD. Restoring an older DB
 * dump or losing the row entirely is safe: the next boot re-creates the
 * row with the exact same plain, which the data-plane then hashes with a
 * fresh UUID enrichment when sync() propagates it.
 *
 * If this function ever returns a different value for a previously-seen
 * input, every API in the federation re-bootstraps with a new propagation
 * key, which means a full federation outage. The golden vitest test
 * guards against accidental algorithm drift.
 */
export function deriveSecretV1(secretToken: string, propagationKey: string) {
  const message = `node-hmac-auth-management:v1:propagation-key:${propagationKey}`;
  return createHmac("sha256", secretToken).update(message).digest("hex");
}
