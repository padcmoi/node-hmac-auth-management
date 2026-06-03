import { HmacAuthMgmtError } from "../core/errors.js";
import {
  DEFAULT_PROPAGATION_KEY_CLIENT_ID,
  type CreateHmacAuthManagementOptions,
  type HmacAuthManagement,
} from "../core/types.js";
import { createPropagationKeyCache } from "../state/propagation-key-cache.js";
import { runAutoSeed } from "./auto-seed.js";
import { createTrack } from "./track.js";
import type { SourceCredentialClients } from "./sync.js";

/**
 * Single public factory of the management lib.
 *
 * Boot sequence:
 *   1. Validate the options (propagationKey, hmacHttpAuth, http.crud).
 *   2. Resolve the secretToken from hmacHttpAuth (the upstream lib
 *      stores it on the initialized object since v1.0.0).
 *   3. Auto-seed the propagation-key row in the HTTP CRUD if missing.
 *      The message track shares the HTTP propagation key for signing,
 *      so a single auto-seed covers both.
 *   4. Build the per-track surface (HTTP always, message when
 *      configured).
 *
 * Operational notes:
 *   - The factory awaits the auto-seed before returning. A missing
 *     propagation-key row at boot is recovered transparently here; the
 *     consumer code never observes a partially-initialized management
 *     instance.
 *   - The propagation-key cache is shared between the HTTP and message
 *     tracks (both tracks sign management-route calls with the same
 *     credential).
 */
export async function createHmacAuthManagement(options: CreateHmacAuthManagementOptions) {
  if (!options?.hmacHttpAuth) {
    throw new HmacAuthMgmtError("INVALID_OPTIONS", "hmacHttpAuth is required", 400);
  }
  const propagationKey =
    typeof options.propagationKey === "string" && options.propagationKey.trim()
      ? options.propagationKey.trim()
      : DEFAULT_PROPAGATION_KEY_CLIENT_ID;
  if (!options.http?.crud) {
    throw new HmacAuthMgmtError("INVALID_OPTIONS", "http.crud is required", 400);
  }
  if (options.message && !options.hmacMessageAuth) {
    throw new HmacAuthMgmtError("INVALID_OPTIONS", "message.crud requires hmacMessageAuth to be passed alongside", 400);
  }

  const secretToken = options.hmacHttpAuth.secretToken;
  if (!secretToken) {
    throw new HmacAuthMgmtError(
      "INVALID_OPTIONS",
      "hmacHttpAuth must have a secretToken; pass one to initializeHmacHttpAuth",
      400
    );
  }

  // The propagation key lives in the HTTP credential store on source.
  const httpSourceClients: SourceCredentialClients = {
    get: (clientId) =>
      options.hmacHttpAuth.clients.get(clientId).then((record) => (record ? { secretHash: record.secretHash } : null)),
    setSecretHash: (clientId, secretHash, expiresAt, allowedIps, writeOptions) =>
      options.hmacHttpAuth.clients.setSecretHash(clientId, secretHash, expiresAt, allowedIps, writeOptions),
    revert: (clientId) => options.hmacHttpAuth.clients.revert(clientId),
    delete: (clientId) => options.hmacHttpAuth.clients.delete(clientId),
  };

  await runAutoSeed({
    crud: options.http.crud,
    propagationKey,
    propagationKeyTargets: options.propagationKeyTargets,
    secretToken,
    trackLabel: "http",
    logger: options.logger,
  });

  const propagationKeyCache = createPropagationKeyCache(options.http.crud, propagationKey);

  const httpTrack = createTrack({
    trackStore: "http",
    hmacAuth: options.hmacHttpAuth,
    hmacMessageAuth: options.hmacMessageAuth,
    crud: options.http.crud,
    sourceClients: httpSourceClients,
    propagationKey: propagationKey,
    propagationKeyCache,
    secretToken,
    logger: options.logger,
  });

  let messageTrack: HmacAuthManagement["message"] | undefined;
  if (options.message && options.hmacMessageAuth) {
    const messageSourceClients: SourceCredentialClients = {
      get: (clientId) =>
        options.hmacMessageAuth!.clients.get(clientId).then((record) => (record ? { secretHash: record.secretHash } : null)),
      setSecretHash: (clientId, secretHash, expiresAt, allowedIps, writeOptions) =>
        options.hmacMessageAuth!.clients.setSecretHash(clientId, secretHash, expiresAt, allowedIps, writeOptions),
      revert: (clientId) => options.hmacMessageAuth!.clients.revert(clientId),
      delete: (clientId) => options.hmacMessageAuth!.clients.delete(clientId),
    };

    messageTrack = createTrack({
      trackStore: "message",
      hmacAuth: options.hmacHttpAuth,
      hmacMessageAuth: options.hmacMessageAuth,
      crud: options.message.crud,
      sourceClients: messageSourceClients,
      propagationKey: propagationKey,
      propagationKeyCache,
      secretToken,
      logger: options.logger,
    });
  }

  const management: HmacAuthManagement = {
    propagationKey: propagationKey,
    http: httpTrack,
    message: messageTrack,
  };
  return management;
}
